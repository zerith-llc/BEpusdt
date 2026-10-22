package task

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
	"github.com/shopspring/decimal"
	"github.com/smallnest/chanx"
	"github.com/spf13/cast"
	"github.com/tidwall/gjson"
	"github.com/v03413/bepusdt/app/conf"
	blockapi "github.com/v03413/bepusdt/app/core"
	"github.com/v03413/bepusdt/app/log"
	"github.com/v03413/bepusdt/app/model"
	"github.com/v03413/bepusdt/app/utils"
)

const (
	blockParseMaxNum = 10 // 每次解析区块的最大数量
	evmTransferEvent = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
)

var chainBlockNum sync.Map

type block struct {
	RollDelayOffset int64 // 延迟偏移量，某些RPC节点如果不延迟，会报错 block is out of range，目前发现 https://rpc.xlayer.tech/ 存在此问题
	ConfirmedOffset int   // 确认偏移量，开启交易确认后，区块高度需要减去此值认为交易已确认
}

type evmNative struct {
	Parse     bool
	Decimal   int32
	TradeType model.TradeType
}

type evm struct {
	Network          string
	Block            block
	Native           evmNative
	Client           *http.Client
	blockScanQueue   *chanx.UnboundedChan[evmBlock]
	LookbackInterval time.Duration // 回溯时每批入队的间隔，控制 RPC 调用速率；默认 500ms
}

type evmBlock struct {
	From int64
	To   int64
}

func (e *evm) syncBlocksForward(ctx context.Context) {
	if syncBreak(e.Network, e.blockScanQueue.Len()) {

		return
	}

	post := []byte(`{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}`)
	req, err := http.NewRequestWithContext(ctx, "POST", e.rpcEndpoint(), bytes.NewBuffer(post))
	if err != nil {
		log.Task.Warn("Error creating request:", err)

		return
	}

	req.Header.Set("Content-Type", "application/json")
	resp, err := e.Client.Do(req)
	if err != nil {
		log.Task.Warn("Error sending request:", err)

		return
	}

	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Task.Warn("Error reading response body:", err)

		return
	}

	var res = gjson.ParseBytes(body)
	if !res.IsObject() {
		log.Task.Warn(fmt.Sprintf("EVM 数据解析错误(%s): %s", e.Network, string(body)))

		return
	}

	var now = utils.HexStr2Int(res.Get("result").String()).Int64() - e.Block.RollDelayOffset
	if now <= 0 {

		return
	}

	var lastBlockNumber int64
	if v, ok := chainBlockNum.Load(e.Network); ok {
		lastBlockNumber = v.(int64)
	}

	if now-lastBlockNumber > cast.ToInt64(model.GetC(model.BlockHeightMaxDiff)) {

		lastBlockNumber = now - 1
	}

	chainBlockNum.Store(e.Network, now)
	if now <= lastBlockNumber {

		return
	}

	step := e.scanScope().batchSize()
	for from := lastBlockNumber + 1; from <= now; from += step {
		to := from + step - 1
		if to > now {
			to = now
		}

		e.blockScanQueue.In <- evmBlock{From: from, To: to}
	}
}

func (e *evm) lookbackBlocks(ctx context.Context) {
	if syncBreak(e.Network, e.blockScanQueue.Len()) {
		return
	}

	startAt, endAt, ok := getLookbackUnix(model.Network(e.Network))
	if !ok {
		return
	}

	interval := e.LookbackInterval
	if interval <= 0 {
		interval = time.Millisecond * 300
	}

	start, end := blockapi.New().GetBoundaryHeights(startAt, endAt, e.Network)
	step := e.scanScope().batchSize()
	for i := start; i <= end; i += step {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if syncBreak(e.Network, e.blockScanQueue.Len()) {
			return
		}
		to := i + step - 1
		if to > end {
			to = end
		}
		e.blockScanQueue.In <- evmBlock{From: i, To: to}
		time.Sleep(interval)
	}
}

func (e *evm) blockDispatch(ctx context.Context) {
	p, err := ants.NewPoolWithFunc(3, e.getBlockByNumber)
	if err != nil {
		log.Task.Warn("Error creating pool:", err)

		return
	}

	defer p.Release()

	for {
		select {
		case <-ctx.Done():
			return
		case n := <-e.blockScanQueue.Out:
			if err := p.Invoke(n); err != nil {
				e.blockScanQueue.In <- n

				log.Task.Warn("Evm Block Dispatch Error invoking process block:", err)
			}
		}
	}
}

