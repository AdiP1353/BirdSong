# Plan 014: Manual topology for the simulated mesh

## Status

- **Priority**: P2
- **Effort**: M
- **Depends on**: 004 (ether), 009/012 (hub), 013 (proxy)
- **Planned and executed**: 2026-11-14, in one session (this file records the design; there was no separate executor)

## Why

In the simulated mesh the ether decided who hears whom only by distance. To get a shape such as "node 0 hears only nodes 1 and 2", you had to move nodes around and tune `ETHER_RANGE`. Now you can list the links.

## Decisions

- The topology lives in the **ether** (the simulated air). Unlinked nodes do not hear each other at all, so they also cannot collide. Real-air nodes keep using the per-node `--neighbors` filter (no change).
- The ether owns the topology. The startup value comes from `ETHER_TOPOLOGY` (inline) or `ETHER_TOPOLOGY_FILE` (compose: `docker/topology.txt`). The mesh keeps working with the hub stopped.
- Live changes come **only from the hub** (the dashboard's Topology panel → `PUT /api/topology` → the ether's `PUT /topology` with `ETHER_CONTROL_TOKEN`). The Caddy proxy forwards only `/ether/listen`. With no token configured, the ether refuses every live change (403).
- The format is `0-1,2` (two-way, with comma shorthand), `4>5` (one-way: 5 hears 4), `#` comments, and whitespace, newline or `;` separators. No links = distance mode. In manual mode every link has gain `LINK_GAIN = 1`, and positions and range are ignored. The `/listen` mic still hears everyone.

## Files

- `packages/core/src/sim/topology.ts`: `parseTopology`, `formatTopology`, `hears`, `hasLinks`, `LINK_GAIN`. `sim/world.ts` has `topology` and `setTopology` (port indexes).
- `packages/core/src/telemetry.ts`: `TopologyView` and `HubToUi` `{ type: 'topology' }`.
- `packages/ether/src/server.ts`: an HTTP server shares the port with the WebSockets. `GET`/`PUT /topology`, `topologyFromEnv`, and the gain matrix by node id.
- `packages/dashboard/src/server/hub.ts`: `ETHER_CONTROL_URL` and `ETHER_CONTROL_TOKEN`, `GET`/`PUT /api/topology` (relay, log kind `topology`, broadcast to tabs), and `topologyEditable` in `/config.json`.
- `packages/dashboard/src/components/Topology.tsx`, `hubClient.ts`, `app.tsx`, `styles.css`.
- `docker/topology.txt`, `docker/compose.sim.yml`, `docker/Caddyfile`, README section 3 "Choosing the topology", README section 7, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`.

## Verification (done)

- `npm run typecheck` is clean. `npm test`: 46 files, 270 passed, 1 skipped. `npm run test:e2e`: 7 passed (new case 6: a manual topology forces a relay through node 0 between two nodes that are in range). `bash scripts/smoke-ether.sh` ok.
- Natively: ether `ETHER_TOPOLOGY='1-2'` and nodes at x=0 and x=5 (out of range). The message was delivered. A PUT without a token returned 401. A PUT with the token changed the topology.
- With Docker (`sim-up.sh`; the known parallel-build race needed `docker compose up -d` without `--build`):
  - Results through the proxy: `/ether/topology` returned 404 for both GET and PUT.
  - The dashboard Topology panel applied `0-1 1-2 2-3 3-7 7-6 6-5 5-4`. The ether log and the hub's `/api/log` both recorded it.
  - A message from node 0 then reached node 4 at **7 hops** (1, 2, 3, 4, 5, 6, 7 along the line) in 57 s, **with the hub stopped**.
  - After the hub restarted, the panel loaded the live topology again. "Use distance" switched the ether back to distance mode.
