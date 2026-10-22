package task

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/tidwall/gjson"
	"github.com/v03413/bepusdt/app/model"
	"github.com/v03413/bepusdt/app/utils"
)

// 仅扫代币事件（不拉完整区块）时每批的区块数；eth_getLogs 按次计费，与区块数无关
const blockLogsOnlyMaxNum = 50

// evmScanScope 描述一批区块实际需要扫描的范围，用于按需削减 RPC 调用量
//
// 上游实现每批都会：逐块 eth_getBlockByNumber(含完整交易) + 一次不带任何过滤的 eth_getLogs(返回全网 Transfer 事件)。
// 这里只在确实需要时才这样做：
//   - 原生币(BNB/ETH…)：仅当存在待支付的原生币订单、或原生币钱包开启了其它通知时才拉完整区块；
//   - 代币事件：按本网络支持的代币合约过滤 address，并按收款钱包过滤 topics[2]；
//   - 区块时间：优先取日志自带的 blockTimestamp，缺失时才补拉区块头。
//
// MQTT 订阅了该网络时需要推送全网转账，退回上游的全量扫描。
type evmScanScope struct {
	native     bool     // 是否需要拉完整区块解析原生币转账
	logs       bool     // 是否需要 eth_getLogs
	contracts  []string // address 过滤，空表示不过滤
	recvTopics []string // topics[2] 过滤，空表示不过滤
}

func (e *evm) scanScope() evmScanScope {
	if mqttSubscribed(e.Network) {

		return evmScanScope{native: e.Native.Parse, logs: true}
	}

	var scope evmScanScope
	var tokenTrades = make([]model.TradeType, 0)
	for _, t := range model.GetNetworkTrades(model.Network(e.Network)) {
		if c := model.GetTradeContract(t); c != "" {
			tokenTrades = append(tokenTrades, t)
			scope.contracts = append(scope.contracts, c)
		}
	}

	if e.Native.Parse {
		scope.native = hasOtherNotifyWallet([]model.TradeType{e.Native.TradeType}) || hasLookbackOrders([]model.TradeType{e.Native.TradeType})
	}

	if len(tokenTrades) == 0 {

		return scope
	}

	scope.logs = true
	if hasOtherNotifyWallet(tokenTrades) {
		// 其它通知需要钱包转出的事件(topics[1])，topics 按位置是 AND 关系，无法同时过滤收发两侧

		return scope
	}

	recv := receivingAddresses(tokenTrades)
	if len(recv) == 0 {
		// 没有任何收款地址，代币事件不可能匹配到订单
		scope.logs = false

		return scope
	}

	for _, addr := range recv {
		scope.recvTopics = append(scope.recvTopics, "0x000000000000000000000000"+strings.TrimPrefix(addr, "0x"))
	}

	return scope
}

// batchSize 每批入队的区块数；需要拉完整区块时保持上游的 blockParseMaxNum
func (s evmScanScope) batchSize() int64 {
	if s.native {

		return blockParseMaxNum
	}

	return blockLogsOnlyMaxNum
}

func (s evmScanScope) logsFilter(b evmBlock) string {
	filter := fmt.Sprintf(`"fromBlock":"0x%x","toBlock":"0x%x"`, b.From, b.To)
	if len(s.contracts) > 0 {
		filter += fmt.Sprintf(`,"address":["%s"]`, strings.Join(s.contracts, `","`))
	}

	topics := fmt.Sprintf(`"%s"`, evmTransferEvent)
	if len(s.recvTopics) > 0 {
		topics += fmt.Sprintf(`,null,["%s"]`, strings.Join(s.recvTopics, `","`))
	}

	return fmt.Sprintf(`{%s,"topics":[%s]}`, filter, topics)
}

func hasOtherNotifyWallet(trades []model.TradeType) bool {
	var count int64
	model.Db.Model(&model.Wallet{}).
		Where("other_notify = ? and trade_type in (?)", model.WaOtherEnable, trades).
		Count(&count)

	return count > 0
}

// receivingAddresses 可能收到订单款项的 EVM 地址(小写)：全部钱包(含停用) + 待支付订单的匹配地址
func receivingAddresses(trades []model.TradeType) []string {
	var set = make(map[string]struct{})
	var wallets []model.Wallet
	model.Db.Where("trade_type in (?)", trades).Find(&wallets)
	for _, w := range wallets {
		set[strings.ToLower(w.MatchAddr)] = struct{}{}
	}

	var orders []model.Order
	model.Db.Where("status in (?)", receivableOrderStatuses()).
		Where("expired_at > ?", time.Now().Add(model.GetLookbackHour())).
		Where("trade_type in (?)", trades).
		Find(&orders)
	for _, o := range orders {
		set[strings.ToLower(orderMatchAddress(o))] = struct{}{}
	}

	var list = make([]string, 0, len(set))
	for addr := range set {
		if utils.IsValidEvmAddress(addr) {
			list = append(list, addr)
		}
	}

	return list
}

// fetchBlockTimes 只拉区块头(不含交易)补齐时间戳，用于 RPC 未返回日志 blockTimestamp 的情况
func (e *evm) fetchBlockTimes(nums []string) (map[string]time.Time, error) {
	var result = make(map[string]time.Time)
	if len(nums) == 0 {

		return result, nil
	}

	items := make([]string, 0, len(nums))
	for i, n := range nums {
		items = append(items, fmt.Sprintf(`{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["%s",false],"id":%d}`, n, i))
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", e.rpcEndpoint(), bytes.NewBuffer([]byte(fmt.Sprintf(`[%s]`, strings.Join(items, ",")))))
	if err != nil {

		return result, err
	}

	req.Header.Set("Content-Type", "application/json")
	resp, err := e.Client.Do(req)
	if err != nil {

		return result, err
	}

	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {

		return result, err
	}

	for _, itm := range gjson.ParseBytes(body).Array() {
		if itm.Get("error").Exists() {

			return result, fmt.Errorf("%s eth_getBlockByNumber response error %s", e.Network, itm.Get("error").String())
		}

		result[itm.Get("result.number").String()] = time.Unix(utils.HexStr2Int(itm.Get("result.timestamp").String()).Int64(), 0)
	}

	return result, nil
}
