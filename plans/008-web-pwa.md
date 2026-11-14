# Plan 008: A judge scans a QR code and their phone becomes a full BirdSong node

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (edit only your own row).
>
> **Drift check (run first)**:
> 1. `grep -c "not implemented" packages/core/src/node/index.ts packages/core/src/modem/index.ts` → `0` for both (plans 003 and 005 DONE). Otherwise STOP.
> 2. `cat packages/web/src/main.tsx` shows the one-line skeleton from plan 001 ("BirdSong web skeleton"). If it already contains an app, STOP.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (mobile browser audio quirks)
- **Depends on**: plans/003-modem.md, plans/005-node-engine.md; song export uses plans/006-song-and-ambient.md if DONE
- **Category**: direction (new feature)
- **Planned at**: no git history (greenfield), 2026-11-14

## Why this matters

BirdSong is an acoustic mesh network that hides encrypted messages in
birdsong. Judges must be able to join the network with their own phones, in
seconds, with nothing to install: scan a QR code, tap one button, and the
phone listens, decodes, relays and sends — exactly like the laptop nodes. The
same web app also serves as the local UI of each laptop node. This plan
builds that app: a static Preact PWA hosted on GitHub Pages (HTTPS, which
phones require for microphone access).

## Current state

- npm-workspaces TypeScript monorepo. `packages/web` has a Vite + Preact
  skeleton: `index.html`, `src/main.tsx` (one line), `vite.config.ts`
  (`base: './'`, `preact()` plugin). Installed: `preact`, `vite`,
  `@preact/preset-vite`, and possibly `vite-plugin-pwa` (check
  `plans/README.md` "Notes from executors": plan 001 records it if it was not installed).
- Rules: relative imports end in `.ts`/`.tsx`; `import type` for types; no `enum`/`namespace`/constructor parameter properties.
- From `@birdsong/core`: `createBirdNode`, `createModem`, `createRealClock`,
  `DEFAULT_NODE_CONFIG`, `ENVS`, `ENV_NAMES`, `PROFILE_NAMES`, `PROFILES`,
  `MAX_TEXT_CHARS`, `SPECIES_COUNT`, `encodeWav`, `decodeWav`,
  `renderMessageSong`, `decodeSong`, `renderAmbient`, `AMBIENT_LEVEL`
  (the last four work only if plan 006 is DONE — they throw `not implemented` otherwise),
  and types `AudioPort`, `BirdNode`, `NodeState`, `NodeConfig`, `TelemetryEvent`, `InboxMessage`.
  `BirdNode` has `start()`, `stop()`, `send(text) → msgId` (rejects with
  `RangeError` on empty or > 140-character text), `configure(patch)`,
  `state()`, `onEvent(cb)`.
- **Laptop node HTTP API** (built by plan 007; the container serves this app at `http://localhost:8080/?runtime=remote`):

  | Method | Path | Body | Response |
  |---|---|---|---|
  | GET | `/api/state` | — | `NodeState` JSON |
  | POST | `/api/send` | `{ "text": string }` | `{ "msgId": number }` or 400 `{ "error": string }` |
  | POST | `/api/config` | `Partial<NodeConfig>` | `NodeState` JSON |
  | WS | `/api/events` | — | one JSON `TelemetryEvent` per text message |

## Commands you will need

| Purpose   | Command                                 | Expected |
|-----------|-----------------------------------------|----------|
| Dev       | `npm run dev -w @birdsong/web`          | Vite prints a localhost URL |
| Build     | `npm run build -w @birdsong/web`        | exit 0, writes `packages/web/dist` |
| Typecheck | `npm run typecheck -w @birdsong/web`    | exit 0   |
| Tests     | `npx vitest run packages/web`           | all pass |

## Suggested executor toolkit

- If a built-in browser tool is available, use it to load the dev server and
  check the UI and console. `getUserMedia` works on `http://localhost`.

## Scope

**In scope**: everything under `packages/web/` (no new dependencies);
`.github/workflows/pages.yml` (create).

**Out of scope**: `packages/core`, `packages/node-runtime`, `packages/dashboard`, the lockfile.

## Git workflow

Commit only in-scope paths. Style `feat(web): …`. If git reports `index.lock`
exists, wait 5 seconds and retry. Do NOT push.

## Steps

### Step 1: Join link parsing — `src/join.ts`

The QR code encodes `https://<host>/<path>/#k=<passphrase>&env=<env>&p=<profile>`.
The passphrase lives in the **fragment**, so it is never sent to the web server.

```ts
export interface JoinParams { passphrase: string; env: EnvName; profile: ProfileName }
export function parseJoin(hash: string): Partial<JoinParams>   // tolerant: ignores bad values
export function buildJoinUrl(base: string, p: JoinParams): string
```
Use `URLSearchParams` on the fragment without its leading `#`. Unknown env or
profile values are dropped. After reading the fragment, the app replaces it
with an empty one (`history.replaceState`) so the passphrase does not linger in the address bar.

Test (`src/join.test.ts`): round trip; a passphrase with spaces, `&` and `#`; bad env dropped.

