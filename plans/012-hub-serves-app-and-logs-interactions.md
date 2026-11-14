# Plan 012: The hub runs on port 3200, serves the phone app at /app/ and logs every interaction

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ff670cc..HEAD -- packages/core/src/telemetry.ts packages/dashboard/src packages/dashboard/test packages/dashboard/vite.config.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches the hub's HTTP routing and its static-file traversal checks)
- **Depends on**: none (plan 011 can run at the same time; plan 013 needs this one)
- **Category**: tech-debt / direction (two-port layout)
- **Planned at**: commit `ff670cc`, 2026-11-14

## Why this matters

The simulated mesh is moving from ten host ports to two:

| Port | Process | Serves |
|---|---|---|
| 3100 | reverse proxy (plan 013) | `/nodes/<id>/*` → each node, `/ether/*` → the simulated air |
| 3200 | **the hub (this plan)** | dashboard `/`, phone app `/app/`, WebSockets `/node` and `/ui`, `/config.json`, `/api/log` |

The hub becomes the one central server: it serves the static pages for every
node (the phone/node web app at `/app/`, which picks its node from a
`?node=<url>` query parameter, added by plan 011) and keeps a structured log of
every interaction between nodes (each telemetry event, each dashboard command,
each disconnect) as newline-delimited JSON, readable at `GET /api/log`.

Today the hub listens on 7070, serves only the dashboard, keeps only an
in-memory "recent events" list, and its QR code points at a phone-app URL
(`http://localhost:5180/`) where nothing is served unless the operator sets `PWA_URL`.

## Current state

Repository: TypeScript monorepo (npm workspaces). Node ≥ 24 runs `.ts` files
directly; there is no build step for server code. The dashboard client is a
Preact app built with Vite.

### `packages/core/src/telemetry.ts` (lines 36–39)

```ts
/** Default ports. */
export const HUB_PORT = 7070;
export const ETHER_PORT = 7080;
export const NODE_UI_PORT = 8080;
```

`HUB_PORT` is imported only by `packages/dashboard/src/server/hub.ts` and
`packages/dashboard/src/server/mock.ts` (`const hubUrl = arg('--hub', \`ws://localhost:${HUB_PORT}\`);`).
No test asserts its value.

### `packages/dashboard/src/server/hub.ts` (188 lines) — the hub

- Lines 11–17, options:
  ```ts
  export interface HubOptions {
    port?: number;
    passphrase?: string;
    pwaUrl?: string;
    etherUrl?: string | null;
    distDir?: string;
  }
  ```
- Lines 19–23, the MIME table (no `.webmanifest` entry).
- Lines 25–35:
  ```ts
  const here = dirname(fileURLToPath(import.meta.url));

  export function startHub(opts: HubOptions = {}): Promise<{ port: number; close(): Promise<void> }> {
    const passphrase = opts.passphrase ?? 'demo-flock';
    const pwaUrl = opts.pwaUrl ?? 'http://localhost:5180/';
    const etherUrl = opts.etherUrl ?? null;
    const distDir = resolve(opts.distDir ?? join(here, '..', '..', 'dist'));
    const state = createHubState();
    ...
  ```
  `here` is `packages/dashboard/src/server`, so `distDir` defaults to
  `packages/dashboard/dist`. The web app's build output is `packages/web/dist`,
  i.e. `join(here, '..', '..', '..', 'web', 'dist')`. In the Docker image the
  repo lives at `/app`, so that resolves to `/app/packages/web/dist`, which
  `docker/Dockerfile.node` already builds.
- Lines 42–79, `serveStatic(req, res)`: answers `/config.json` with
  `JSON.stringify({ etherUrl })`; otherwise decodes the path, rejects `..` and
  `\0` with 400, appends `index.html` to paths ending in `/`, normalises,
  rejects anything outside `distDir` with 400, reads the file, and on a miss
  returns 404 if `distDir/index.html` exists or a plain-text "not built"
  notice if it does not:
  ```ts
  res.end('BirdSong hub is running, but the dashboard UI is not built. Run: npm run build -w @birdsong/dashboard\n');
  ```
