#!/usr/bin/env bash
# 并排跑上游 / fork 两个 BEpusdt，同一时段扫 BSC，对比 RPC 用量与扫到的入账。
# 用法: run.sh <upstream_binary> <fork_binary> [秒数=180] [rpc=https://bsc-rpc.publicnode.com] [钱包=币安热钱包]
# 产物: $OUT/report.md（默认 OUT=/tmp/bep-rpc-cost）
set -euo pipefail
UP_BIN=$1 FORK_BIN=$2 SECS=${3:-180} RPC=${4:-https://bsc-rpc.publicnode.com}
WALLET=${5:-0x8894e0a0c962cb723c1976a4421c95949be2d4e3}
USDT=0x55d398326f99059ff775485246999027b3197955
OUT=${OUT:-/tmp/bep-rpc-cost}
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$OUT" && mkdir -p "$OUT"
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT

start_one() { # name bin proxy_port web_port
  local d=$OUT/$1
  mkdir -p "$d/log"
  python3 "$HERE/proxy.py" "$3" "$RPC" "$d/rpc.json" "$WALLET" "$USDT" & pids+=($!)
  # 第一次启动只为建表
  "$2" start --sqlite "$d/sqlite.db" --log "$d/log/" --listen "127.0.0.1:$4" >"$d/init.out" 2>&1 & local p=$!
  for _ in $(seq 30); do sqlite3 "$d/sqlite.db" "select 1 from bep_order limit 1" >/dev/null 2>&1 && break; sleep 1; done
  kill $p 2>/dev/null || true; wait $p 2>/dev/null || true
  # 与 glebarez/sqlite 写入格式一致（本地时区、带偏移），否则字符串比较失效
  local exp; exp=$(python3 -c 'import datetime as d; print((d.datetime.now().astimezone() + d.timedelta(hours=2)).isoformat(sep=" ", timespec="seconds"))')
  sqlite3 "$d/sqlite.db" <<SQL
insert or replace into bep_conf(k, v) values ('rpc_endpoint_bsc', 'http://127.0.0.1:$3');
insert into bep_wallet(name, status, address, match_addr, trade_type, other_notify, remark, created_at, updated_at)
  values ('e2e', 1, '$WALLET', '$WALLET', '${TRADE:-usdt.bep20}', 0, '', datetime('now'), datetime('now'));
insert into bep_order(order_id, trade_id, trade_type, fiat, crypto, rate, amount, money, address, match_address, status, expired_at, confirmed_at, created_at, updated_at)
  values ('e2e-1', 'e2e-1', '${TRADE:-usdt.bep20}', 'USD', 'USDT', '1', '123.4567', '123.4567', '$WALLET', '$WALLET', 1, '$exp', '$exp', datetime('now'), datetime('now'));
SQL
  "$2" start --sqlite "$d/sqlite.db" --log "$d/log/" --listen "127.0.0.1:$4" >"$d/run.out" 2>&1 & pids+=($!)
}

start_one upstream "$UP_BIN" 18601 18611
start_one fork "$FORK_BIN" 18602 18612
echo "running ${SECS}s ..."
sleep "$SECS"
kill "${pids[@]}" 2>/dev/null || true
python3 "$HERE/report.py" "$OUT" "$SECS" "$WALLET" | tee "$OUT/report.md"
