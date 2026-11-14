# Plan 013: The simulated mesh publishes only ports 3100 (proxy) and 3200 (hub), and the docs say so

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ff670cc..HEAD -- docker scripts/sim-up.sh packages/node-runtime/src/config.ts .gitignore .dockerignore README.md docs/RUNBOOK.md docs/ARCHITECTURE.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Prerequisite check (run second)**: `grep -n "HUB_PORT = 3200" packages/core/src/telemetry.ts && grep -n "nodeBaseFromLocation" packages/web/src/app.tsx && grep -n "BIRDSONG_URL" packages/node-runtime/src/cli.ts && grep -n "HUB_LOG_FILE" packages/dashboard/src/server/hub.ts`
> All four must print a match (plans 011 and 012 are DONE). If any is
> missing, STOP: this plan depends on them.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (changes how the demo fallback starts; needs Docker to verify fully)
- **Depends on**: `plans/011-path-aware-node-page.md`, `plans/012-hub-serves-app-and-logs-interactions.md`
- **Category**: tech-debt / docs
- **Planned at**: commit `ff670cc`, 2026-11-14

## Why this matters

`bash scripts/sim-up.sh` starts 10 containers (ether, hub, bird0–bird7) from
`docker/compose.sim.yml` and publishes ten host ports: ether 7080, hub 7070,
nodes 8080–8087. The goal is two host ports:

| Port | Process | Serves |
|---|---|---|
| 3100 | `proxy` (Caddy 2, new) | `/nodes/<id>/*` → `bird<id>:8080` with the prefix stripped (WebSocket upgrades kept); `/ether/*` → `ether:7080` |
| 3200 | `hub` | dashboard `/`, phone/node app `/app/`, WebSockets `/node` and `/ui`, `/config.json`, `/api/log` (interaction log) |
| none | `ether`, `bird0..7` | internal only: they reach each other by service name on the compose network |

Plans 011 and 012 already made the code ready: the node page works under a
path prefix, the CLI accepts `BIRDSONG_URL`, and the hub listens on 3200 by
default, serves `/app/`, writes an NDJSON interaction log when
`HUB_LOG_FILE` is set and tells the dashboard the proxy address from `PROXY_URL`.
This plan changes the compose file, adds the proxy config, updates the
start script and rewrites every doc reference to the old ports.

**Scope note:** real laptop nodes (`scripts/run-node.sh`, host networking)
are not behind the proxy. They still serve their own page on `--port`
(default 8080). Only their `--observatory` URL changes, from `:7070` to `:3200`.

## Current state

### `docker/compose.sim.yml` (64 lines) — today (abridged: the file writes out all eight bird services; the `# bird1..bird7` comment below is a summary, not a line in the file)

```yaml
# Simulated 8-node mesh. Start with: bash scripts/sim-up.sh
x-node: &node
  image: birdsong-node
  build:
    context: ..
    dockerfile: docker/Dockerfile.node
  depends_on: [ether, hub]
  restart: on-failure

services:
  ether:
    image: birdsong-node
    build:
      context: ..
      dockerfile: docker/Dockerfile.node
    entrypoint: ["node", "packages/ether/src/server.ts"]
    environment:
      ETHER_PORT: "7080"
      ETHER_RANGE: "1.5"
      ETHER_NOISE_RMS: "0.002"
    ports: ["7080:7080"]
  hub:
    image: birdsong-node
    build:
      context: ..
      dockerfile: docker/Dockerfile.node
    entrypoint: ["node", "packages/dashboard/src/server/hub.ts"]
    environment:
      HUB_PORT: "7070"
      CHANNEL_PASSPHRASE: demo-flock
      ETHER_URL: ws://localhost:7080
    ports: ["7070:7070"]
  bird0:
    <<: *node
    command: ["--audio", "ether", "--ether", "ws://ether:7080", "--observatory", "ws://hub:7070", "--key", "demo-flock", "--env", "quiet", "--id", "0", "--x", "0", "--y", "0", "--port", "8080"]
    ports: ["8080:8080"]
  # bird1..bird7 are identical except --id N, --x/--y and ports "808N:8080".
  # Positions: 1 (1,0) 2 (2,0) 3 (3,0) 4 (0,1) 5 (1,1) 6 (2,1) 7 (3,1).
```