- Lines 81–83: `createServer((req, res) => { void serveStatic(req, res); })`.
- Lines 86–96: WebSocket upgrades only for `/node` (nodes) and `/ui` (dashboard tabs).
- Lines 98–130, `onNode(ws)`: parses each message as a `TelemetryEvent`,
  validates `node`/`type`, stamps `event.t = Date.now()`, tracks `hello`,
  then:
  ```ts
      state.apply(event, now);
      sendUi({ type: 'event', event });
  ```
  and on close:
  ```ts
      state.markOffline(id, Date.now());
      sendUi({ type: 'nodeOffline', node: id });
  ```
- Lines 132–157, `onUi(ws)`: sends a snapshot, then parses each message as a
  `Command` (`if (typeof cmd !== 'object' || cmd === null) return;`) and
  forwards it to one node or all.
- Lines 159–176: `server.listen(opts.port ?? HUB_PORT, ...)`; `close()` terminates sockets.
- Lines 179–188, the entry point:
  ```ts
  if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.HUB_PORT ?? HUB_PORT);
    const hub = await startHub({
      port,
      passphrase: process.env.CHANNEL_PASSPHRASE ?? 'demo-flock',
      pwaUrl: process.env.PWA_URL ?? 'http://localhost:5180/',
      etherUrl: process.env.ETHER_URL || null,
    });
    console.log(`hub listening on ${hub.port}`);
  }
  ```

### `packages/dashboard/test/hub.test.ts` — the pattern for new hub tests

```ts
let hub: Awaited<ReturnType<typeof startHub>>;
beforeEach(async () => {
  hub = await startHub({ port: 0, distDir: '/nonexistent-dist' });
});
afterEach(async () => {
  await hub.close();
});

function open(path: string): Promise<{ ws: WebSocket; msgs: string[] }> { ... }   // WebSocket to the hub
const until = async (fn: () => boolean): Promise<void> => { ... };               // poll up to 2 s
const hello = (node: number): TelemetryEvent => ({ type: 'hello', node, species: 0, kind: 'sim', config: { ...DEFAULT_NODE_CONFIG }, t: 5 });
```

Lines 93–98 (**must be updated**, the response gains a field):

```ts
  it('serves a notice when dist is missing and config.json', async () => {
    const r = await fetch(`http://127.0.0.1:${hub.port}/`);
    expect(await r.text()).toContain('not built');
    const c = await (await fetch(`http://127.0.0.1:${hub.port}/config.json`)).json();
    expect(c).toEqual({ etherUrl: null });
  });
