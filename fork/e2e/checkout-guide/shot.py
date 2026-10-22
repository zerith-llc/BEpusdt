#!/usr/bin/env python3
"""收银台交易所提币引导 E2E：打开付款页，断言教程首次自动弹出、二次进入不再弹、横幅与复制按钮带订单金额/地址，并截图。

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
        expect(modal).to_be_visible()  # 首次进入自动弹出
        expect(modal.locator(f'[data-copy="{amount}"]')).to_have_count(1)
        expect(modal.locator(f'[data-copy="{address}"]')).to_have_count(1)
        expect(page.get_by_test_id("exchange-guide-mock")).to_contain_text(amount)
        page.wait_for_timeout(400)
        page.screenshot(path=f"{out}/{tag}-modal.png")
        modal.get_by_test_id("exchange-guide-mock").screenshot(path=f"{out}/{tag}-mock.png")

        modal.locator(".xg-got-it").click()
        expect(modal).to_be_hidden()
        banner = page.get_by_test_id("exchange-guide-banner")
        expect(banner).to_contain_text(amount)
        page.screenshot(path=f"{out}/{tag}-banner.png", full_page=True)

        page.reload()  # 同一订单再次进入不再自动弹出，横幅仍在，按钮能重新打开
        expect(page.get_by_test_id("exchange-guide-banner")).to_be_visible()
        page.wait_for_timeout(500)
        expect(modal).to_be_hidden()
        page.locator("#xgOpenBtn").click()
        expect(modal).to_be_visible()
        ctx.close()
    browser.close()
print(f"ok: screenshots in {out}")