Facts the new file relies on:
- The hub's `ETHER_URL` and `PROXY_URL` are **browser-facing** (the dashboard
  page opens them from the host), so they use `localhost:3100`, not service names.
- The dashboard's Listen button opens `${ETHER_URL}/listen?x=…` and the ether
  server matches `url.pathname === '/listen'` (`packages/ether/src/server.ts:55`),
  so `ws://localhost:3100/ether` plus prefix stripping works unchanged.
- Nodes send telemetry to `${observatory}/node` (`packages/node-runtime/src/telemetry.ts:10`).
- Inside the image the repo is at `/app`; the hub's default web-app directory
  is `/app/packages/web/dist`, which `docker/Dockerfile.node` already builds. No `WEB_DIST` needed.
- The hub creates the log file's directory itself.

### `scripts/sim-up.sh` — today

```bash
#!/usr/bin/env bash
# Build and start the simulated 8-node mesh with the dashboard.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose -f docker/compose.sim.yml up --build -d
echo "Dashboard:  http://localhost:7070"
for i in 0 1 2 3 4 5 6 7; do echo "Node $i UI:  http://localhost:808$i/?runtime=remote"; done
```

### `packages/node-runtime/src/config.ts` line 37 (help text only)

```
  --observatory <url>    BIRDSONG_OBSERVATORY  dashboard hub base URL, e.g. ws://hub:7070
```

### `.gitignore` — today

```
node_modules/
dist/
.vite/
*.log
.DS_Store
.claude/settings.local.json
```

(`*.log` does not match `interactions.ndjson`.)

### Doc lines that name the old ports (from `grep -rnE "7070|7080|808[0-7]|5180" README.md docs`)

- `README.md` §3 Quick start: 43 (dashboard at 7070), 45 (node 0 page at 8080), 48 (curl 8080 send), 54 (curl 8087 state).
- `README.md` §4 Real node: 91 (`--observatory` example `ws://192.168.1.10:7070`), 102 (node page 8080 — **keep**, real node), 104 (`--observatory ws://<HUB_IP>:7070`, `ws://localhost:7070`), 107–111 (build + start hub).
- `README.md` §6 Using a node: 170 (node page 8080 — keep, but add a sentence about the simulated mesh), 174 (CLI port 8080 — keep, add `BIRDSONG_URL`), 195 (`BIRDSONG_PORT=8081 … inbox`).
- `README.md` §7 Dashboard: 211 (7070).
- `README.md` §11 Troubleshooting: 281 (8080 — keep, real laptop), 286 (7070), 287 (7070), 288 (5180).
- `README.md` §13 Known limitations: 327 ("builds all ten services"), 329 (5180).
- `docs/RUNBOOK.md`: 17, 26, 38, 40, 43–45 (7070); 48, 56, 67 (8080 real laptop — keep); 66 (sim fallback: 7070, 8080–8087, curl 8080).
- `docs/ARCHITECTURE.md`: 36 (node UI port 8080 — keep), 38 (hub port 7070).
- `docs/PROTOCOL.md`, `docs/DEVPOST.md`, `docs/PITCH.md`: no port numbers. Do not edit.

**Important doc fact:** phones need HTTPS (a secure context) for the
microphone. `http://localhost:3200/app/` only works in a browser on the hub
machine itself, and `http://<LAN-IP>:3200/app/` will not get the microphone on
a phone. So phones still join through the HTTPS Pages URL (`PWA_URL=<PAGES_URL>`).
The hub's `/app/` is for controlling container nodes from a laptop browser.
Write the docs that way; do not claim the hub replaces the Pages deploy.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Docker available? | `docker info >/dev/null && echo ok` | `ok` |
| Compose parses | `docker compose -f docker/compose.sim.yml config -q` | exit 0, no output |
| Caddyfile valid | `docker run --rm -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` | last line contains `Valid configuration` |
| Build image | `docker build -f docker/Dockerfile.node -t birdsong-node .` | exit 0 |
| Start mesh | `bash scripts/sim-up.sh` | prints the URLs |
| Stop mesh | `docker compose -f docker/compose.sim.yml down` | exit 0 |
| Unit tests | `npm test` | all pass |

