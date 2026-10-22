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

    var IMG = '/checkout/official/assets/img/exchange-guide/';

    var TEXT = {
        zh: {
            bannerTitle: '从币安等交易所提币？请看这里',
            bannerBody: '交易所会从提现数量里扣手续费。必须让「到账数量」正好等于 {amount}，多一分少一分都不会自动到账。',
            bannerTip: '币安用户：金额框填好订单金额后，点一下底部的「到账数量 ⇋」，币安会自动把手续费加上。',
            bannerBtn: '查看币安提币图文教程',
            modalTitle: '币安提币教程',
            modalLead: '跟着下面 6 步做，付款会自动到账。',
            step1: '打开币安 App，进入「资产」→「提现」，选择 <b>{currency}</b>，再选「通过加密货币网络发送」（<b>不要</b>用币安用户间转账或 Binance Pay）。',
            step2: '粘贴收款地址：',
            step3: '网络选择 <b>{binanceNet}</b>。选错网络资金无法找回。',
            step4: '在金额框里填入订单金额。此时底部的「到账数量」会比订单金额少一点（被扣了手续费），<b>点「到账数量」旁边的 ⇋</b>：',
            step5: '弹出「修改收款金额」，确认里面的「到账数量」就是订单金额，点<b>确认</b>：',
            step6: '提现数量自动变成「订单金额 + 手续费」，底部「到账数量」正好等于订单金额，这时再点<b>提现</b>：',
            imgNote: '图中以 10 USDT、手续费 0.01 为例，请以你的订单金额为准。',
            img1Alt: '填入金额后到账数量少了手续费，点到账数量旁的切换按钮',
            img2Alt: '修改收款金额弹窗，到账数量等于订单金额，点确认',
            img3Alt: '提现数量自动加上手续费，到账数量等于订单金额',
            otherExchange: '欧易、Bybit 等其他交易所同理：提交前确认「到账数量」等于订单金额即可。用自己的钱包（TokenPocket、imToken、MetaMask 等）直接转账时，按订单金额原样转出。',
            copy: '复制',
            copied: '已复制',
            copyFailed: '复制失败',
            gotIt: '我知道了'
        },
        en: {
            bannerTitle: 'Paying from Binance or another exchange?',
            bannerBody: 'Exchanges deduct a withdrawal fee from the amount you enter. The amount received must be exactly {amount}, or the payment will not be credited automatically.',
            bannerTip: 'Binance users: after entering the order amount, tap "Receive amount ⇋" at the bottom and Binance adds the fee for you.',
            bannerBtn: 'Binance withdrawal guide (with screenshots)',
            modalTitle: 'How to pay from Binance',
            modalLead: 'Follow these 6 steps and the payment will be credited automatically.',
            step1: 'Open the Binance app, go to Assets → Withdraw, choose <b>{currency}</b>, then "Send via crypto network" (do <b>not</b> use Send to Binance user or Binance Pay).',
            step2: 'Paste the receiving address:',
            step3: 'Select the network <b>{binanceNet}</b>. Funds sent on the wrong network cannot be recovered.',
            step4: 'Enter the order amount. "Receive amount" at the bottom is now slightly lower (the fee is deducted). <b>Tap ⇋ next to "Receive amount"</b>:',
            step5: 'A dialog shows the new details. Check that "Receive amount" equals the order amount and tap <b>Confirm</b>:',
            step6: 'The withdrawal amount now includes the fee and "Receive amount" equals the order amount exactly. Tap <b>Withdraw</b>:',
            imgNote: 'Screenshots use 10 USDT with a 0.01 fee as an example; use your own order amount.',
            img1Alt: 'After entering the amount, receive amount is short by the fee; tap the switch next to it',
            img2Alt: 'Dialog where receive amount equals the order amount; tap Confirm',
            img3Alt: 'Withdrawal amount now includes the fee and receive amount equals the order amount',
            otherExchange: 'Other exchanges (OKX, Bybit, …) work the same way: make sure the received amount equals the order amount before submitting. When paying from your own wallet (TokenPocket, imToken, MetaMask, …), send the order amount as-is.',
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

    function vars() {
        var amount = esc(ctx.amount), currency = esc(ctx.currency);
        return {
            amount: '<b>' + amount + ' ' + currency + '</b>',
            currency: currency,
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

    function shot(name, altKey) {
        return '<img class="xg-shot" loading="lazy" src="' + IMG + name + '.webp" alt="' + esc(tr(altKey)) + '" data-testid="exchange-guide-shot">';
    }

    function renderBanner(mountEl) {
        var v = vars();
        mountEl.innerHTML =
            '<div class="xg-banner" data-testid="exchange-guide-banner">' +
            '<div class="xg-banner-title">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
            '<span>' + tr('bannerTitle') + '</span></div>' +
            '<p class="xg-banner-body">' + tr('bannerBody', v) + '</p>' +
            '<p class="xg-banner-tip">' + tr('bannerTip') + '</p>' +
            '<button type="button" class="xg-banner-btn" id="xgOpenBtn">' + tr('bannerBtn') + ' →</button>' +
            '</div>';
        document.getElementById('xgOpenBtn').addEventListener('click', open);
    }

    function renderModal() {
        var v = vars();
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
            '<li>' + tr('step4', v) + copyRow(ctx.amount, ctx.currency) + shot('step1-enter', 'img1Alt') + '</li>' +
            '<li>' + tr('step5', v) + shot('step2-confirm', 'img2Alt') + '</li>' +
            '<li>' + tr('step6', v) + shot('step3-result', 'img3Alt') + '</li>' +
            '</ol>' +
            '<p class="xg-img-note">' + tr('imgNote') + '</p>' +
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
