#!/usr/bin/env python3
"""收银台交易所提币引导 E2E：打开付款页，断言教程不自动弹出、点横幅按钮才弹、横幅与复制按钮带订单金额/地址、币安截图加载成功，并截图。

用法: shot.py <base_url> <trade_id> <out_dir>   （需要一个已选好币种网络、处于待支付状态的订单）
"""
import sys
from playwright.sync_api import expect, sync_playwright

base, trade_id, out = sys.argv[1], sys.argv[2], sys.argv[3]
url = f"{base}/pay/checkout/{trade_id}"

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=__import__("os").environ.get("CHROME_PATH"))
    for locale in ("zh-CN", "en-US"):
        tag = locale[:2]
        ctx = browser.new_context(locale=locale, viewport={"width": 390, "height": 844}, device_scale_factor=2)
        page = ctx.new_page()
        page.goto(url)

        amount = page.locator("#payAmountQ").inner_text().split(" ")[0]
        address = page.locator("#walletAddress").inner_text().strip()
        modal = page.get_by_test_id("exchange-guide-modal")
        banner = page.get_by_test_id("exchange-guide-banner")
        expect(banner).to_contain_text(amount)
        page.wait_for_timeout(500)
        expect(modal).to_have_count(0)  # 进入付款页不自动弹出
        page.screenshot(path=f"{out}/{tag}-banner.png", full_page=True)
        page.locator("#xgOpenBtn").click()
        expect(modal).to_be_visible()
        expect(modal.locator(f'[data-copy="{amount}"]')).to_have_count(1)
        expect(modal.locator(f'[data-copy="{address}"]')).to_have_count(1)
        shots = modal.get_by_test_id("exchange-guide-shot")
        expect(shots).to_have_count(3)
        for i in range(3):  # 币安截图都加载成功
            shots.nth(i).scroll_into_view_if_needed()
            page.wait_for_function("img => img.complete && img.naturalWidth > 0", arg=shots.nth(i).element_handle())
        page.locator(".xg-modal-body").evaluate("el => el.scrollTop = 0")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{out}/{tag}-modal.png")
        # 整个弹窗内容的长图，方便审阅
        body = page.locator(".xg-modal-body")
        body.evaluate("el => { el.style.maxHeight = 'none'; el.closest('.xg-modal-card').style.maxHeight = 'none'; el.closest('.modal-overlay').style.position = 'absolute'; }")
        modal.locator(".xg-modal-card").screenshot(path=f"{out}/{tag}-modal-full.png")
        body.evaluate("el => { el.style.maxHeight = ''; el.closest('.xg-modal-card').style.maxHeight = ''; el.closest('.modal-overlay').style.position = ''; }")

        modal.locator(".xg-got-it").click()
        expect(modal).to_be_hidden()
        page.locator("#xgOpenBtn").click()  # 关掉后还能再打开
        expect(modal).to_be_visible()
        ctx.close()
    browser.close()
print(f"ok: screenshots in {out}")
