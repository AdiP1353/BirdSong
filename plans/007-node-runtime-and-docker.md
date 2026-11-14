# Plan 007: A BirdSong node runs in Docker on any Linux laptop, using its real speaker and mic — or the simulated air

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (edit only your own row).
>
> **Drift check (run first)**:
> 1. `grep -c "not implemented" packages/core/src/node/index.ts packages/core/src/modem/index.ts packages/core/src/codec/index.ts packages/ether/src/client.ts`
>    → `0` for every file (plans 002, 003, 004, 005 DONE). Otherwise STOP.
> 2. `grep -c "not implemented: plan 007" packages/node-runtime/src/cli.ts` → `1`.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (PulseAudio inside Docker)
- **Depends on**: plans/002, 003, 004, 005 (all DONE). Ambient playback uses plans/006 if DONE; the hub check in Step 11 uses plans/009 if DONE.
- **Category**: direction / dx
- **Planned at**: no git history (greenfield), 2026-11-14

## Why this matters

BirdSong is an acoustic mesh network. The demo has 2–4 Linux laptops, each
running exactly one BirdSong node in Docker, singing through its own speaker
and listening with its own microphone; judges' phones join through a web
page (another plan). This plan builds the laptop node: a Node.js process that
wires the mesh engine to real audio (PipeWire/PulseAudio), exposes a small
HTTP API and local web UI, reports what it is doing to the dashboard, and
ships as a multi-architecture Docker image. It also builds the 8-node
simulated mesh in `docker compose`, which is the fallback demo.

## Current state

- npm-workspaces TypeScript monorepo; Node runs `.ts` directly (no build).
  Rules: relative imports end in `.ts`; `import type` for types; no `enum`,
  `namespace` or constructor parameter properties.
- `packages/core` exports (from `@birdsong/core`):
  `createBirdNode(opts: BirdNodeOptions): BirdNode` (methods `start`, `stop`,
  `send(text) → msgId`, `configure(patch)`, `state() → NodeState`,
  `onEvent(cb)`), `createModem`, `createRealClock`, `renderAmbient`,
  `AMBIENT_LEVEL` (only if plan 006 is DONE), `DEFAULT_NODE_CONFIG`,
  `ENV_NAMES`, `PROFILE_NAMES`, `HUB_PORT = 7070`, `ETHER_PORT = 7080`,
  `NODE_UI_PORT = 8080`, and the types `AudioPort`, `TelemetryEvent`, `Command`, `NodeConfig`, `NodeState`.
- `packages/ether/src/client.ts` exports
  `createEtherPort({ url, id, x, y, sampleRate? }): AudioPort` (WebSocket to the ether service).
- `packages/ether/src/server.ts` — the ether service (`node packages/ether/src/server.ts`), env vars `ETHER_PORT`, `ETHER_RANGE`, `ETHER_NOISE_RMS`.
- `packages/node-runtime/` — skeleton: `src/main.ts` prints one line, `src/cli.ts` is a stub. `ws` is installed here.
- `packages/web/` — the web UI package (another plan fills it in). `npm run build -w @birdsong/web` writes `packages/web/dist/`.
- `packages/dashboard/` — the dashboard hub (another plan). `npm start -w @birdsong/dashboard` runs `src/server/hub.ts`.
- Machine: Linux (CachyOS), PipeWire with its PulseAudio socket at
  `$XDG_RUNTIME_DIR/pulse/native`; `parec`/`pacat` 17.0 installed; Docker 29.

### Contracts with other plans (must match exactly)

