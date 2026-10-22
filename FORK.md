# zerith-llc/BEpusdt fork 说明

上游：[v03413/BEpusdt](https://github.com/v03413/BEpusdt)（GPLv3，`upstream` remote）。本 fork 同样以 GPLv3 公开。

约定：fork 逻辑尽量放在独立文件，上游文件里只留一行接线并标 `[FORK] <slug>`，方便同步上游时定位。
不要提交任何密钥、钱包地址、部署配置。

## 改动清单

### evm-scan-scope：按需扫块，降低 RPC 用量

- 文件：`app/task/evm_scope.go`，接线在 `app/task/evm.go`
- 上游每批区块都会逐块 `eth_getBlockByNumber`（含完整交易）+ 一次不带过滤的 `eth_getLogs`（返回全网 Transfer）。
  改为：只在有待支付原生币订单 / 原生币钱包开了其它通知时才拉完整区块；`eth_getLogs` 按代币合约过滤 `address`、
  按收款钱包过滤 `topics[2]`；区块时间取日志自带的 `blockTimestamp`，缺失才补拉区块头；仅扫事件时每批 50 块。
- 开了 MQTT 推送的网络退回上游全量扫描；钱包开了「其它通知」时不按收款钱包过滤（需要转出事件）。
- 验证：`fork/e2e/rpc-cost/run.sh <上游二进制> <fork二进制> [秒数] [rpc] [钱包]`，并排跑两版并核对 fork 不漏账。

### exchange-guide：收银台交易所提币引导

- 文件：`static/checkout/official/assets/{js,css}/exchange-guide.*`，接线在 `views/checkout.html`、`assets/js/checkout.js`
- 网关是精确金额匹配，交易所提币会从提现数量里扣手续费导致少到账。付款页加醒目提示 + 币安提币分步教程
  （点横幅按钮弹出，不自动弹），带地址/金额复制；核心是「填订单金额 → 点到账数量 ⇋ → 确认」，配三张裁剪标注过的
  币安截图（`assets/img/exchange-guide/*.webp`，由 `fork/assets-src/exchange-guide-images.py` 从原图生成，原图不入库）。
- 验证：`fork/e2e/checkout-guide/shot.py <base_url> <trade_id> <out_dir>`（`CHROME_PATH` 可指定本机 Chrome）。

### fractional-lookback：订单回溯时间支持小数小时

- 文件：`app/model/conf.go`（`GetLookbackHour`），后台表单校验在 `web/src/views/system/base/components/info.vue`
- 上游按整数小时解析 `payment_lookback_hour`，最小只能 1 小时；填 `0.5` 会被解析成 0，等于关掉回溯。
- 过期订单在回溯窗口内会持续扫块（用来接住晚到的付款），窗口越长 RPC 用量越大。改成按浮点数解析，可以设成 `0.5`（30 分钟）这类更短的窗口；整数配置行为不变。

### asset-version：收银台静态资源带版本号

- 文件：`app/handler/epusdt/epusdt.go`（模板变量 `v` = 构建版本），`static/checkout/official/views/checkout.html`
- 静态资源文件名不变，CDN 和浏览器会按 `Cache-Control` 继续发旧文件，发版后新页面会拿到旧 js/css。给本地 css/js 加 `?v=<构建版本>`；收银台页面本身是动态路由，不会被缓存，所以每次发版资源 URL 都会变。

## 本地构建注意

`static/secure/` 是后台前端构建产物（被 gitignore），只跑 Go 二进制时放一个占位 `static/secure/secure.html` 即可启动。
