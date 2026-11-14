# Plan 009: A big-screen dashboard shows the message spreading through the flock, live, with kill switches

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (edit only your own row).
>
> **Drift check (run first)**:
> `grep -c "not implemented: plan 009" packages/dashboard/src/server/hub.ts` → `1`. Otherwise STOP.
> This plan needs only plan 001. It is built and tested against a **mock
> flock** (Step 2), so it can run in parallel with every other plan.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-scaffold-and-contracts.md
- **Category**: direction (new feature)
- **Planned at**: no git history (greenfield), 2026-11-14

## Why this matters

BirdSong is an acoustic mesh network that hides encrypted messages in
birdsong. Sound is invisible, so judges need a screen that shows what the
flock is doing: which device heard which, how much of each message every
device has collected, who sings next, and what the "composition" looks like
as a score. The demo's key moment — muting two devices mid-transmission while
the message still arrives — happens on this screen. Nodes report to the
dashboard over the LAN; this is an observer channel only, never the data path.

## Current state

- npm-workspaces TypeScript monorepo. `packages/dashboard` has a Vite + Preact
  skeleton (`index.html`, `src/main.tsx`, `vite.config.ts`) and
  `src/server/hub.ts` (a stub). Installed: `preact`, `d3-force`, `qrcode`, `ws`, `vite`, `@preact/preset-vite`, and their types.
- Rules: relative imports end in `.ts`/`.tsx`; `import type` for types; no
  `enum`/`namespace`/constructor parameter properties. The hub runs with plain
  `node src/server/hub.ts` (no build).
- From `@birdsong/core` (all available after plan 001): types `TelemetryEvent`,
  `Command`, `NodeSnapshot`, `HubToUi`, `NodeConfig`, `EnvName`, `ProfileName`;
  values `HUB_PORT = 7070`, `ENVS` (each has `theme: { bg, fg, accent }`, `label`, `key`, `midi`),
  `ENV_NAMES`, `PROFILE_NAMES`, `SPECIES_COUNT = 4`, `DEFAULT_NODE_CONFIG`,
  `frameNotes(air: Uint8Array, env, profile) → ScoreNote[]`
  (`{ startMs, durMs, pitchIndex, shape, midi, hzStart, hzMid, hzEnd }`), `fromHex`.
  Read `packages/core/src/telemetry.ts` for the exact event shapes. The
  important ones: `hello`, `config`, `heard { node, from, msgId, seed, hop, k, sync }`,
  `bad { node, reason }`, `rank { node, msgId, rank, k }`, `decoded { node, msgId, hops, text, alias }`,
  `sang { node, msgId, seed, hop, k, airHex, durationMs }`, `expired`.

### Hub protocol (must match plan 007, which implements the node side)

- Nodes connect to `ws://<hub>:7070/node`, send `TelemetryEvent` JSON text
  messages (the first one after connecting is always `hello`), and receive `Command` JSON.
- Dashboard tabs connect to `ws://<hub>:7070/ui`. On connect the hub sends one
  `HubToUi` `snapshot`, then an `event` message for every telemetry event, and
  `nodeOffline` when a node's socket closes. A tab sends `Command` JSON; the hub
  forwards it to the addressed node, or to every node for `node: 'all'`.
- `GET /` and other paths serve `packages/dashboard/dist` (built UI).

## Commands you will need

| Purpose   | Command                                       | Expected |
|-----------|-----------------------------------------------|----------|
| Hub       | `npm start -w @birdsong/dashboard`            | "hub listening on 7070" |
| UI dev    | `npm run dev -w @birdsong/dashboard`          | Vite URL (proxying `/ui` to 7070) |
| Build     | `npm run build -w @birdsong/dashboard`        | exit 0   |
| Typecheck | `npm run typecheck -w @birdsong/dashboard`    | exit 0   |
| Tests     | `npx vitest run packages/dashboard`           | all pass |

## Scope

**In scope**: everything under `packages/dashboard/` (including adding scripts
to its `package.json`; no new dependencies).

**Out of scope**: every other package; the lockfile.

## Git workflow

Commit only `packages/dashboard`. Style `feat(dashboard): …`. If git reports
`index.lock` exists, wait 5 seconds and retry. Do NOT push.

## Steps

### Step 1: Hub server — `src/server/hub.ts`, `src/server/state.ts`

