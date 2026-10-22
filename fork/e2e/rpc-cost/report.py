#!/usr/bin/env python3
"""汇总 run.sh 两边的 rpc.json，输出 Markdown 报告；fork 漏掉上游扫到的入账时退出码非 0。"""
import json
import sys

out, secs, wallet = sys.argv[1], int(sys.argv[2]), sys.argv[3]
up = json.load(open(f"{out}/upstream/rpc.json"))
fk = json.load(open(f"{out}/fork/rpc.json"))

print(f"# BEpusdt BSC 扫块 RPC 用量对比（{secs}s，1 个待支付 USDT 订单，钱包 `{wallet}`）\n")
print("| 方法 | 上游 次数 | 上游 CU | fork 次数 | fork CU |")
print("|---|---:|---:|---:|---:|")
for m in sorted(set(up["methods"]) | set(fk["methods"])):
    a, b = up["methods"].get(m, {}), fk["methods"].get(m, {})
    print(f"| {m} | {a.get('calls', 0)} | {a.get('cu', 0)} | {b.get('calls', 0)} | {b.get('cu', 0)} |")
print(f"| **合计** | | **{up['cu']}** | | **{fk['cu']}** |")
ratio = up["cu"] / fk["cu"] if fk["cu"] else float("inf")
print(f"\n- CU：{up['cu']} → {fk['cu']}（约 1/{ratio:.1f}）；折算每小时 {up['cu'] * 3600 // secs} → {fk['cu'] * 3600 // secs}")
print(f"- 入站流量：{up['bytes'] / 1e6:.1f} MB → {fk['bytes'] / 1e6:.3f} MB")

# 只在两边都扫过的区块区间内核对入账
uh, fh = {tuple(h) for h in up["hits"]}, {tuple(h) for h in fk["hits"]}
if uh and fh:
    lo = max(min(b for b, _ in uh), min(b for b, _ in fh))
    hi = min(max(b for b, _ in uh), max(b for b, _ in fh))
    us = {t for b, t in uh if lo <= b <= hi}
    fs = {t for b, t in fh if lo <= b <= hi}
    missing = us - fs
    print(f"- 入账核对（区块 {lo}–{hi}）：上游扫到 {len(us)} 笔、fork 扫到 {len(fs)} 笔、fork 漏掉 {len(missing)} 笔")
    sys.exit(1 if missing else 0)
print(f"- 入账核对：样本不足（上游 {len(uh)} 笔 / fork {len(fh)} 笔），换个更活跃的钱包或拉长时间")
sys.exit(2)
