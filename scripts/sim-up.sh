#!/usr/bin/env bash
# Build and start the simulated 8-node mesh with the dashboard.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose -f docker/compose.sim.yml up --build -d
echo "Dashboard:  http://localhost:7070"
for i in 0 1 2 3 4 5 6 7; do echo "Node $i UI:  http://localhost:808$i/?runtime=remote"; done