- `state.ts`: a pure reducer `createHubState()` with `apply(event, now)`,
  `markOffline(node, now)`, `load(nodes: NodeSnapshot[], recent: TelemetryEvent[])`
  (replaces all state; the UI calls it on every `snapshot` message),
  `snapshot(): NodeSnapshot[]`, `recent(): TelemetryEvent[]`
  (ring of the last 500 events), and `aliasOf(node): string | null` (the alias
  from that node's own `decoded` events with `hops === 0`, i.e. messages it
  wrote; `hello` carries no alias).
- **Clock**: every node's `t` comes from its own `performance.now()`, whose
  origin differs per process, so times from different nodes cannot be
  compared. The hub **overwrites `event.t = Date.now()`** when it receives an
  event, before storing or forwarding it. The UI compares event times with
  `Date.now()`; the mock flock also uses `Date.now()`. Nodes are created by `hello`. **Inferred
  nodes**: a `heard` event whose `from` is not a known node creates a snapshot
  with `kind: 'browser'`, `species: from % SPECIES_COUNT`, `config: DEFAULT_NODE_CONFIG`,
  `online: true` (phones cannot send telemetry, so this is how they appear on screen).
- `hub.ts`: `node:http` server + `WebSocketServer` (`noServer`; upgrade on `/node` and `/ui`).
  Env vars: `HUB_PORT` (default 7070), `CHANNEL_PASSPHRASE` (default `demo-flock`),
  `PWA_URL` (default `http://localhost:5180/`; run the phone app's dev server
  with `npm run dev -w @birdsong/web -- --port 5180`, so it does not clash with
  the dashboard's own Vite dev server on 5173), `ETHER_URL` (optional, Step 7). The snapshot's `join` field is
  `{ pwaUrl: PWA_URL, passphrase: CHANNEL_PASSPHRASE }`. Track which socket belongs to which node id (from its `hello`).
  Serve `dist/` statics like a normal static server (reject `..`); if `dist` is missing, serve a one-line notice.
  Export `startHub(opts) → { port, close() }`; run it when executed directly.
- Tests (`test/hub.test.ts`): start on port 0; a fake node sends `hello` then
  `heard` from an unknown id → a UI client's snapshot (on a fresh connection)
  lists both nodes, the inferred one as `browser`; a UI `configure` command for
  node 3 reaches only node 3's socket; `'all'` reaches every node; closing a
  node socket sends `nodeOffline`.

### Step 2: Mock flock — `src/server/mock.ts`

`node src/server/mock.ts [--hub ws://localhost:7070] [--nodes 8]` connects N fake
nodes to the hub and plays a scripted story every 60 s: node 0 decodes a new
message and sings droplets; neighbours on a 2 × 4 grid send `heard`, `rank`
increments, then `decoded`, and relay with `sang` events (use real 32-byte
`airHex` values: random bytes are fine for the score). At 20 s into each cycle
it responds to `configure { muted: true }` commands by stopping that fake
node's events. Use realistic pacing (one `sang` per ~3 s per node).
Add `"mock": "node src/server/mock.ts"` to the package scripts.

### Step 3: UI shell — `src/main.tsx`, `src/app.tsx`, `src/hubClient.ts`, `src/styles.css`

- `hubClient.ts`: connects to `ws(s)://<page host>/ui` (in Vite dev, proxy
  `/ui` with `ws: true` and `/config.json` to `localhost:7070` in `vite.config.ts`), reconnects every 2 s,
  keeps a reducer-style store (reuse `createHubState` from `server/state.ts` —
  it is pure): `snapshot` → `load(...)`, `event` → `apply(...)`, `nodeOffline` → `markOffline(...)`.
- Layout for a 1920 × 1080 projector: left two-thirds = **Flock graph** above
  the **Score**; right third = **Join QR**, **Controls**, **Message feed**.
  Must also stay usable at 1280 × 720. Colours from `ENVS[env].theme`
  (env = the most common env among online nodes) as CSS variables; large
  fonts (min 18 px), high contrast.

### Step 4: Flock graph — `src/components/FlockGraph.tsx`

- SVG with `d3-force` (`forceManyBody`, `forceCenter`, `forceLink`, `forceCollide`).
  One circle per node, colour by species (four fixed, colour-blind-safe hues),
  label `#id` + `aliasOf(id)` when it is not null; phones (inferred) drawn with a dashed outline.
- **Links**: an edge between `from` and `node` for every `heard` event, fading out over 10 s; it pulses brightly for 600 ms when the event arrives.
- **Progress ring** around each node for the **focus message** (the most recently created msgId, or the one clicked in the feed): an arc of `rank / k`; full and bright when decoded.
- Muted or offline nodes are greyed with a strike-through label.
- A node that is currently singing (a `sang` event within its `durationMs`) shows expanding sound-wave rings.

### Step 5: Score — `src/components/Score.tsx`

A canvas piano roll of the last 60 s. For every `sang` event: `notes = frameNotes(fromHex(airHex), env, profile)`
(use the singing node's config), and draw each note as a short line from
`(t + startMs, hzStart)` through `hzMid` to `hzEnd` on a log-frequency axis, in
the node's species colour. Horizontal guide lines at the env's 8 pitches,
labelled with note names (compute from MIDI). Title shows `ENVS[env].key`.
This is the "composition" view: the mesh plays a piece in one key.

### Step 6: Controls, QR, feed — `src/components/*.tsx`

- **Join QR**: `qrcode`'s `toDataURL` of `${pwaUrl}#k=${encodeURIComponent(passphrase)}&env=${env}&p=${profile}`, at least 320 px, with the URL printed underneath in small text.
- **Controls**: per node a row with Mute/Unmute (sends `configure { muted }`)
  and a volume slider; global environment and profile selects and a global
  **Camouflage** on/off toggle (each sends `configure` to `'all'`, e.g.
  `{ type: 'configure', node: 'all', patch: { camouflage: true } }`); a **"Kill 2 random relays"** button that mutes two
  random online nodes that are not the focus message's originator (the node with `hop 0` in its `sang` events) — this is the demo moment.
  Inferred phone nodes show "phone" and no buttons (they cannot be controlled).
- **Message feed**: `decoded` events grouped by msgId: text, alias, and a
  growing list of `#node (hops)` chips as more nodes decode it, plus time from first `sang` to each decode.
  Clicking a message makes it the focus message.
- **Stats strip**: online nodes, frames heard, CRC failures (`bad` with `crc`), messages delivered.

### Step 7: Optional — listen to the simulated air

The hub serves `GET /config.json` → `{ "etherUrl": string | null }`, taken from
the env var `ETHER_URL` (unset → null). (Do not add this to the `HubToUi` type:
that lives in core, which is out of scope.) When `etherUrl` is not null, the UI
shows a "Listen to the simulated air" toggle that opens
`${etherUrl}/listen?x=1.5&y=0.5` (binary messages of 960 little-endian Float32
samples at 48 000 Hz) and plays the blocks back to back with Web Audio, so the
room hears the simulated flock. Skip this step if time is short.

### Step 8: Checks

**Verify**: `npx vitest run packages/dashboard` → all pass.
**Verify**: `npm run typecheck -w @birdsong/dashboard` → exit 0.
**Verify**: `npm run build -w @birdsong/dashboard` → exit 0.
**Verify** (manual or with a browser tool): run `npm start -w @birdsong/dashboard`
and `npm run mock -w @birdsong/dashboard`, open `http://localhost:7070`: 8 nodes
appear, links pulse, rings fill, the score draws notes, the feed shows
messages; clicking "Kill 2 random relays" greys two nodes and their events stop.
Take a screenshot if a browser tool is available and save it as `packages/dashboard/screenshot.png`.

## Test plan

`test/hub.test.ts` (hub routing and inferred nodes; an event arriving with
`t: 5` is forwarded with `t` within 1 s of `Date.now()`), `src/server/state.test.ts`
(the reducer: hello, heard-from-unknown, offline, ring size 500, `load` replaces
state, `aliasOf`), and the manual
mock-flock check in Step 8.

## Done criteria

- [ ] `npx vitest run packages/dashboard` exits 0
- [ ] `npm run typecheck -w @birdsong/dashboard` exits 0
- [ ] `npm run build -w @birdsong/dashboard` exits 0
- [ ] `grep -c "not implemented" packages/dashboard/src/server/hub.ts` → `0`
- [ ] `git log -1 --name-only` lists only files under `packages/dashboard/` (and `plans/README.md`); other executors work in parallel, so their uncommitted files are not your concern
- [ ] `plans/README.md` status row updated (say whether the Step 8 visual check was done)

## STOP conditions

- Matching the hub protocol seems to need a change to `packages/core/src/telemetry.ts`. Report it; do not edit core.
- `d3-force` or `qrcode` fails to bundle with Vite. Report the error.

## Maintenance notes

- The hub trusts every LAN client. It is a demo observer, not a security
  boundary; never send message plaintext anywhere except the `decoded` events the nodes already chose to emit.
- Deferred: recording a session of events to replay later as a canned demo.