**Node HTTP API** (served on `NODE_UI_PORT`, consumed by the web UI and the CLI):

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/state` | — | `NodeState` JSON |
| POST | `/api/send` | `{ "text": string }` | `{ "msgId": number }`, or 400 `{ "error": string }` |
| POST | `/api/config` | `Partial<NodeConfig>` | `NodeState` JSON |
| WS | `/api/events` | — | one JSON `TelemetryEvent` per text message |
| GET | `/*` | — | static files from `packages/web/dist` (`index.html` for unknown paths) |

**Hub protocol** (the dashboard hub listens on `HUB_PORT`):
the `--observatory` value is the hub's base URL (for example `ws://hub:7070`);
the node connects to `${base.replace(/\/$/, '')}/node`, sends every `TelemetryEvent` as a JSON
text message, and receives `Command` JSON text messages:
`{ type: 'configure', node, patch }` → call `node.configure(patch)`;
`{ type: 'send', node, text }` → call `node.send(text)`. Ignore commands whose
`node` is neither this node's id nor `'all'`. On every (re)connect, first send
a fresh `hello` event built from `node.state()`. Every promise from a command
(`configure`, `send`) must have a `.catch` that logs the error: an unhandled
rejection kills a Node 24 process.

**`onEvent`** on the engine adds a listener (several are allowed; all receive
every event). This runtime registers several: the WebSocket broadcast, the
telemetry client, the log, and the ambient player.

## Commands you will need

| Purpose   | Command                                       | Expected |
|-----------|-----------------------------------------------|----------|
| Typecheck | `npm run typecheck -w @birdsong/node-runtime` | exit 0   |
| Tests     | `npx vitest run packages/node-runtime`        | all pass |
| Run       | `node packages/node-runtime/src/main.ts --help` | usage text |

## Scope

**In scope**:
- `packages/node-runtime/src/**`, `packages/node-runtime/test/**`, `packages/node-runtime/package.json` (scripts only, no new dependencies)
- `docker/Dockerfile.node`, `docker/compose.sim.yml`, `.dockerignore`
- `scripts/run-node.sh`, `scripts/sim-up.sh`
- `.github/workflows/image.yml`

**Out of scope**: `packages/core`, `packages/ether`, `packages/web`,
`packages/dashboard` (other plans), the lockfile, `.github/workflows/ci.yml`.

## Git workflow

Commit only in-scope paths. Style `feat(runtime): …`, `build(docker): …`.
If git reports `index.lock` exists, wait 5 seconds and retry. Do NOT push.

## Steps

### Step 1: Configuration — `src/config.ts`

Parse flags (`--name value` form) with environment-variable fallbacks. Use
`node:util` `parseArgs`.

| Flag | Env var | Default |
|---|---|---|
| `--id` | `BIRDSONG_ID` | random 0..255 (stable per process run) |
| `--key` | `BIRDSONG_KEY` | **required** (exit 2 with a message if missing) |
| `--alias` | `BIRDSONG_ALIAS` | `bird<id>` |
| `--env` | `BIRDSONG_ENV` | `quiet` (validate against `ENV_NAMES`) |
| `--profile` | `BIRDSONG_PROFILE` | the env's `defaultProfile` |
| `--volume` | `BIRDSONG_VOLUME` | `0.8` |
| `--audio` | `BIRDSONG_AUDIO` | `pulse` (or `ether`) |
| `--ether` | `BIRDSONG_ETHER` | `ws://localhost:7080` |
| `--x`, `--y` | `BIRDSONG_X`, `BIRDSONG_Y` | `0` |
| `--observatory` | `BIRDSONG_OBSERVATORY` | none (no telemetry) |
| `--port` | `BIRDSONG_PORT` | `8080` |
| `--neighbors` | `BIRDSONG_NEIGHBORS` | none; comma-separated ids |
| `--camouflage` | `BIRDSONG_CAMOUFLAGE` | `false` |
| `--help` | — | print usage, exit 0 |

Export `parseConfig(argv, env): RuntimeConfig` as a pure function. `--help`
is handled **before** any validation (so `--help` works without `--key`).
Test (`test/config.test.ts`): defaults; flags override env vars; invalid env name throws; missing key throws; `--help` without a key does not throw.

### Step 2: Real audio — `src/pulsePort.ts`

`createPulsePort({ sampleRate = 48000, latencyMs = 30 }): AudioPort`:
- `start()`: spawn
  `parec --raw --format=float32le --rate=<sr> --channels=1 --latency-msec=<latencyMs> --client-name=birdsong --stream-name=mic`
  and `pacat --playback --raw --format=float32le --rate=<sr> --channels=1 --latency-msec=<latencyMs> --client-name=birdsong --stream-name=song`.
  Reject if either exits within 500 ms (include its stderr in the error).
- Microphone: `parec`'s stdout delivers bytes in arbitrary chunk sizes. Keep a
  remainder of `length % 4` bytes between chunks; convert the aligned part to
  a `Float32Array` (copy into a fresh buffer — Node `Buffer`s may be
  unaligned) and call the `onInput` callback.
- Speaker: `play(pcm)` multiplies by the volume, writes to `pacat`'s stdin, and
  resolves after the audio's duration, measured from when the previously
  queued play finishes (`endAt = max(now, prevEndAt) + duration`), plus `latencyMs`.
  Respect backpressure: if `write()` returns false, wait for `'drain'`.
- `stop()`: kill both processes.
- `pulseAvailable(): Promise<boolean>`: runs `pactl info` (or `pacat --version` and checks `$PULSE_SERVER`/the socket exists) and resolves true if it succeeds.

Test (`test/pulsePort.test.ts`): the byte-alignment logic as a pure function
(`createFloatChunker()` → `push(buf) → Float32Array[]`) with chunks of 1, 3, 5,
4096 bytes. Plus an integration test that runs **only if
`process.env.BIRDSONG_PULSE_TEST === '1'`** (otherwise `it.skip`): start the
port, play a 1 kHz tone for 0.5 s, and check that `onInput` received audio.

### Step 3: Ambient player — `src/ambientPlayer.ts`

`createAmbientPlayer({ sampleRate })` with `setEnv(env)`, `setLevel(gain)`,
`start()`, `stop()`. It spawns its **own** `pacat` (stream name `ambient`),
renders `renderAmbient(env, 20, sampleRate, 1)` once per env (cache it), and
plays it in a loop by writing **0.5 s slices** of that buffer (wrapping around
at the end): a timer writes the next slice whenever less than 1.5 s of audio
is queued ahead of real time, and waits for `'drain'` if `write()` returns
false. On `setEnv` or `setLevel`, the next slice comes from the new buffer or
at the new gain, so changes take effect within about 2 s. Level = `AMBIENT_LEVEL[env] × volume`.
If `@birdsong/core` does not export `renderAmbient` with a working body
(plan 006 not DONE — calling it throws), make the player a no-op that logs one warning.

### Step 4: The process — `src/main.ts`

1. `cfg = parseConfig(process.argv.slice(2), process.env)`.
2. Port: `cfg.audio === 'pulse'` → `createPulsePort()`; if `pulseAvailable()`
   is false, print a clear message explaining the socket mount (see
   `scripts/run-node.sh`) and exit 3. `cfg.audio === 'ether'` →
   `createEtherPort({ url: cfg.ether, id, x, y })`.
3. `node = createBirdNode({ id, kind: 'container', passphrase: cfg.key, alias,
   config: { ...DEFAULT_NODE_CONFIG, env, profile, volume, neighbors, camouflage },
   port, clock: createRealClock(), rng: Math.random, modemFactory: createModem })`; `await node.start()`.
4. Start the HTTP server (Step 5) and, if `cfg.observatory` is set, the telemetry client (Step 6).
5. If `camouflage` is on and audio is `pulse`, start the ambient player; react to `config` events (env, volume, camouflage).
6. Log one line per `decoded` event: `[bird<id>] <alias>: <text> (hops <n>)`. Log `sang` and `heard` only when `BIRDSONG_DEBUG=1`.
7. On `SIGINT`/`SIGTERM`: `await node.stop()`, close servers, exit 0.

### Step 5: HTTP API — `src/http.ts`

Implement the "Node HTTP API" contract above with `node:http` and
`WebSocketServer` from `ws` (`noServer: true`, upgrade only on `/api/events`).
JSON bodies up to 4 KB, parsed as JSON **whatever the `Content-Type`** (curl
sends `application/x-www-form-urlencoded` by default); invalid JSON → 400.
`send` errors (`RangeError`) → 400.
`GET /` with no query string redirects (302) to `/?runtime=remote`, so the
page always opens in remote mode and never starts a second, in-browser node. Static files: resolve
`packages/web/dist` relative to this file
(`new URL('../../web/dist/', import.meta.url)`); reject any path containing `..`
after decoding; set `Content-Type` for `.html .js .css .svg .png .webmanifest .json .wav`.
If `dist` does not exist, serve a one-line HTML page saying the web UI is not built.
Add `Access-Control-Allow-Origin: *` to `/api/*` responses (the dashboard may call them).

Test (`test/http.test.ts`): start the server on port 0 with a **fake node**
(an object implementing `BirdNode` that records calls); check each route,
the 400 path, path traversal (`/..%2f..%2fetc/passwd` → 404), and that an
emitted event reaches a WebSocket client on `/api/events`.

### Step 6: Telemetry client — `src/telemetry.ts`

`connectObservatory(url, node)`: implement the "Hub protocol" contract above.
Use the global `WebSocket`. Reconnect every 2 s on close or error, forever.
Queue at most 200 events while disconnected (drop the oldest). Test with a
local `WebSocketServer` on port 0: the upgrade request's path is exactly
`/node` (assert `req.url === '/node'`); hello arrives first; a `configure` command
reaches the fake node; commands for another node id are ignored; after the
server is closed and **restarted on the same port number** it first got, the
client reconnects and sends `hello` again.

### Step 7: CLI — `src/cli.ts`

`birdsong send "<text>"`, `birdsong inbox`, `birdsong state`, `birdsong config key=value …`
(values parsed as JSON when possible, else strings). Talks to
`http://localhost:${BIRDSONG_PORT ?? 8080}` using `fetch`. Prints human-readable
output; exit 1 with the server's error on failure. Keep the `#!/usr/bin/env node` line.

**Verify**: `npx vitest run packages/node-runtime` → all pass.
**Verify**: `npm run typecheck -w @birdsong/node-runtime` → exit 0.

### Step 8: Local smoke test with the ether (no Docker yet)

In three terminals (or background processes; kill them afterwards):
```
ETHER_NOISE_RMS=0.002 node packages/ether/src/server.ts
node packages/node-runtime/src/main.ts --audio ether --id 1 --x 0 --key smoke --env quiet --port 8081
node packages/node-runtime/src/main.ts --audio ether --id 2 --x 1 --key smoke --env quiet --port 8082
```
Then `curl -s -XPOST -H 'Content-Type: application/json' localhost:8081/api/send -d '{"text":"hello from one"}'`.

**Verify**: within 60 s, `curl -s localhost:8082/api/state` contains `"hello from one"`.

Write this as `scripts/smoke-ether.sh` so it can be re-run (start the ether
in the background and wait until port 7080 accepts connections — poll with
`bash -c '</dev/tcp/127.0.0.1/7080'` every 0.2 s for up to 10 s — then start
the two nodes, wait until both `/api/state` endpoints answer, send, poll
`/api/state` every 2 s for up to 60 s, kill
everything with a `trap`, exit 0 on success, 1 on timeout).

**Verify**: `bash scripts/smoke-ether.sh` → exit 0.

### Step 9: Docker image — `docker/Dockerfile.node`, `.dockerignore`

```dockerfile
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends pulseaudio-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/ether/package.json packages/ether/
COPY packages/node-runtime/package.json packages/node-runtime/
COPY packages/web/package.json packages/web/
COPY packages/dashboard/package.json packages/dashboard/
# npm links the `birdsong` bin during `npm ci`; its target must exist already.
COPY packages/node-runtime/src/cli.ts packages/node-runtime/src/
RUN npm ci
COPY . .
RUN (npm run build -w @birdsong/web || true) && (npm run build -w @birdsong/dashboard || true)
ENV NODE_ENV=production
ENTRYPOINT ["node", "packages/node-runtime/src/main.ts"]
```

`.dockerignore`: `node_modules`, `**/node_modules`, `**/dist`, `.git`, `samples`, `plans`.

(The same image also runs the ether and the hub by overriding the entrypoint;
the `|| true` keeps the image building if a web package is still a skeleton.)

**Verify**: `docker build -f docker/Dockerfile.node -t birdsong-node .` → exit 0.
**Verify**: `docker run --rm birdsong-node --help` → prints usage.

### Step 10: Real audio in Docker — `scripts/run-node.sh`

Bash script, `set -euo pipefail`. Passes its arguments through to the node.
Build the `docker run` arguments as a **bash array** (paths may contain spaces):

```bash
args=(run --rm -i --name "birdsong-${BIRDSONG_ID:-node}"
  --network host
  --user "$(id -u):$(id -g)"
  -e HOME=/tmp
  -e PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native"
  -v "${XDG_RUNTIME_DIR}/pulse/native:${XDG_RUNTIME_DIR}/pulse/native")