```

For temp directories, follow `packages/node-runtime/test/http.test.ts:13-19`
(`mkdtempSync(join(tmpdir(), 'bs-dist-'))` + `writeFileSync`).

### Dashboard client

- `packages/dashboard/src/components/Listen.tsx` is the only reader of
  `/config.json`. Its pattern (copy it for the new panel):
  ```tsx
  const [etherUrl, setEtherUrl] = useState<string | null>(null);
  useEffect(() => {
    fetch('/config.json').then((r) => r.json()).then(
      (c: { etherUrl?: string | null }) => setEtherUrl(c.etherUrl ?? null),
      () => {},
    );
    ...
  }, []);
  if (!etherUrl) return null;
  ...
  return (<div class="panel"> ... </div>);
  ```
- `packages/dashboard/src/app.tsx` lines 40–45 (the right-hand column):
  ```tsx
        <aside class="right">
          <JoinQr join={store.join} env={env} profile={profile} />
          <Controls nodes={nodes} events={events} focus={focus} env={env} profile={profile} camouflage={camouflage} />
          <Listen />
          <Feed messages={feed(events)} focus={focus} />
        </aside>
  ```
  `nodes` is `NodeSnapshot[]` (`{ node, species, kind, config, online, lastSeenAt }`,
  type exported from `@birdsong/core`). Container nodes, including all
  simulated compose nodes, report `kind: 'container'`; phones are `'browser'`.
- `packages/dashboard/src/hubClient.ts` line 17 — placeholder until the first snapshot arrives:
  `join: { pwaUrl: 'http://localhost:5180/', passphrase: 'demo-flock' },`
- `packages/dashboard/vite.config.ts` (dev server only):
  ```ts
  server: {
    proxy: {
      '/ui': { target: 'ws://localhost:7070', ws: true },
      '/config.json': 'http://localhost:7070',
    },
  },
  ```
- CSS: `.panel` and `h2` classes in `packages/dashboard/src/styles.css` style a side panel; colours come from CSS variables `--fg`, `--bg`, `--accent`.

**Conventions (match them):** relative imports end in `.ts` / `.tsx`;
type-only imports use `import type`; no `enum`, `namespace` or constructor
parameter properties (`erasableSyntaxOnly`); TypeScript pinned to 5.8. Do not
add dependencies or touch `package.json` / `package-lock.json`. Node built-ins
are imported as `node:fs`, `node:path`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Dashboard tests | `npx vitest run packages/dashboard` | all pass (was 12) |
| Typecheck | `npm run typecheck` | exit 0 |
| All unit tests | `npm test` | all pass (was 242 passed, 1 skipped) |
| Mesh e2e | `npm run test:e2e` | 6 passed |
| Build the web app | `npm run build -w @birdsong/web` | exit 0, writes `packages/web/dist` (git-ignored) |
| Build the dashboard | `npm run build -w @birdsong/dashboard` | exit 0, writes `packages/dashboard/dist` (git-ignored) |

## Scope

**In scope** (the only files you should modify or create):
- `packages/core/src/telemetry.ts` (port constants only)
- `packages/dashboard/src/server/hub.ts`
- `packages/dashboard/src/server/interactionLog.ts` (create)
- `packages/dashboard/test/hub.test.ts`
- `packages/dashboard/test/interactionLog.test.ts` (create)
- `packages/dashboard/src/components/NodeLinks.tsx` (create)
- `packages/dashboard/src/app.tsx` (mount `NodeLinks` only)
- `packages/dashboard/src/hubClient.ts` (line 17 placeholder only)
- `packages/dashboard/vite.config.ts`

**Out of scope** (do NOT touch):
- `packages/core/src/telemetry.ts` types (`TelemetryEvent`, `Command`, `HubToUi`) — the wire protocol stays the same.
- `packages/dashboard/src/server/state.ts` — the in-memory state the dashboard renders; the log is separate.
- `packages/dashboard/src/server/mock.ts` — it picks up the new `HUB_PORT` automatically.
- `packages/web/**`, `packages/node-runtime/**` — plan 011.
- `docker/**`, `scripts/**`, `README.md`, `docs/**`, `.gitignore` — plan 013.
- `ETHER_PORT` and `NODE_UI_PORT` values — nodes and the ether keep their internal ports.

## Git workflow

- Work on the current branch; commit only your paths:
  `git add <paths> && git commit -m "<message>" -- <paths>`.
- Message style follows `git log`, e.g. `feat(hub): serve the phone app at /app/ and log interactions`.
- Do NOT push.

## Steps

### Step 1: Port constants

In `packages/core/src/telemetry.ts` change `HUB_PORT = 7070` to `HUB_PORT = 3200`
and add, right after it:

```ts
/** Public port of the simulated mesh's reverse proxy. Keep in sync with docker/Caddyfile and docker/compose.sim.yml. */
export const PROXY_PORT = 3100;
```

`PROXY_PORT` is re-exported automatically: `packages/core/src/index.ts:6` is
`export * from './telemetry.ts';`.

**Verify**: `npm run typecheck -w @birdsong/core` → exit 0; `grep -rn "7070" packages/*/src packages/*/test | grep -v 'node-runtime/src/config.ts'` → no output. (The remaining 7070s are in `packages/dashboard/vite.config.ts`, fixed in step 7, and a help-text line in `packages/node-runtime/src/config.ts:37`, which plan 013 owns.)

### Step 2: Create `packages/dashboard/src/server/interactionLog.ts`

Write this module (it is the whole design; keep the names):

```ts
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Command, TelemetryEvent } from '@birdsong/core';