## Scope

**In scope** (the only files you should modify or create):
- `docker/compose.sim.yml`
- `docker/Caddyfile` (create)
- `scripts/sim-up.sh`
- `packages/node-runtime/src/config.ts` (line 37 help text only)
- `.gitignore`
- `.dockerignore`
- `README.md`
- `docs/RUNBOOK.md`
- `docs/ARCHITECTURE.md`

**Out of scope** (do NOT touch):
- `docker/Dockerfile.node` — it already builds `packages/web/dist`.
- `scripts/smoke-ether.sh` — it starts its own processes on 7080/8081/8082, not compose.
- `scripts/run-node.sh` — real laptop nodes keep their own port.
- Any `packages/**/src` file except the one help-text line — plans 011/012 own the code.
- `docs/PROTOCOL.md`, `docs/DEVPOST.md`, `docs/PITCH.md` — no port references.
- The ether's internal port 7080 and the nodes' internal port 8080 — keep them.

## Git workflow

- Work on the current branch; commit only your paths:
  `git add <paths> && git commit -m "<message>" -- <paths>`.
- Suggested commits: `feat(docker): two public ports, Caddy proxy for nodes and ether` and `docs: two-port layout (3100 proxy, 3200 hub)`.
- Do NOT push. Do not commit `logs/`.

## Steps

### Step 1: Create `docker/Caddyfile`

Write exactly this (eight node blocks, written out; do not use placeholders in upstream addresses):

```caddyfile
# Reverse proxy for the simulated mesh (docker/compose.sim.yml).
# Port 3100 is the only host port that reaches the nodes and the ether.
# Keep the port in sync with PROXY_PORT in packages/core/src/telemetry.ts.
{
	admin off
	auto_https off
}

:3100 {
	redir /nodes/0 /nodes/0/ 308
	handle_path /nodes/0/* {
		reverse_proxy bird0:8080
	}
	redir /nodes/1 /nodes/1/ 308
	handle_path /nodes/1/* {
		reverse_proxy bird1:8080
	}
	redir /nodes/2 /nodes/2/ 308
	handle_path /nodes/2/* {
		reverse_proxy bird2:8080
	}
	redir /nodes/3 /nodes/3/ 308
	handle_path /nodes/3/* {
		reverse_proxy bird3:8080
	}
	redir /nodes/4 /nodes/4/ 308
	handle_path /nodes/4/* {
		reverse_proxy bird4:8080
	}
	redir /nodes/5 /nodes/5/ 308
	handle_path /nodes/5/* {
		reverse_proxy bird5:8080
	}
	redir /nodes/6 /nodes/6/ 308
	handle_path /nodes/6/* {
		reverse_proxy bird6:8080
	}
	redir /nodes/7 /nodes/7/ 308
	handle_path /nodes/7/* {
		reverse_proxy bird7:8080
	}
	redir /ether /ether/ 308
	handle_path /ether/* {
		reverse_proxy ether:7080
	}
	handle {
		respond "BirdSong proxy. Nodes: /nodes/0/ to /nodes/7/. Simulated air: /ether/listen (WebSocket). Dashboard: port 3200." 404
	}
}
```

Why: `handle_path` strips the matched prefix, so node 3 receives `/`,
`/api/state`, `/api/events`; Caddy proxies WebSocket upgrades by default.
`/nodes/3` without a slash does not match `/nodes/3/*`, hence the `redir`.

**Verify**: the "Caddyfile valid" command → `Valid configuration`. If Docker is
not available, STOP here (see STOP conditions).

### Step 2: Rewrite `docker/compose.sim.yml`

Make these changes and nothing else:

1. Header comment, replace line 1 with:
   ```yaml
   # Simulated 8-node mesh. Start with: bash scripts/sim-up.sh
   # Published on the host: 3200 = hub (dashboard, node app /app/, /api/log), 3100 = proxy (/nodes/<id>/, /ether/).
   # The ether and the nodes publish no ports; they reach each other by service name.
   ```
2. `ether`: delete the `ports:` line. Keep `ETHER_PORT: "7080"`.
3. `hub`: set the environment and ports to:
   ```yaml
       environment:
         HUB_PORT: "3200"
         CHANNEL_PASSPHRASE: demo-flock
         # Browser-facing URLs (opened by the dashboard page on the host):
         ETHER_URL: ws://localhost:3100/ether
         PROXY_URL: http://localhost:3100
         HUB_LOG_FILE: /app/logs/interactions.ndjson
       volumes: ["../logs:/app/logs"]
       ports: ["3200:3200"]
   ```
4. Every `bird0`…`bird7`: in `command`, change `"ws://hub:7070"` to `"ws://hub:3200"`; delete the `ports:` line. Keep `"--port", "8080"` and everything else.
5. Add a new service after `hub`:
   ```yaml
     proxy:
       image: caddy:2
       volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro"]
       ports: ["3100:3100"]
       depends_on: [ether, bird0, bird1, bird2, bird3, bird4, bird5, bird6, bird7]
   ```
   (Compose resolves `./Caddyfile` and `../logs` relative to the compose file's directory, `docker/`.)

**Verify**:
- `docker compose -f docker/compose.sim.yml config -q` → exit 0
- `grep -cE '^\s*ports:' docker/compose.sim.yml` → `2`
- `grep -c "ws://hub:3200" docker/compose.sim.yml` → `8`
- `grep -n "7070" docker/compose.sim.yml` → no output

### Step 3: `scripts/sim-up.sh` and `.gitignore`

Replace the body after `cd "$(dirname "$0")/.."` with:

```bash
mkdir -p logs   # created by you, not root, before Docker bind-mounts it
docker compose -f docker/compose.sim.yml up --build -d
echo "Dashboard:        http://localhost:3200"
echo "Interaction log:  http://localhost:3200/api/log  (file: logs/interactions.ndjson)"
for i in 0 1 2 3 4 5 6 7; do
  echo "Node $i page:      http://localhost:3100/nodes/$i/   (API: http://localhost:3100/nodes/$i/api/state)"
done
```

Update the comment on line 2 to mention the two ports. Append `logs/` to `.gitignore`.
Append `logs` to `.dockerignore`. Without it, `COPY . .` in the Dockerfile
copies `logs/interactions.ndjson`, which holds message plaintext, into the
image on the next build. `.dockerignore` today:
`node_modules`, `**/node_modules`, `**/dist`, `.git`, `samples`, `plans` (one per line).

**Verify**: `bash -n scripts/sim-up.sh` → exit 0; `grep -n "^logs/$" .gitignore` → 1 match; `grep -n "^logs$" .dockerignore` → 1 match.

### Step 4: Help text

In `packages/node-runtime/src/config.ts` line 37 change `e.g. ws://hub:7070` to `e.g. ws://hub:3200`.

**Verify**: `npx vitest run packages/node-runtime` → all pass; `grep -rn 7070 packages/*/src` → no output.

### Step 5: Live check (needs Docker)

```bash
docker build -f docker/Dockerfile.node -t birdsong-node .
bash scripts/sim-up.sh
sleep 15
docker compose -f docker/compose.sim.yml ps --format '{{.Service}} {{.Ports}}'
```

Then run each check. The expected output is in the comment after each command.
Status codes alone are not enough for the pages: the hub serves a "not built"
notice with HTTP 200, and the Dockerfile builds with `|| true`, so check the bodies.

```bash
# 1. Only two published ports → exactly two lines: 3100-> and 3200->
docker compose -f docker/compose.sim.yml ps --format '{{.Ports}}' | grep -o '[0-9]*->' | sort -u
# 2. Node API via proxy → JSON starting {"id":3
curl -s localhost:3100/nodes/3/api/state | head -c 80; echo
# 3. Redirect stays under the prefix → Location: ?runtime=remote (header name in any case)
curl -sI localhost:3100/nodes/3/ | grep -i '^location'
# 4. Bare prefix redirect → 308
curl -s -o /dev/null -w '%{http_code}\n' localhost:3100/nodes/3
# 5. Node page via proxy → 1
curl -s 'localhost:3100/nodes/3/?runtime=remote' | grep -c '<div id="app">'
# 6. Hub dashboard is the real build → 0
curl -s localhost:3200/ | grep -c 'not built'
# 7. Hub app is the real build → 1
curl -s localhost:3200/app/ | grep -c '<div id="app">'
# 8. Hub config → {"etherUrl":"ws://localhost:3100/ether","proxyUrl":"http://localhost:3100"}
curl -s localhost:3200/config.json; echo
# 9. Old ports closed → no output (stop any real node on 8080 on this machine first)
ss -ltn | grep -E ':(7070|7080|808[0-7])\b'
```

Then the end-to-end message:

```bash
curl -s -X POST localhost:3100/nodes/0/api/send -H 'Content-Type: application/json' -d '{"text":"hello flock"}'
for _ in $(seq 30); do curl -s localhost:3100/nodes/7/api/state | grep -q '"hello flock"' && { echo delivered; break; }; sleep 2; done
grep -c '"decoded"' logs/interactions.ndjson
curl -s 'localhost:3200/api/log?limit=2000' | grep -o '"type":"decoded"' | wc -l
```

**Verify**: prints `delivered` (previously ~25 s); both counts ≥ 1.

Optional, if you have a browser tool: open `http://localhost:3200`. Expect 8
nodes online, a "Node pages" panel whose `node 2` link opens a live node page,
and "Listen to the simulated air" connecting (the hub logs nothing for it;
check `docker compose -f docker/compose.sim.yml logs ether | grep "listener connected"`).

Leave the mesh running only if the operator asked; otherwise
`docker compose -f docker/compose.sim.yml down`.

### Step 6: Update the docs

Apply these edits. Keep the documents' existing style (short sentences,
fenced `bash` blocks with one command each, links as `<http://…>`).