func (e *evm) getBlockByNumber(a any) {
	b, ok := a.(evmBlock)
	if !ok {
		log.Task.Warn("Evm Block Parse Error: expected []int64, got", a)

		return
	}

	scope := e.scanScope() // [FORK] evm-scan-scope
	if scope.native && b.To-b.From+1 > blockParseMaxNum {
		// 入队时按仅扫事件的大批次切分，之后出现了原生币订单：拉完整区块需要拆回小批次
		for from := b.From; from <= b.To; from += blockParseMaxNum {
			e.blockScanQueue.In <- evmBlock{From: from, To: min(from+blockParseMaxNum-1, b.To)}
		}

		return
	}

	nativeTransfers := make([]transfer, 0)
	blockTimestamp := make(map[string]time.Time)
	if scope.native {
		var ok bool
		if nativeTransfers, ok = e.parseNativeBlocks(b, blockTimestamp); !ok {

			return
		}
	}

	transfers, err := e.parseEventTransfer(b, blockTimestamp, scope)
	if err != nil {
		conf.RecordFailure(e.Network)
		e.blockScanQueue.In <- b
		log.Task.Warn("Evm Block Parse Error parsing block transfer:", err)

		return
	}

	conf.RecordSuccess(e.Network, cast.ToString(b.To))

	if len(nativeTransfers) > 0 {
		transferQueue.In <- nativeTransfers
	}
	if len(transfers) > 0 {
		transferQueue.In <- transfers
	}

	log.Task.Info(fmt.Sprintf("区块扫描完成(%s): %d → %d 成功率：%s", e.Network, b.From, b.To, conf.GetSuccessRate(e.Network)))
}

// parseNativeBlocks 拉取完整区块(含交易)解析原生币转账，同时记录区块时间；失败时已重新入队
func (e *evm) parseNativeBlocks(b evmBlock, blockTimestamp map[string]time.Time) ([]transfer, bool) {
	items := make([]string, 0)
	for i := b.From; i <= b.To; i++ {
		items = append(items, fmt.Sprintf(`{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x%x",%t],"id":%d}`, i, e.Native.Parse, i))
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", e.rpcEndpoint(), bytes.NewBuffer([]byte(fmt.Sprintf(`[%s]`, strings.Join(items, ",")))))
	if err != nil {
		log.Task.Warn("Error creating request:", err)

		return nil, false
	}

	req.Header.Set("Content-Type", "application/json")
	resp, err := e.Client.Do(req)
	if err != nil {
		conf.RecordFailure(e.Network)
		e.blockScanQueue.In <- b
		log.Task.Warn("eth_getBlockByNumber Error sending request:", err)

		return nil, false
	}

	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		conf.RecordFailure(e.Network)
		e.blockScanQueue.In <- b
		log.Task.Warn("eth_getBlockByNumber Error reading response body:", err)

		return nil, false
	}

	nativeTransfers := make([]transfer, 0)
	for _, itm := range gjson.ParseBytes(body).Array() {
		if itm.Get("error").Exists() {
			conf.RecordFailure(e.Network)
			e.blockScanQueue.In <- b
			log.Task.Warn(fmt.Sprintf("%s eth_getBlockByNumber response error %s", e.Network, itm.Get("error").String()))

			return nil, false
		}

		timestamp := utils.HexStr2Int(itm.Get("result.timestamp").String()).Int64()
		blockTime := time.Unix(timestamp, 0)
		blockNumHex := itm.Get("result.number").String()
		blockTimestamp[blockNumHex] = blockTime

		var array = itm.Get("result.transactions").Array()
		if e.Native.Parse && len(array) != 0 {

			nativeTransfers = append(nativeTransfers, e.parseNativeTransfer(array, int(utils.HexStr2Int(blockNumHex).Int64()), blockTime)...)
		}
	}

	return nativeTransfers, true
}

func (e *evm) parseNativeTransfer(array []gjson.Result, num int, timestamp time.Time) []transfer {
	nativeTransfers := make([]transfer, 0)
	for _, tx := range array {
		if tx.Get("input").String() != "0x" {
			// 非原生币交易

			continue
		}

		valStr := tx.Get("value").String()
		if valStr == "0x0" || len(valStr) < 3 {
			// 过滤 0 值交易

			continue
		}

		amount, ok := big.NewInt(0).SetString(valStr[2:], 16)
		if !ok || amount.Sign() <= 0 {

			continue
		}

		toAddress := tx.Get("to").String()
		if toAddress == "" { // 合约创建交易 to 为空

			continue
		}

		nativeTransfers = append(nativeTransfers, transfer{
			Network:     e.Network,
			FromAddress: tx.Get("from").String(),
			RecvAddress: toAddress,
			Amount:      decimal.NewFromBigInt(amount, e.Native.Decimal),
			TxHash:      tx.Get("hash").String(),
			BlockNum:    num,
			Timestamp:   timestamp,
			TradeType:   e.Native.TradeType,
		})
	}

	return nativeTransfers
}