/** 'event' = telemetry from a node, 'command' = sent from a dashboard tab, 'offline' = a node's socket closed. */
export type LogKind = 'event' | 'command' | 'offline';
export interface LogEntry {
  seq: number;
  t: number;
  kind: LogKind;
  data: TelemetryEvent | Command | { node: number };
}
export interface InteractionLogOptions {
  /** NDJSON file to append to; null or absent = memory only. */
  file?: string | null;
  /** Rotate to `<file>.1` before a write would exceed this size. Default 10 MiB. */
  maxBytes?: number;
  /** Entries kept in memory for GET /api/log. Default 2000. */
  keep?: number;
  now?: () => number;
}
export interface InteractionLog {
  append(kind: LogKind, data: LogEntry['data']): LogEntry;
  /** Entries with seq > after, oldest first, at most `limit` (default 500). */
  since(after: number, limit?: number): LogEntry[];
  close(): void;
}

export function createInteractionLog(opts: InteractionLogOptions = {}): InteractionLog {
  const file = opts.file ?? null;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const keep = opts.keep ?? 2000;
  const now = opts.now ?? Date.now;
  const ring: LogEntry[] = [];
  let seq = 0;
  let size = 0;
  let fileOk = file !== null;
  if (file !== null) {
    mkdirSync(dirname(file), { recursive: true });
    try { size = statSync(file).size; } catch { size = 0; }
  }
  return {
    append(kind, data) {
      const entry: LogEntry = { seq: ++seq, t: now(), kind, data };
      ring.push(entry);
      if (ring.length > keep) ring.splice(0, ring.length - keep);
      if (fileOk && file !== null) {
        const line = JSON.stringify(entry) + '\n';
        const bytes = Buffer.byteLength(line);
        try {
          if (size > 0 && size + bytes > maxBytes) {
            renameSync(file, file + '.1');
            size = 0;
          }
          appendFileSync(file, line);
          size += bytes;
        } catch (err) {
          fileOk = false;
          console.error(`interaction log disabled: ${(err as Error).message}`);
        }
      }
      return entry;
    },
    since(after, limit = 500) {
      const out: LogEntry[] = [];
      for (const e of ring) {
        if (e.seq <= after) continue;
        out.push(e);
        if (out.length >= limit) break;
      }
      return out;
    },
    close() {},
  };
}
```

Synchronous appends are deliberate: the hub sees at most a few dozen events
per second from ≤ 8 nodes, and sync writes keep line order and make tests simple.

**Verify**: `npm run typecheck -w @birdsong/dashboard` → exit 0.

### Step 3: Test the log — `packages/dashboard/test/interactionLog.test.ts`

Use vitest (`import { describe, expect, it } from 'vitest'`), temp dirs via
`mkdtempSync(join(tmpdir(), 'bs-log-'))`, `readFileSync`, `existsSync`. Cases:

1. **memory only**: `createInteractionLog()`; append 3 entries; `since(0)` returns seqs `[1,2,3]`; `since(2)` returns `[3]`; `since(0, 2)` returns `[1,2]`.
2. **ring cap**: `keep: 3`; append 10; `since(0).map(e => e.seq)` equals `[8,9,10]`.
3. **file lines**: `file: <dir>/sub/log.ndjson` (the `sub` dir does not exist yet — proves `mkdirSync`); `now: () => 1234`; append 2; the file has 2 lines, each `JSON.parse`s to `{ seq, t: 1234, kind, data }`.
4. **rotation**: `maxBytes: 300`; append 10 entries with data `{ node: 1 }`; `existsSync(file + '.1')` is true; `statSync(file).size <= 300`; every line of both files parses as JSON.

**Verify**: `npx vitest run packages/dashboard/test/interactionLog.test.ts` → 4 passed.

### Step 4: Hub options, `/app/`, `/api/log`, `/config.json`

Edit `packages/dashboard/src/server/hub.ts`:

1. Extend `HubOptions`:
   ```ts
     /** Built phone/node web app served at /app/ (default packages/web/dist). */
     webDistDir?: string;
     /** NDJSON interaction log file; null/absent = memory only. */
     logFile?: string | null;
     /** Public base URL of the node reverse proxy (e.g. http://localhost:3100), sent to the dashboard in /config.json. */
     proxyUrl?: string | null;
   ```
2. Add `'.webmanifest': 'application/manifest+json'` to `MIME`.
3. In `startHub`, replace the `pwaUrl` line with a `let` that is filled in
   from the **bound** port once the server listens (so `port: 0` in tests gives
   a real port, not `:0`), and add the new values:
   ```ts
   let pwaUrl = opts.pwaUrl ?? '';
   const proxyUrl = opts.proxyUrl ?? null;
   const webDistDir = resolve(opts.webDistDir ?? join(here, '..', '..', '..', 'web', 'dist'));
   const log = createInteractionLog({ file: opts.logFile ?? null });
   ```
   and `import { createInteractionLog } from './interactionLog.ts';`.
   In the `server.listen(...)` callback, right after `const port = …;`, add
   `if (pwaUrl === '') pwaUrl = \`http://localhost:${port}/app/\`;`.
   `onUi` reads `pwaUrl` when a tab connects, which is always after listen.