**README.md**
- §3 Quick start: dashboard → <http://localhost:3200>. Node 0's page → <http://localhost:3100/nodes/0/>. Curl send → `curl -X POST localhost:3100/nodes/0/api/send …`. Node 7 state → `curl -s localhost:3100/nodes/7/api/state`. Add one short paragraph after the stop command: the mesh publishes two ports, 3200 (hub: dashboard, node app at `/app/`, interaction log at `/api/log` and `logs/interactions.ndjson`) and 3100 (proxy: `/nodes/<id>/` and `/ether/`).
- §4 Real node: `--observatory` examples → `:3200` (line 91 table and line 104). Before the hub start command, add `npm run build -w @birdsong/web` (the hub also serves the node app at `/app/`). Keep `PWA_URL=<PAGES_URL>` (phones need HTTPS). Keep the node page at 8080.
- §6 Using a node: after the local-page paragraph, add: "In the simulated mesh, node N's page is <http://localhost:3100/nodes/N/>; the dashboard's **Node pages** panel links to each one." Change the `BIRDSONG_PORT=8081` example to `BIRDSONG_URL=http://localhost:3100/nodes/1 node packages/node-runtime/src/cli.ts inbox` and say `BIRDSONG_URL` overrides `BIRDSONG_PORT`.
- §7 Dashboard: 7070 → 3200; add a bullet for the **Node pages** panel and one for the interaction log (`GET /api/log?since=<seq>&limit=<n>` returns `{ entries, next }`; each entry is `{ seq, t, kind: event|command|offline, data }`; the file rotates to `.1` at 10 MiB).
- §11 Troubleshooting: 7070 → 3200 (two lines). Line 288: the QR defaults to `http://localhost:3200/app/` when `PWA_URL` is unset, which only works on the hub machine; phones need the HTTPS Pages URL.
- §13 Known limitations: line 327 — the build is ten services from one image plus the `caddy:2` proxy image (pulled). Line 329 — replace the `5180` sentence with the same `/app/` vs. HTTPS note.