func (e *evm) parseEventTransfer(b evmBlock, timestamp map[string]time.Time, scope evmScanScope) ([]transfer, error) {
	transfers := make([]transfer, 0)
	if !scope.logs {

		return transfers, nil
	}

	post := []byte(fmt.Sprintf(`{"jsonrpc":"2.0","method":"eth_getLogs","params":[%s],"id":1}`, scope.logsFilter(b)))
	resp, err := e.Client.Post(e.rpcEndpoint(), "application/json", bytes.NewBuffer(post))
	if err != nil {

		return transfers, errors.Join(errors.New("eth_getLogs Post Error"), err)
	}

	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {

		return transfers, errors.Join(errors.New("eth_getLogs ReadAll Error"), err)
	}

	data := gjson.ParseBytes(body)
	if data.Get("error").Exists() {

		return transfers, errors.New(fmt.Sprintf("%s eth_getLogs response error %s", e.Network, data.Get("error").String()))
	}

	var missing = make(map[string]struct{})
	var blockNums = make([]string, 0)
	for _, itm := range data.Get("result").Array() {
		to := itm.Get("address").String()
		tradeType, ok := model.GetContractTrade(to)
		if !ok {

			continue
		}

		topics := itm.Get("topics").Array()
		if len(topics) < 3 {

			continue
		}

		if topics[0].String() != evmTransferEvent { // transfer event signature

			continue
		}

		from := fmt.Sprintf("0x%s", topics[1].String()[26:])
		recv := fmt.Sprintf("0x%s", topics[2].String()[26:])
		amount, ok := big.NewInt(0).SetString(itm.Get("data").String()[2:], 16)
		if !ok || amount.Sign() <= 0 {

			continue
		}

		blockNum := itm.Get("blockNumber").String()
		if _, ok := timestamp[blockNum]; !ok {
			if ts := itm.Get("blockTimestamp"); ts.Exists() {
				timestamp[blockNum] = time.Unix(utils.HexStr2Int(ts.String()).Int64(), 0)
			} else {
				missing[blockNum] = struct{}{}
			}
		}

		transfers = append(transfers, transfer{
			Network:     e.Network,
			FromAddress: from,
			RecvAddress: recv,
			Amount:      decimal.NewFromBigInt(amount, model.GetContractDecimal(to)),
			TxHash:      itm.Get("transactionHash").String(),
			BlockNum:    cast.ToInt(blockNum),
			TradeType:   tradeType,
		})
		blockNums = append(blockNums, blockNum)
	}

	if len(missing) > 0 {
		nums := make([]string, 0, len(missing))
		for n := range missing {
			nums = append(nums, n)
		}

		times, err := e.fetchBlockTimes(nums)
		if err != nil {

			return transfers, errors.Join(errors.New("eth_getBlockByNumber header Error"), err)
		}
		for n, t := range times {
			timestamp[n] = t
		}
	}

	for i := range transfers {
		transfers[i].Timestamp = timestamp[blockNums[i]]
	}

	return transfers, nil
}

func (e *evm) tradeConfirmHandle(ctx context.Context) {
	var orders = getConfirmingOrders(model.GetNetworkTrades(model.Network(e.Network)))
	var wg sync.WaitGroup

	var handle = func(o model.Order) {
		if model.GetC(model.BlockOffsetConfirm) == "1" {
			last, ok := chainBlockNum.Load(e.Network)
			if !ok {
				return
			}
			if cast.ToInt(last)-o.RefBlockNum < e.Block.ConfirmedOffset {
				return
			}
		}

		post := []byte(fmt.Sprintf(`{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["%s"],"id":1}`, o.RefHash))
		req, err := http.NewRequestWithContext(ctx, "POST", e.rpcEndpoint(), bytes.NewBuffer(post))
		if err != nil {
			log.Task.Warn("evm tradeConfirmHandle Error creating request:", err)

			return
		}

		req.Header.Set("Content-Type", "application/json")
		resp, err := e.Client.Do(req)
		if err != nil {
			log.Task.Warn("evm tradeConfirmHandle Error sending request:", err)

			return
		}

		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Task.Warn("evm tradeConfirmHandle Error reading response body:", err)

			return
		}

		data := gjson.ParseBytes(body)
		if data.Get("error").Exists() {
			log.Task.Warn(fmt.Sprintf("%s eth_getTransactionReceipt response error %s", e.Network, data.Get("error").String()))

			return
		}

		if data.Get("result.status").String() == "0x1" {
			markFinalConfirmed(o)
		}
	}

	for _, order := range orders {
		wg.Add(1)
		go func() {
			defer wg.Done()
			handle(order)
		}()
	}

	wg.Wait()
}

func (e *evm) rpcEndpoint() string {

	return model.Endpoint(model.Network(e.Network))
}

func syncBreak(network string, num int) bool {
	if num >= blockQueueLimit {
		log.Task.Warn(fmt.Sprintf("%s 同步阻塞，当前区块消费堆积数量：%d", network, num))

		return true
	}

	if mqttSubscribed(network) {
		return false
	}

	trades := model.GetNetworkTrades(model.Network(network))
	if len(trades) == 0 {

		return true
	}

	if hasOtherNotifyWallet(trades) {

		return false
	}

	return !hasLookbackOrders(trades)
}