4. Replace `serveStatic` with a router plus a reusable file server. Keep every
   existing check; only the root directory and the "not built" text become parameters:
   ```ts
   async function serveFrom(root: string, pathname: string, res: ServerResponse, notBuilt: string): Promise<void> {
     // body = the old serveStatic from `let rel: string;` to the end,
     // with distDir → root, url.pathname → pathname,
     // `join(distDir, 'index.html')` → `join(root, 'index.html')`,
     // and the "not built" res.end(...) text → notBuilt.
   }

   async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
     const url = new URL(req.url ?? '/', 'http://x');
     const p = url.pathname;
     if (p === '/config.json') {
       res.writeHead(200, { 'content-type': 'application/json' });
       res.end(JSON.stringify({ etherUrl, proxyUrl }));
       return;
     }
     if (p === '/api/log') {
       const after = Number(url.searchParams.get('since') ?? 0) || 0;
       const limit = Math.min(2000, Math.max(1, Math.floor(Number(url.searchParams.get('limit') ?? 500) || 500)));
       const entries = log.since(after, limit);
       res.writeHead(200, { 'content-type': 'application/json' });
       res.end(JSON.stringify({ entries, next: entries.length > 0 ? entries[entries.length - 1]!.seq : after }));
       return;
     }
     if (p === '/app') {
       res.writeHead(301, { location: '/app/' }).end();
       return;
     }
     if (p.startsWith('/app/')) {
       await serveFrom(webDistDir, p.slice('/app'.length), res, 'The phone app is not built. Run: npm run build -w @birdsong/web\n');
       return;
     }
     await serveFrom(distDir, p, res, 'BirdSong hub is running, but the dashboard UI is not built. Run: npm run build -w @birdsong/dashboard\n');
   }
   ```
   and change the server to `createServer((req, res) => { void route(req, res); })`.
   `serveFrom` receives the **raw** (still percent-encoded) path and decodes it
   itself, exactly as the old code did, so `/app/..%2f..%2fpackage.json` is
   rejected with 400.
5. Logging, three one-line additions:
   - in `onNode`, right after `state.apply(event, now);`: `log.append('event', event);`
   - in `onNode`'s `close` handler, right after `state.markOffline(id, Date.now());`: `log.append('offline', { node: id });`
   - in `onUi`'s message handler, right after the `if (typeof cmd !== 'object' || cmd === null) return;` line: `log.append('command', cmd);`
6. In `close()`, call `log.close();` before `wss.close();`.
7. Entry point: pass the new env vars, and pass `PWA_URL` only when set so the port-based default applies:
   ```ts
   const hub = await startHub({
     port,
     passphrase: process.env.CHANNEL_PASSPHRASE ?? 'demo-flock',
     pwaUrl: process.env.PWA_URL || undefined,
     etherUrl: process.env.ETHER_URL || null,
     proxyUrl: process.env.PROXY_URL || null,
     logFile: process.env.HUB_LOG_FILE || null,
     webDistDir: process.env.WEB_DIST || undefined,
   });
   console.log(`hub listening on ${hub.port}${process.env.HUB_LOG_FILE ? `, logging to ${process.env.HUB_LOG_FILE}` : ''}`);
   ```

**Verify**: `npm run typecheck -w @birdsong/dashboard` → exit 0. `npx vitest run packages/dashboard/test/hub.test.ts` → exactly one failure, the `config.json` expectation (fixed next step).

### Step 5: Hub tests — `packages/dashboard/test/hub.test.ts`