### Step 2: Phone audio — `src/webAudioPort.ts`, `public/capture-worklet.js`

`createWebAudioPort(): AudioPort & { context: AudioContext; analyser: AnalyserNode }`:
- Create `new AudioContext()` (do not force a sample rate; read `context.sampleRate`, often 48 000 or 44 100).
- `start()` **must be called from a user gesture** (the Join button). It calls
  `context.resume()`, then
  `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })`.
  These three `false` values are essential: browser noise suppression would erase the chirps.
- Capture with an `AudioWorklet` loaded from `capture-worklet.js` (put it in
  `public/` so Vite copies it unchanged; load it with
  `context.audioWorklet.addModule(new URL('capture-worklet.js', document.baseURI))`).
  The worklet copies each 128-sample block of channel 0 and posts it; the main
  thread batches blocks into 2048-sample chunks and calls the `onInput` callback.
  Connect mic → worklet, and mic → `analyser` (for the spectrogram). Do not connect the mic to the speakers.
- Playback: `play(pcm)` creates an `AudioBuffer` at `context.sampleRate`,
  schedules an `AudioBufferSourceNode` at `max(context.currentTime + 0.05, lastEnd)`
  through a `GainNode` (the volume), and resolves on its `ended` event.
- `stop()` stops the tracks and closes the context.

### Step 3: Runtimes — `src/runtime.ts`

One interface for the UI, two implementations:

```ts
export interface Runtime {
  kind: 'local' | 'remote';
  state(): Promise<NodeState>;
  send(text: string): Promise<number>;
  configure(patch: Partial<NodeConfig>): Promise<NodeState>;
  onEvent(cb: (e: TelemetryEvent) => void): void;
}
```
- `createLocalRuntime({ passphrase, env, profile, alias })`: node id = a random
  0..255 stored under `birdsong.id`. All storage goes through a new
  `src/storage.ts` exporting `safeGet(key): string | null` and
  `safeSet(key, value): void`, which wrap `localStorage` in try/catch (storage
  throws in some private windows). No other file touches `localStorage`.
  Never store the passphrase. Builds the web audio port and
  `createBirdNode({ id, kind: 'browser', passphrase, alias, config: { ...DEFAULT_NODE_CONFIG, env, profile }, port, clock: createRealClock(), rng: Math.random, modemFactory: createModem })`.
- `createRemoteRuntime(baseUrl)`: `fetch` against the API table above; events
  over `WebSocket` on `/api/events` (`ws:` or `wss:` matching the page), reconnecting every 2 s.

The app chooses `remote` when the query string has `runtime=remote`, otherwise `local`.

Additional rules (from review):
- `webAudioPort.start()` must be **idempotent** (store and return the first
  promise). The Join click handler calls `port.start()` **first and
  synchronously** (so the user gesture is not lost to the slow key derivation),
  then `node.start()`, which calls `port.start()` again harmlessly.
- Add `start(): Promise<void>` and `audio?: { context: AudioContext; analyser: AnalyserNode }`
  to `Runtime` (local only), so the spectrogram and camouflage can reach the audio graph.
- Phone node ids are random in **128–255**; laptops use 0–127. A node drops
  frames carrying its own id, so the ranges must not overlap.
- The remote runtime derives its WebSocket URL from `baseUrl` (http→ws,
  https→wss), touches `location` only as a default for `baseUrl`, connects
  lazily on the first `onEvent` call, and has `close()` (tests run in Node, where `location` does not exist).
- Song tools are shown only in the local runtime (the remote page has no passphrase).
- Route the worklet and analyser outputs through a `GainNode` with gain 0 into
  `context.destination` (Safari does not run nodes that reach no destination);
  the worklet's `process()` returns `true`.

### Step 4: Screens — `src/app.tsx`, `src/main.tsx`, `src/styles.css`

Mobile-first, one column, max width 520 px, 16 px side padding, no horizontal
scrolling at 360 px width. Colours come from `ENVS[env].theme` as CSS variables
(`--bg`, `--fg`, `--accent`), so the theme follows the environment.