[ -t 0 ] && args+=(-t)
[ -f "$HOME/.config/pulse/cookie" ] && args+=(-v "$HOME/.config/pulse/cookie:/tmp/.config/pulse/cookie:ro")
# Forward every BIRDSONG_* variable that is set on the host (they are the flag fallbacks).
while IFS='=' read -r name _; do args+=(-e "$name"); done < <(env | grep '^BIRDSONG_' || true)
docker "${args[@]}" "${BIRDSONG_IMAGE:-birdsong-node}" --audio pulse "$@"
```

Before running, check that `${XDG_RUNTIME_DIR}/pulse/native` exists; if not,
print how to enable `pipewire-pulse` and exit 1. Note in a comment that laptop
node ids should be **0–127** (phones pick 128–255), e.g. `BIRDSONG_ID=3 scripts/run-node.sh --key …`.

**Verify** (needs a desktop session; skip with a note if run headless):
`docker run --rm --user "$(id -u):$(id -g)" -e PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native" -v "${XDG_RUNTIME_DIR}/pulse/native:${XDG_RUNTIME_DIR}/pulse/native" -e HOME=/tmp --entrypoint pactl birdsong-node info`
→ prints `Server Name: PulseAudio (on PipeWire …)`.

### Step 11: Simulated mesh in Docker — `docker/compose.sim.yml`, `scripts/sim-up.sh`