1. Update line 97 to `expect(c).toEqual({ etherUrl: null, proxyUrl: null });`.
2. Add these tests inside `describe('hub', …)`. Where a test needs other
   options, restart the hub at the top of the test:
   `await hub.close(); hub = await startHub({ port: 0, distDir: '/nonexistent-dist', ...extra });`
   (the existing `afterEach` closes it).
   - **config.json carries proxyUrl**: `proxyUrl: 'http://localhost:3100'` → `/config.json` equals `{ etherUrl: null, proxyUrl: 'http://localhost:3100' }`.
   - **/api/log records events, commands and offline in order**: open `/node`, send `hello(1)` and a `heard` event (copy the one from the first test); poll `GET /api/log` until it has 2 entries; open `/ui` and send `{ type: 'configure', node: 1, patch: { muted: true } }`; poll until 3 entries; close the node socket; poll until 4. Assert `entries.map(e => e.kind)` equals `['event','event','command','offline']`, seqs are `[1,2,3,4]`, `GET /api/log?since=2` returns seqs `[3,4]` with `next: 4`, `?limit=1` returns one entry, and `?since=99` returns `{ entries: [], next: 99 }`. (Write a small `const getLog = async (q = '') => (await fetch(\`http://127.0.0.1:${hub.port}/api/log${q}\`)).json()` helper; poll with a loop like `until`, but async.)
   - **/app serves the web app**: temp dir with `index.html` = `<p>app</p>` and `manifest.webmanifest` = `{}`; restart with `webDistDir: dir`. Assert: `fetch('/app', { redirect: 'manual' })` → status 301, `location` header `/app/`; `/app/` → body `<p>app</p>`; `/app/manifest.webmanifest` → content-type `application/manifest+json`; `/app/..%2f..%2fpackage.json` → status 400; `/app/missing.js` → status 404; `/` still returns the dashboard "not built" text.
   - **/app without a build**: restart with `webDistDir: '/nonexistent-web'`; `/app/` body contains `npm run build -w @birdsong/web`.
   - **writes the log file**: temp dir; restart with `logFile: join(dir, 'logs', 'i.ndjson')`; send `hello(2)` on `/node`; poll until the file exists and contains `"hello"`; the first line parses to an object with `kind: 'event'` and `data.node === 2`.

**Verify**: `npx vitest run packages/dashboard` → all pass (12 existing + 4 log + 5 hub = 21).

### Step 6: "Node pages" panel in the dashboard

Create `packages/dashboard/src/components/NodeLinks.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import type { NodeSnapshot } from '@birdsong/core';

/** Links to each container node's page, served by the hub at /app/ and pointed at the node through the proxy. */
export function NodeLinks(props: { nodes: NodeSnapshot[] }) {
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  useEffect(() => {
    fetch('/config.json').then((r) => r.json()).then(
      (c: { proxyUrl?: string | null }) => setProxyUrl(c.proxyUrl ?? null),
      () => {},
    );
  }, []);
  const nodes = props.nodes.filter((n) => n.online && n.kind === 'container');
  if (!proxyUrl || nodes.length === 0) return null;
  const base = proxyUrl.replace(/\/+$/, '');
  return (
    <div class="panel">
      <h2>Node pages</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
        {nodes.map((n) => (
          <a key={n.node} style={{ color: 'var(--accent)' }} target="_blank" rel="noopener"
             href={`/app/?runtime=remote&node=${encodeURIComponent(`${base}/nodes/${n.node}`)}`}>
            node {n.node}
          </a>
        ))}
      </div>
    </div>
  );
}
```

In `packages/dashboard/src/app.tsx`, import it (`import { NodeLinks } from './components/NodeLinks.tsx';`)
and add `<NodeLinks nodes={nodes} />` on the line after `<Listen />`.

In `packages/dashboard/src/hubClient.ts` line 17 change the placeholder to
`'http://localhost:3200/app/'`.

**Verify**: `npm run typecheck -w @birdsong/dashboard` → exit 0; `npm run build -w @birdsong/dashboard` → exit 0.

### Step 7: Dev proxy

In `packages/dashboard/vite.config.ts` point both targets at 3200 and add the new routes:

```ts
    proxy: {
      '/ui': { target: 'ws://localhost:3200', ws: true },
      '/config.json': 'http://localhost:3200',
      '/api': 'http://localhost:3200',
      '/app': 'http://localhost:3200',
    },
```

