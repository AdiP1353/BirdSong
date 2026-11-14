#!/usr/bin/env bash
# Starts the ether and two ether-audio nodes, sends a message, and waits for it to arrive.
set -uo pipefail
cd "$(dirname "$0")/.."
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; }
trap cleanup EXIT

ETHER_NOISE_RMS=0.002 node packages/ether/src/server.ts &
pids+=($!)
ok=0
for _ in $(seq 50); do
  if bash -c '</dev/tcp/127.0.0.1/7080' 2>/dev/null; then ok=1; break; fi
  sleep 0.2
done
[ "$ok" = 1 ] || { echo "ether did not start" >&2; exit 1; }

node packages/node-runtime/src/main.ts --audio ether --id 1 --x 0 --key smoke --env quiet --port 8081 &
pids+=($!)
node packages/node-runtime/src/main.ts --audio ether --id 2 --x 1 --key smoke --env quiet --port 8082 &
pids+=($!)
for port in 8081 8082; do
  ok=0
  for _ in $(seq 100); do
    if curl -sf "localhost:$port/api/state" >/dev/null; then ok=1; break; fi
    sleep 0.2
  done
  [ "$ok" = 1 ] || { echo "node on $port did not start" >&2; exit 1; }
done

curl -s -XPOST -H 'Content-Type: application/json' localhost:8081/api/send -d '{"text":"hello from one"}'
echo
for _ in $(seq 30); do
  if curl -s localhost:8082/api/state | grep -q '"hello from one"'; then echo "smoke ok"; exit 0; fi
  sleep 2
done
echo "smoke timeout" >&2
exit 1