Services, all from `build: { context: .., dockerfile: docker/Dockerfile.node }`
(one shared image, tag `birdsong-node`):
- `ether`: entrypoint `node packages/ether/src/server.ts`, env `ETHER_RANGE=1.5`, `ETHER_NOISE_RMS=0.002`, port 7080.
- `hub`: entrypoint `node packages/dashboard/src/server/hub.ts`, env `HUB_PORT=7070`,
  `CHANNEL_PASSPHRASE=demo-flock`, `ETHER_URL=ws://localhost:7080` (the URL the
  **browser** uses to reach the ether, for the dashboard's "Listen" toggle — not `ws://ether:7080`), port 7070.
- `bird0` … `bird7`: `--audio ether --ether ws://ether:7080 --observatory ws://hub:7070 --key demo-flock --env quiet`
  with `--id i --x (i % 4) --y floor(i / 4)` and `--port 8080`; publish host
  port `808i` → container 8080 for each; `depends_on: [ether, hub]` and
  `restart: on-failure` (a node that starts before the ether is listening exits and is restarted).

`scripts/sim-up.sh`: `docker compose -f docker/compose.sim.yml up --build -d`, then
print the dashboard URL (`http://localhost:7070`) and the node UI URLs
(`http://localhost:808i/?runtime=remote`).

**Verify**: `bash scripts/sim-up.sh && sleep 20 && curl -s -XPOST -H 'Content-Type: application/json' localhost:8080/api/send -d '{"text":"compose mesh"}'`,
then poll `curl -s localhost:8087/api/state` every 5 s; within 240 s it contains
`"compose mesh"` (node 7 is at least 3 hops from node 0).
Finish with `docker compose -f docker/compose.sim.yml down`.
If plan 009 is DONE, also check `docker compose -f docker/compose.sim.yml logs hub`
shows 8 node connections. (If 009 is not DONE, the hub is a skeleton and the
nodes log reconnect attempts; then skip this check and note it.)

### Step 12: Image workflow — `.github/workflows/image.yml`

On push to `main` and on tags `v*`: `docker/setup-qemu-action@v3`,
`docker/setup-buildx-action@v3`, `docker/login-action@v3` to `ghcr.io` with
`${{ github.actor }}` / `${{ secrets.GITHUB_TOKEN }}`, then
`docker/build-push-action@v6` with `platforms: linux/amd64,linux/arm64`,
`file: docker/Dockerfile.node`, `push: true`,
`tags: ghcr.io/${{ env.OWNER }}/birdsong-node:latest`, where a step before it
runs `echo "OWNER=${GITHUB_REPOSITORY_OWNER,,}" >> "$GITHUB_ENV"` (GHCR image
names must be lower case; the `,,` lowercases in bash).
Add `permissions: { contents: read, packages: write }`.

**Verify**: `docker buildx build --platform linux/arm64 -f docker/Dockerfile.node .` → exit 0
(if `buildx` or QEMU emulation is not installed locally, skip this verification and note it).

## Test plan

`config.test.ts`, `pulsePort.test.ts` (pure part + opt-in integration),
`http.test.ts`, `telemetry.test.ts` in `packages/node-runtime/test/`, plus
`scripts/smoke-ether.sh` and the compose check.

## Done criteria

- [ ] `npx vitest run packages/node-runtime` exits 0
- [ ] `npm run typecheck -w @birdsong/node-runtime` exits 0
- [ ] `bash scripts/smoke-ether.sh` exits 0
- [ ] `docker build -f docker/Dockerfile.node -t birdsong-node .` exits 0
- [ ] The compose check in Step 11 passed
- [ ] `git log -1 --name-only` lists only in-scope paths (and `plans/README.md`); plan 008 may be running at the same time, so its uncommitted files in the tree are not your concern
- [ ] `plans/README.md` status row updated, noting whether Step 10's `pactl info` check was run on a desktop session

## STOP conditions

- `pactl info` inside the container fails with "Connection refused" or
  "Access denied" after trying with and without the cookie mount. Report the
  exact error and the output of `ls -l $XDG_RUNTIME_DIR/pulse/` on the host.
- Node inside `node:24-slim` fails to run the `.ts` entrypoint (type
  stripping). Report the error; do not add a build step on your own.
- The ether smoke test (Step 8) fails even though the core e2e tests
  (`npm run test:e2e`) pass. Report the node logs with `BIRDSONG_DEBUG=1`.

## Maintenance notes

- `--network host` is required so the node can reach the hub on the LAN and
  serve its UI on `localhost`. It only works on Linux, which is the agreed demo platform.
- The real-room parameters (volume, sync threshold) will need tuning on site;
  `POST /api/config` changes volume and env live without restarting.
- Deferred: a `--record` flag that writes the microphone input to a WAV for offline tuning.
