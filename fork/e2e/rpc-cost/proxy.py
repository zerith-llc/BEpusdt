#!/usr/bin/env python3
"""计数 RPC 代理：转发 JSON-RPC 到上游节点，按方法记录调用次数 / CU 估算 / 响应字节，
并记下 eth_getLogs 返回中命中目标钱包的 USDT 转账哈希（用于核对两个版本扫到的入账是否一致）。

用法: proxy.py <listen_port> <upstream_url> <out_json> <wallet_lower> <contract_lower>
"""
import json
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# CU 按常见 RPC 服务商的公开计价估算
CU = {"eth_blockNumber": 5, "eth_getBlockByNumber": 15, "eth_getLogs": 50, "eth_getTransactionReceipt": 15}

port, upstream, out, wallet, contract = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
wallet_topic = "0x" + "0" * 24 + wallet[2:]
lock = threading.Lock()
stats = {"methods": {}, "cu": 0, "bytes": 0, "hits": []}


def record(method, nbytes):
    m = stats["methods"].setdefault(method, {"calls": 0, "cu": 0, "bytes": 0})
    m["calls"] += 1
    m["cu"] += CU.get(method, 0)
    stats["cu"] += CU.get(method, 0)
    m["bytes"] += nbytes
    stats["bytes"] += nbytes


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        req = urllib.request.Request(upstream, data=body, headers={"Content-Type": "application/json", "User-Agent": "rpc-cost-proxy"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
        except Exception as e:  # 上游失败照样回给客户端，客户端会重试
            self.send_response(502)
            self.end_headers()
            self.wfile.write(str(e).encode())
            return

        parsed = json.loads(body)
        calls = parsed if isinstance(parsed, list) else [parsed]
        with lock:
            for i, c in enumerate(calls):
                record(c["method"], len(data) if i == 0 else 0)
            resp = json.loads(data)
            for c, rsp in zip(calls, resp if isinstance(resp, list) else [resp]):
                if c["method"] != "eth_getLogs" or not isinstance(rsp.get("result"), list):
                    continue
                for lg in rsp["result"]:
                    t = lg.get("topics", [])
                    if lg.get("address", "").lower() == contract and len(t) >= 3 and t[2].lower() == wallet_topic:
                        stats["hits"].append([int(lg["blockNumber"], 16), lg["transactionHash"]])
            with open(out, "w") as f:
                json.dump(stats, f, indent=1)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