1. **Join** (local runtime only, shown until started): title "BirdSong", one
   sentence ("Your phone will listen for, relay and sing hidden messages as
   birdsong."), passphrase field (pre-filled from the link), environment and
   profile selects (pre-filled), alias field (≤ 8 chars), and one big
   **"Join the flock"** button. The button starts the port (user gesture),
   starts the node, and requests a screen wake lock (`navigator.wakeLock?.request('screen')`, ignore errors; re-request on `visibilitychange`).
   If the microphone is denied, show a clear message with how to allow it.
2. **Flock** (main screen):
   - Header: "You are bird #id · species N" with the species colour, environment, profile, and a mute toggle.
   - **Compose**: textarea with a live `n / 140` counter (count with `[...text].length`), Send button; show the `RangeError` message on failure.
   - **Inbox**: newest first; each row shows alias, text, hop count, time; own messages marked "sent".
   - **In flight**: for each `MessageStatus` not yet decoded, a progress bar `rank / k`; for held messages, how many droplets this node has sung.
   - **Spectrogram** (local runtime only): a canvas scrolling right-to-left, 0–8 kHz, from `analyser.getByteFrequencyData`, drawn with `requestAnimationFrame`; mark the environment's band (`envBand(env)`) with two thin lines.
   - **Camouflage** toggle (local runtime): plays `renderAmbient(env, 20, sampleRate, 1)` in a loop through its own `GainNode` at `AMBIENT_LEVEL[env] × volume`. Hide the toggle if `renderAmbient` throws.
   - **Song tools**: "Save last message as song" → `renderMessageSong(...)` → `encodeWav` → download as `birdsong-<msgId>.wav`; "Decode a song file" → file input → `decodeWav` → `decodeSong` → show results. Hide this section if those functions throw `not implemented`.
   - Settings drawer: environment, profile, volume slider → `runtime.configure`.
3. Poll `runtime.state()` every 1 s and also refresh on every event.

Keep components small: one file per screen or panel in `src/components/`.

### Step 5: PWA

- `public/manifest.webmanifest`: name "BirdSong", `start_url: "./"`, `display: "standalone"`, theme colour `#0d1f14`, and a single SVG icon `public/icon.svg` (a simple bird silhouette you draw by hand as an SVG path).
- If `vite-plugin-pwa` is installed: add it in `vite.config.ts` with `registerType: 'autoUpdate'`, `manifest: false` (use the file above), and `workbox.globPatterns: ['**/*.{js,css,html,svg,webmanifest}']`.
  If it is not installed: write `public/sw.js` by hand (cache-first for the files listed in a version-stamped array; delete old caches on `activate`) and register it from `main.tsx` in production only.
- Link the manifest from `index.html`.

### Step 6: GitHub Pages — `.github/workflows/pages.yml`

On push to `main`: checkout, setup-node 24 with npm cache, `npm ci`,
`npm run build -w @birdsong/web`, `actions/upload-pages-artifact@v3` with
`path: packages/web/dist`, then `actions/deploy-pages@v4`. Permissions
`pages: write`, `id-token: write`; environment `github-pages`.

### Step 7: Tests and checks

- `src/join.test.ts` (Step 1).
- `src/runtime.test.ts`: the remote runtime against a mocked `fetch`
  (assign `globalThis.fetch` in the test) — `send` posts the right JSON and returns `msgId`; a 400 response rejects with the server's error text.
- `src/counter.test.ts`: the character counter counts an emoji as one character.

**Verify**: `npx vitest run packages/web` → all pass.
**Verify**: `npm run typecheck -w @birdsong/web` → exit 0.
**Verify**: `npm run build -w @birdsong/web` → exit 0, and `ls packages/web/dist` lists `index.html`, `capture-worklet.js`, `manifest.webmanifest`.
**Verify**: `du -sh packages/web/dist` → under 2 MB.

### Step 8: Two tabs talk through the air (manual, on a laptop with speakers)

Run `npm run dev -w @birdsong/web`. Open the printed URL with
`#k=test&env=quiet&p=fast` in two browser windows (in a browser tool, or ask
the operator). Join in both (allow the microphone). Send a short message from
window A.

**Verify**: window B shows the message in its inbox within 30 s.
If you cannot run a browser with audio, skip this step, write
`008: two-tab acoustic test NOT RUN` in "Notes from executors", and still finish.

## Test plan

Unit tests in Step 7; the acoustic two-tab check in Step 8 (manual). Phone
testing on Android Chrome and iOS Safari is human work after deployment and is
listed in `plans/README.md`, not here.

## Done criteria

- [ ] `npx vitest run packages/web` exits 0
- [ ] `npm run typecheck -w @birdsong/web` exits 0
- [ ] `npm run build -w @birdsong/web` exits 0 and `packages/web/dist` is under 2 MB
- [ ] `grep -rn "echoCancellation: false" packages/web/src | wc -l` → at least `1`
- [ ] `grep -rln "localStorage" packages/web/src` → prints only `packages/web/src/storage.ts`
- [ ] `git log -1 --name-only` lists only files under `packages/web/`, `.github/workflows/pages.yml` (and `plans/README.md`); plan 007 may be running at the same time, so its uncommitted files are not your concern
- [ ] `plans/README.md` status row updated, including the Step 8 result

## STOP conditions

- `@birdsong/core` fails to bundle in Vite because of a Node-only import inside
  `packages/core` (for example `node:crypto`). Report the import chain; do not edit core.
- The modem freezes the page: demodulating one frame blocks the main thread for
  more than 1 s on a laptop. Report the measurement; moving the modem into a
  Web Worker is a separate plan.

## Maintenance notes

- iOS Safari may route output to the earpiece while the microphone is active,
  making the phone very quiet. Known platform behaviour; test early on a real iPhone.
- A phone that locks its screen stops listening. The wake lock helps; tell judges to keep the page open.
- Deferred: running the modem in a Web Worker; installing a CC0 field recording as an alternative ambient bed.
