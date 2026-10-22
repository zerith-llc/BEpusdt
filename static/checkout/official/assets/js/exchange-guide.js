/*
 * [FORK] 交易所提币引导：交易所提币会从提现数量里扣网络手续费，用户按订单金额填写时到账会少一点，
 * 而网关是精确金额匹配，少一分都不会自动到账。这里在付款页给出醒目提示，并提供币安提币的分步教程。
 *
 * 由 checkout.js 的 showPayment() 调用 ExchangeGuide.mount(ctx)；不依赖 i18next，文案自带中英文。
 */
(function () {
    'use strict';

    // 币安提现页面上的网络名称，按 BEpusdt 的 network 取值映射
    var BINANCE_NETWORK = {
        bsc: 'BNB Smart Chain (BEP20)',
        tron: 'Tron (TRC20)',
        ethereum: 'Ethereum (ERC20)',
        polygon: 'Polygon POS',
        arbitrum: 'Arbitrum One',
        base: 'Base',
        solana: 'Solana',
        aptos: 'Aptos',
        ton: 'The Open Network (TON)',
        xlayer: 'X Layer',
        plasma: 'Plasma'
    };

    // 仅用于示例演算，真实手续费以交易所页面为准
    var EXAMPLE_FEE = '0.01';

    var TEXT = {
        zh: {
            bannerTitle: '从币安等交易所提币？请看这里',
            bannerBody: '交易所会从提现数量里扣手续费。必须让「到账数量」正好等于 {amount}，多一分少一分都不会自动到账。',
            bannerBtn: '查看币安提币教程',
            modalTitle: '币安提币教程',
            modalLead: '跟着下面 5 步做，付款会自动到账。',
            step1: '打开币安 App，进入「资产」→「提现」，选择 <b>{currency}</b>。',
            step2: '选择「通过加密货币网络发送」（链上提现），<b>不要</b>用「币安用户间转账」或 Binance Pay。粘贴收款地址：',
            step3: '网络选择 <b>{binanceNet}</b>。选错网络资金无法找回。',
            step4: '「提现数量」填 <b>订单金额 + 手续费</b>。币安会从提现数量里扣掉网络手续费，按订单金额原样填写会少到账。',
            step5: '提交前核对确认页上的「到账数量」，必须<b>正好</b>是：',
            mockTitle: '币安确认页示例（手续费按 {fee} 演算，以实际页面为准）',
            mockWithdraw: '提现数量',
            mockFee: '网络手续费',
            mockReceive: '到账数量',
            mockOk: '与订单金额一致',
            otherExchange: '欧易、Bybit 等其他交易所同理：确认「到账数量」等于订单金额即可。用自己的钱包（TokenPocket、imToken、MetaMask 等）直接转账时，按订单金额原样转出。',
            copy: '复制',
            copied: '已复制',
            copyFailed: '复制失败',
            gotIt: '我知道了'
        },
        en: {
            bannerTitle: 'Paying from Binance or another exchange?',
            bannerBody: 'Exchanges deduct a withdrawal fee from the amount you enter. The amount received must be exactly {amount}, or the payment will not be credited automatically.',
            bannerBtn: 'Binance withdrawal guide',
            modalTitle: 'How to pay from Binance',
            modalLead: 'Follow these 5 steps and the payment will be credited automatically.',
            step1: 'Open the Binance app, go to Assets → Withdraw and choose <b>{currency}</b>.',
            step2: 'Choose "Send via crypto network". Do <b>not</b> use "Send to Binance user" or Binance Pay. Paste the receiving address:',
            step3: 'Select the network <b>{binanceNet}</b>. Funds sent on the wrong network cannot be recovered.',
            step4: 'Enter <b>order amount + fee</b> as the withdrawal amount. Binance deducts the network fee from it, so entering the order amount as-is will arrive short.',
            step5: 'Before submitting, check that "Receive amount" on the confirmation screen is <b>exactly</b>:',
            mockTitle: 'Example confirmation (fee {fee} for illustration, use the real value shown)',
            mockWithdraw: 'Amount',
            mockFee: 'Network fee',
            mockReceive: 'Receive amount',
            mockOk: 'Matches the order',
            otherExchange: 'Other exchanges (OKX, Bybit, …) work the same way: make sure the received amount equals the order amount. When paying from your own wallet (TokenPocket, imToken, MetaMask, …), send the order amount as-is.',
            copy: 'Copy',
            copied: 'Copied',
            copyFailed: 'Copy failed',
            gotIt: 'Got it'
        }
    };

    var ctx = null;

    function lang() {
        try {
            return ((navigator.language || 'en').toLowerCase().indexOf('zh') === 0) ? 'zh' : 'en';
        } catch (e) { return 'en'; }
    }

    function tr(key, vars) {
        var s = (TEXT[lang()] || TEXT.en)[key] || TEXT.zh[key] || key;
        return s.replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] != null ? vars[k] : ''; });
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // 金额加减用整数运算，避免浮点误差；按订单金额的小数位数对齐
    function addAmount(a, b) {
        var da = (String(a).split('.')[1] || '').length, db = (String(b).split('.')[1] || '').length;
        var d = Math.max(da, db), f = Math.pow(10, d);
        var sum = Math.round(parseFloat(a) * f) + Math.round(parseFloat(b) * f);
        return (sum / f).toFixed(d);
    }

    function vars() {
        var amount = esc(ctx.amount), currency = esc(ctx.currency);
        return {
            amount: '<b>' + amount + ' ' + currency + '</b>',
            currency: currency,
            fee: esc(EXAMPLE_FEE + ' ' + ctx.currency),
            binanceNet: esc(BINANCE_NETWORK[String(ctx.network || '').toLowerCase()] || ctx.netName || ctx.network || '')
        };
    }

    function toast(msg, ok) {
        var el = document.getElementById('cmusToast');
        if (!el) return;
        el.textContent = msg;
        el.className = 'toast ' + (ok ? 'success' : 'error') + ' show';
        setTimeout(function () { el.className = 'toast'; }, 1800);
    }

    function copy(text) {
        var done = function () { toast(tr('copied'), true); };
        var fallback = function () {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy') ? done() : toast(tr('copyFailed'), false); } catch (e) { toast(tr('copyFailed'), false); }
            document.body.removeChild(ta);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
        else fallback();
    }

    function copyRow(value, unit) {
        return '<div class="xg-copy-row">' +
            '<span class="xg-copy-value">' + esc(value) + (unit ? ' <small>' + esc(unit) + '</small>' : '') + '</span>' +
            '<button type="button" class="xg-copy-btn" data-copy="' + esc(value) + '">' + esc(tr('copy')) + '</button>' +
            '</div>';
    }

    function renderBanner(mountEl) {
        var v = vars();
        mountEl.innerHTML =
            '<div class="xg-banner" data-testid="exchange-guide-banner">' +
            '<div class="xg-banner-title">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
            '<span>' + tr('bannerTitle') + '</span></div>' +
            '<p class="xg-banner-body">' + tr('bannerBody', v) + '</p>' +
            '<button type="button" class="xg-banner-btn" id="xgOpenBtn">' + tr('bannerBtn') + ' →</button>' +
            '</div>';
        document.getElementById('xgOpenBtn').addEventListener('click', open);
    }

    function renderModal() {
        var v = vars();
        var withdraw = addAmount(ctx.amount, EXAMPLE_FEE);
        var unit = ctx.currency;
        var html =
            '<div class="modal-card xg-modal-card" role="dialog" aria-modal="true" aria-labelledby="xgTitle">' +
            '<div class="xg-modal-head"><h2 id="xgTitle">' + tr('modalTitle') + '</h2>' +
            '<button type="button" class="xg-close" aria-label="close" data-xg-close>&times;</button></div>' +
            '<div class="xg-modal-body">' +
            '<p class="xg-lead">' + tr('modalLead') + '</p>' +
            '<ol class="xg-steps">' +
            '<li>' + tr('step1', v) + '</li>' +
            '<li>' + tr('step2', v) + copyRow(ctx.address, '') + '</li>' +
            '<li>' + tr('step3', v) + '</li>' +
            '<li>' + tr('step4', v) + '</li>' +
            '<li>' + tr('step5', v) + copyRow(ctx.amount, unit) +
            '<div class="xg-mock" data-testid="exchange-guide-mock">' +
            '<div class="xg-mock-title">' + tr('mockTitle', v) + '</div>' +
            '<div class="xg-mock-row"><span>' + tr('mockWithdraw') + '</span><span>' + esc(withdraw + ' ' + unit) + '</span></div>' +
            '<div class="xg-mock-row"><span>' + tr('mockFee') + '</span><span>−' + esc(EXAMPLE_FEE + ' ' + unit) + '</span></div>' +
            '<div class="xg-mock-row xg-mock-receive"><span>' + tr('mockReceive') + '</span><span>' + esc(ctx.amount + ' ' + unit) + ' ✓</span></div>' +
            '<div class="xg-mock-ok">' + tr('mockOk') + '</div>' +
            '</div></li>' +
            '</ol>' +
            '<p class="xg-other">' + tr('otherExchange') + '</p>' +
            '</div>' +
            '<div class="xg-modal-foot"><button type="button" class="xg-got-it" data-xg-close>' + tr('gotIt') + '</button></div>' +
            '</div>';

        var overlay = document.getElementById('exchangeGuideModal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'exchangeGuideModal';
            overlay.className = 'modal-overlay xg-overlay';
            overlay.setAttribute('data-testid', 'exchange-guide-modal');
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay || e.target.hasAttribute('data-xg-close')) close();
                var c = e.target.getAttribute('data-copy');
                if (c) copy(c);
            });
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = html;
        return overlay;
    }

    function open() {
        if (!ctx) return;
        renderModal().style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function close() {
        var overlay = document.getElementById('exchangeGuideModal');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    function seenKey() { return 'xg_seen_' + ctx.tradeId; }

    // 每个订单首次进入付款页自动弹一次教程，之后只保留横幅入口
    function autoOpenOnce() {
        try {
            if (window.localStorage.getItem(seenKey())) return;
            window.localStorage.setItem(seenKey(), '1');
        } catch (e) { /* 存储不可用时照样弹出 */ }
        open();
    }

    window.ExchangeGuide = {
        mount: function (c) {
            var mountEl = document.getElementById('exchangeGuideMount');
            if (!mountEl || !c || !c.amount || c.amount === '--' || !c.address) return;
            ctx = c;
            renderBanner(mountEl);
            autoOpenOnce();
        },
        open: open,
        close: close
    };

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();
