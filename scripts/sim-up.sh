#!/usr/bin/env bash
# Build and start the simulated 8-node mesh. Host ports: 3200 (hub) and 3100 (proxy).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs   # created by you, not root, before Docker bind-mounts it
docker compose -f docker/compose.sim.yml up --build -d
echo "Dashboard:        http://localhost:3200"
echo "Interaction log:  http://localhost:3200/api/log  (file: logs/interactions.ndjson)"
for i in 0 1 2 3 4 5 6 7; do
  echo "Node $i page:      http://localhost:3100/nodes/$i/   (API: http://localhost:3100/nodes/$i/api/state)"
done