**docs/RUNBOOK.md**
- Every `7070` → `3200` (lines 17, 26, 38, 40, 43–45).
- Line 66 (sim fallback): dashboard `http://localhost:3200`; node pages `http://localhost:3100/nodes/0/` to `/nodes/7/`; curl `localhost:3100/nodes/0/api/send`; the Listen button now goes through `ws://localhost:3100/ether/listen`.
- Lines 48, 56, 67 (real laptop page at 8080): keep.

**docs/ARCHITECTURE.md**
- Line 38: `port 7070` → `port 3200; also serves the node app at /app/ and the interaction log`.
- Add a short "Ports (simulated mesh)" table under the package table: 3100 proxy, 3200 hub, internal-only ether 7080 and nodes 8080.

**Verify**:
- `grep -rn "7070\|5180" README.md docs scripts docker` → no output
- `grep -nE "808[1-7]" README.md docs/RUNBOOK.md docs/ARCHITECTURE.md` → no output
- `grep -c "3100/nodes" README.md` → ≥ 3; `grep -c "3200" docs/RUNBOOK.md` → ≥ 6

### Step 7: Regression

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass; `bash scripts/smoke-ether.sh` → `smoke ok`.

## Test plan

No new unit tests: this plan changes configuration and docs. The checks are
the compose/Caddy validation (steps 1–2) and the live table in step 5, which
covers every route the proxy and hub must serve. `scripts/smoke-ether.sh`
guards the native (non-Docker) path.

## Done criteria

- [ ] Caddy validate prints `Valid configuration`; `docker compose … config -q` exits 0
- [ ] `grep -cE '^\s*ports:' docker/compose.sim.yml` → `2`
- [ ] `grep -n "^logs$" .dockerignore` → 1 match
- [ ] Every step 5 check matches its comment, `delivered` printed, decoded count ≥ 1 in file and API
- [ ] `grep -rn "7070\|5180" README.md docs scripts docker packages/*/src` → no output
- [ ] `npm run typecheck` exits 0, `npm test` passes, `bash scripts/smoke-ether.sh` prints `smoke ok`
- [ ] `git status --short logs` shows nothing (ignored); `git log -2 --name-only` lists only in-scope files
- [ ] `plans/README.md` row 013 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The prerequisite check fails (plans 011/012 not DONE).
- `docker info` fails. Then do steps 2 (except Caddy-dependent checks), 3, 4 and 6, run
  `docker compose -f docker/compose.sim.yml config -q`, commit, set the row to
  `BLOCKED (docker daemon not running; config, scripts and docs done, live checks not run)`, and stop.
  Do not try to start the daemon.
- `caddy validate` rejects the file twice after fixing typos.
- `curl localhost:3100/nodes/3/api/state` returns 502: the proxy cannot reach `bird3`.
  Check `docker compose … ps` and `logs bird3`, report what you find.
- The node page loads at `/nodes/3/` but shows "Connecting..." forever: the
  plan 011 base-URL fix is not in the image. Rebuild the image once (`docker build …`); if it persists, report.
- The message does not reach node 7 within 60 s twice in a row (it did in ~25 s before this change).

## Maintenance notes

- Adding a node to the simulated mesh now needs three edits: a `birdN` service
  in compose, a `redir`/`handle_path` pair in `docker/Caddyfile`, and the
  `depends_on` list of `proxy`. `sim-up.sh` prints 0–7; update its loop too.
- `logs/interactions.ndjson` is written by root inside the container; the
  `logs/` directory is created by `sim-up.sh` as the user, so the file is
  readable but deleting it may need `sudo` or `docker compose … down` first.
- Real laptop nodes are not reachable through 3100. A later change could add
  an `--advertise <url>` flag so the hub learns each node's public URL.
- Caddy is pinned to the `caddy:2` major tag. If a future Caddy 2.x changes
  `handle_path` or `redir` semantics, the step 5 table catches it.
- Reviewers: check the docs never tell phone users to open `http://…:3200/app/`
  (no microphone without HTTPS).