**Verify**: `grep -rn 7070 packages/*/src packages/*/test packages/dashboard/vite.config.ts | grep -v 'node-runtime/src/config.ts'` → no output.

### Step 8: Run the hub for real

```bash
npm run build -w @birdsong/web && npm run build -w @birdsong/dashboard
HUB_LOG_FILE="$(mktemp -d)/i.ndjson" PROXY_URL=http://localhost:3100 node packages/dashboard/src/server/hub.ts &
HUB=$!; sleep 1
curl -s localhost:3200/ | grep -c 'not built'                    # 0  (the real dashboard, not the notice)
curl -s localhost:3200/app/ | grep -c '<div id="app">'            # 1  (the built web app's index.html)
curl -s localhost:3200/config.json                                # {"etherUrl":null,"proxyUrl":"http://localhost:3100"}
curl -s localhost:3200/api/log                                    # {"entries":[],"next":0}
kill $HUB
```

**Verify**: the four outputs match the comments. (Status codes alone prove
nothing here: the "not built" notice is also served with HTTP 200.) Then run the mock flock
against it to confirm logging end to end (optional): start the hub again,
run `npm run mock -w @birdsong/dashboard` for ~10 s, then
`curl -s 'localhost:3200/api/log?limit=3'` shows 3 entries.

### Step 9: Full regression

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass; `npm run test:e2e` → 6 passed.

## Test plan

- `packages/dashboard/test/interactionLog.test.ts` (new): memory-only `since`/`limit`, ring cap, file lines + directory creation, rotation.
- `packages/dashboard/test/hub.test.ts`: updated `config.json` expectation; `proxyUrl` in config; `/api/log` order, `since`, `limit`, `next`; `/app` redirect, index, MIME, traversal 400, missing 404, not-built notice; log file written.
- Pattern: the existing tests in `hub.test.ts` (restart the hub with `startHub({ port: 0, … })`, `open()` WebSockets, `until()` polling).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `npx vitest run packages/dashboard` reports ≥ 21 passed
- [ ] `npm run test:e2e` → 6 passed
- [ ] `grep -n "HUB_PORT = 3200" packages/core/src/telemetry.ts` → 1 match; `grep -n "PROXY_PORT = 3100" packages/core/src/telemetry.ts` → 1 match
- [ ] `grep -rn "7070\|5180" packages/*/src packages/*/test packages/dashboard/vite.config.ts | grep -v 'node-runtime/src/config.ts'` → no output
- [ ] Step 8 curl outputs match
- [ ] `git log -1 --name-only` lists only in-scope files
- [ ] `plans/README.md` row 012 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations above does not match the excerpts.
- `grep -rn "config.json" packages --include='*.ts' --include='*.tsx' | grep -v node_modules`
  lists a file other than these expected ones: `dashboard/src/server/hub.ts`
  (serves it), `dashboard/vite.config.ts` (dev proxy), `dashboard/src/components/Listen.tsx`,
  `dashboard/src/components/NodeLinks.tsx` (yours), `dashboard/test/hub.test.ts`.
- A test other than the `config.json` expectation fails after step 4.
- Making `/app/` work seems to need a change in `packages/web` (for example the
  built `index.html` uses absolute `/assets/...` URLs). That is a plan 011 /
  vite-config question; report it.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- `seq` restarts at 1 when the hub restarts, so a log file that spans restarts
  has repeated seqs; use `t` to order across restarts. A client polling
  `/api/log?since=` should reset to 0 when `next` goes backwards.
- The log records everything the hub sees, including the plaintext of
  `decoded` events and `send` commands. That matches what the dashboard
  already shows; do not ship the log file anywhere public.
- Plan 013 sets `HUB_LOG_FILE`, `PROXY_URL` and `ETHER_URL` in compose and mounts `logs/`.
- Deferred: a dashboard "Interactions" panel that reads `/api/log`; real
  laptop nodes are not reachable through the proxy, so their links are only
  shown when `proxyUrl` is set (the simulated mesh) and will not work for real laptops.
- Reviewers: check that `serveFrom` kept both traversal checks (`..`/`\0` and the `startsWith(root + sep)` check).
