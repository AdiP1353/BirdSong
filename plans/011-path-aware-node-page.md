# Plan 011: The node page and CLI work when a node sits under a path prefix

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ff670cc..HEAD -- packages/web/src/runtime.ts packages/web/src/app.tsx packages/web/src/runtime.test.ts packages/node-runtime/src/http.ts packages/node-runtime/test/http.test.ts packages/node-runtime/src/cli.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 012 can run at the same time; plan 013 needs this one)
- **Category**: tech-debt (prerequisite for the two-port layout)
- **Planned at**: commit `ff670cc`, 2026-11-14

## Why this matters

The simulated mesh is moving to one public port (3100). A reverse proxy (Caddy)
will forward `http://localhost:3100/nodes/3/...` to node 3's server with the
`/nodes/3` prefix stripped, so the node itself still sees `/`, `/api/state`
and so on. Today three things break under such a prefix:

1. The node page (`?runtime=remote`) calls the API at the **origin root**
   (`http://localhost:3100/api/state`), not under `/nodes/3/`.
2. The node's `/` redirect sends the browser to the absolute `/?runtime=remote`,
   which leaves `/nodes/3/` (lands on the proxy root).
3. The CLI can only target `http://localhost:<port>`, and the simulated nodes
   will no longer have their own host ports.

This plan makes all three path-aware. It also adds a `?node=<url>` query
parameter so one copy of the page (served later by the hub at `/app/`, plan 012)
can control any node. Nothing about sound, the engine or telemetry changes.

## Current state

Repository: TypeScript monorepo (npm workspaces), packages under `packages/`.
Node ≥ 24 runs `.ts` files directly (native type stripping, no build step for Node).

- `packages/web/src/runtime.ts` — the browser runtimes. `createRemoteRuntime`
  controls a container node over HTTP. Lines 62–64 today:

  ```ts
  export function createRemoteRuntime(baseUrl: string = location.origin): RemoteRuntime {
    const base = baseUrl.replace(/\/+$/, '');
    const wsUrl = `${base.replace(/^http/, 'ws')}/api/events`;
  ```

  Every request is `fetch(base + path)` with `path` like `'/api/state'`
  (line 89), so a base that ends in `/nodes/3` already works. Only the
  **default** is wrong.

- `packages/web/src/app.tsx` — the page's root component. Line 10 and line 31:

  ```ts
  const remote = new URLSearchParams(location.search).get('runtime') === 'remote';
  ```
  ```ts
  const [runtime, setRuntime] = useState<Runtime | null>(() => (remote ? createRemoteRuntime() : null));
  ```

  Line 33: `const [error, setError] = useState<string | null>(null);`
  Line 92 shows the Join screen with that error when there is no runtime:
  `{!runtime && <Join initial={initialJoin} error={error} busy={busy} onJoin={join} />}`

- `packages/web/src/runtime.test.ts` — vitest tests that stub `globalThis.fetch`.
  This is the pattern for the new tests:

  ```ts
  it('send posts JSON and returns msgId', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ msgId: 42 }), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    const rt = createRemoteRuntime('http://localhost:8080');
    expect(await rt.send('hello')).toBe(42);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/send');
    ...
    rt.close();
  });
  ```

- `packages/node-runtime/src/http.ts` — the node's HTTP server. Lines 116–120:

  ```ts
  if (p === '/' && url.search === '') {
    res.writeHead(302, { Location: '/?runtime=remote' });
    res.end();
    return;
  }
  ```

  CORS is already `Access-Control-Allow-Origin: *` on every `/api/*` response
  (line 44) and OPTIONS preflight is answered (lines 76–84). Do not change that.

- `packages/node-runtime/test/http.test.ts` — lines 50–53:

  ```ts
  it('serves static files, redirects / and blocks traversal', async () => {
    const { base } = await setup();
    const root = await fetch(`${base}/`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('/?runtime=remote');
  ```

- `packages/node-runtime/src/cli.ts` — line 2:

  ```ts
  const base = `http://localhost:${process.env['BIRDSONG_PORT'] ?? 8080}`;
  ```

  All calls are `fetch(base + path)` with `path` like `'/api/state'`.

**Conventions (match them):** relative imports end in `.ts` / `.tsx`;
type-only imports use `import type`; no `enum`, `namespace` or constructor
parameter properties (`erasableSyntaxOnly` is on); TypeScript is pinned to 5.8.
Do not add dependencies or touch `package.json` / `package-lock.json`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests (this plan) | `npx vitest run packages/web packages/node-runtime` | all pass (web 6 → 15, node-runtime 15 pass + 1 skipped) |
| Typecheck (this plan) | `npm run typecheck -w @birdsong/web -w @birdsong/node-runtime` | exit 0, no errors |
| All unit tests | `npm test` | all pass (was 242 passed, 1 skipped) |
| Smoke test | `bash scripts/smoke-ether.sh` | last line `smoke ok` (takes ~10 s) |

## Scope

**In scope** (the only files you should modify):
- `packages/web/src/runtime.ts`
- `packages/web/src/app.tsx`
- `packages/web/src/runtime.test.ts`
- `packages/node-runtime/src/http.ts`
- `packages/node-runtime/test/http.test.ts`
- `packages/node-runtime/src/cli.ts`

**Out of scope** (do NOT touch):
- `packages/web/vite.config.ts` — `base: './'` already makes asset URLs relative, which is what a path prefix needs.
- `packages/dashboard/**`, `docker/**`, `scripts/**`, `packages/core/**` — other plans (012, 013) own them.
- README / docs — plan 013 updates them (including the new `BIRDSONG_URL` variable).
- The local (phone) runtime and anything audio-related.

## Git workflow

- Work on the current branch (the repo has no branch convention; other plans commit to `main`).
- Commit only your paths: `git add <paths> && git commit -m "<message>" -- <paths>`.
- Message style follows `git log`, e.g. `feat(web): path-aware remote runtime base and ?node= parameter`, `fix(runtime): relative redirect so the node page works under a proxy prefix`.
- Do NOT push.

## Steps

### Step 1: Add `nodeBaseFromLocation` to `runtime.ts`

Add this exported pure function to `packages/web/src/runtime.ts`, just above
`createRemoteRuntime`:

```ts
/**
 * Base URL of the node a remote page controls.
 * `nodeParam` (the page's `?node=` value) wins and must be an http(s) URL.
 * Otherwise the node is the server that served this page, at the page's
 * directory, so a page at /nodes/3/ talks to /nodes/3/api/...
 * The result never ends in '/'.
 */
export function nodeBaseFromLocation(href: string, nodeParam: string | null): string {
  if (nodeParam !== null && nodeParam !== '') {
    let u: URL;
    try { u = new URL(nodeParam); } catch { throw new Error(`node must be an http(s) URL, got: ${nodeParam}`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`node must be an http(s) URL, got: ${nodeParam}`);
    return u.href.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
  return new URL('.', href).href.replace(/\/+$/, '');
}
```

Leave the `createRemoteRuntime` default (`location.origin`) as it is; the
caller in step 2 always passes a base.

**Verify**: `npm run typecheck -w @birdsong/web` → exit 0.

### Step 2: Test `nodeBaseFromLocation` and a prefixed base

Append to `packages/web/src/runtime.test.ts` (import `nodeBaseFromLocation`
alongside `createRemoteRuntime`). Add these cases:

| Test | Input | Expected |
|---|---|---|
| root page | `('http://localhost:8080/?runtime=remote', null)` | `'http://localhost:8080'` |
| prefixed page | `('http://localhost:3100/nodes/3/?runtime=remote', null)` | `'http://localhost:3100/nodes/3'` |
| prefixed index.html | `('http://localhost:3100/nodes/3/index.html?runtime=remote', null)` | `'http://localhost:3100/nodes/3'` |
| empty param ignored | `('http://localhost:8080/', '')` | `'http://localhost:8080'` |
| valid `?node=` | `('http://localhost:3200/app/?runtime=remote', 'http://localhost:3100/nodes/2/')` | `'http://localhost:3100/nodes/2'` |
| rejects javascript: | `('http://localhost:3200/app/', 'javascript:alert(1)')` | throws `/http\(s\) URL/` |
| rejects ftp: | `('http://localhost:3200/app/', 'ftp://x/y')` | throws `/http\(s\) URL/` |
| rejects garbage | `('http://localhost:3200/app/', 'not a url')` | throws `/http\(s\) URL/` |

Plus one fetch test modelled on the existing `send posts JSON` test:
`createRemoteRuntime('http://localhost:3100/nodes/3')` → `send('hi')` calls
`http://localhost:3100/nodes/3/api/send`.

**Verify**: `npx vitest run packages/web` → all pass, at least 9 new tests.

### Step 3: Use it in `app.tsx`

Replace line 10 and the `useState` initialisers at lines 31 and 33 so that:

```ts
const params = new URLSearchParams(location.search);
const remote = params.get('runtime') === 'remote';
let remoteBase: string | null = null;
let remoteError: string | null = null;
if (remote) {
  try { remoteBase = nodeBaseFromLocation(location.href, params.get('node')); }
  catch (e) { remoteError = e instanceof Error ? e.message : String(e); }
}
```

(module level, where line 10 is now), and inside `App`:

```ts
const [runtime, setRuntime] = useState<Runtime | null>(() => (remoteBase !== null ? createRemoteRuntime(remoteBase) : null));
...
const [error, setError] = useState<string | null>(remoteError);
```

Import `nodeBaseFromLocation` from `./runtime.ts` in the existing import on
line 7. The `remote` constant stays (the new block uses it). An invalid `?node=` therefore shows the Join screen with the error text, which
is acceptable for this tool.

**Verify**: `npm run typecheck -w @birdsong/web` → exit 0; `npm run build -w @birdsong/web` → exit 0 (writes `packages/web/dist`, which is git-ignored).

### Step 4: Make the node's redirect relative

In `packages/node-runtime/src/http.ts` line 117 change
`{ Location: '/?runtime=remote' }` to `{ Location: '?runtime=remote' }`.
A relative `Location` that is only a query resolves against the current path,
so `/nodes/3/` → `/nodes/3/?runtime=remote` and `/` → `/?runtime=remote`.

In `packages/node-runtime/test/http.test.ts` line 53 change the expectation to
`'?runtime=remote'`.

**Verify**: `npx vitest run packages/node-runtime` → all pass (15 passed, 1 skipped).

### Step 5: Let the CLI target any base URL

In `packages/node-runtime/src/cli.ts` replace line 2 with:

```ts
const base = (process.env['BIRDSONG_URL'] ?? `http://localhost:${process.env['BIRDSONG_PORT'] ?? 8080}`).replace(/\/+$/, '');
```

Also add one line to the `usage()` message (or a comment above line 2):
`BIRDSONG_URL (e.g. http://localhost:3100/nodes/3) overrides BIRDSONG_PORT.`

**Verify**:
`npm run typecheck -w @birdsong/node-runtime` → exit 0, and
`BIRDSONG_URL=http://127.0.0.1:9/nodes/3 node packages/node-runtime/src/cli.ts state; echo "exit $?"`
→ prints an error containing `cannot reach the node at http://127.0.0.1:9/nodes/3` and a non-zero exit.

### Step 6: Full regression

**Verify**:
- `npm run typecheck` → exit 0
- `npm test` → 0 failures (the total depends on whether plan 012 has landed; judge only failures)
- `bash scripts/smoke-ether.sh` → last line `smoke ok`

## Test plan

- `packages/web/src/runtime.test.ts`: the 8 `nodeBaseFromLocation` cases and the prefixed-base fetch case from step 2.
- `packages/node-runtime/test/http.test.ts`: the updated redirect expectation (step 4).
- No browser test: `app.tsx` is a thin wiring change; the helper carries the logic.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with 0 failures; `npx vitest run packages/web` reports ≥ 15 passed
- [ ] `grep -n "'/?runtime=remote'" packages/node-runtime/src/http.ts` → no match
- [ ] `grep -n "BIRDSONG_URL" packages/node-runtime/src/cli.ts` → at least one match
- [ ] `grep -n "nodeBaseFromLocation" packages/web/src/app.tsx` → at least one match
- [ ] `bash scripts/smoke-ether.sh` prints `smoke ok`
- [ ] `git log -1 --name-only` lists only in-scope files
- [ ] `plans/README.md` row 011 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations above does not match the excerpts.
- Anything else in `packages/web/src` builds API or WebSocket URLs from
  `location.origin` or `location.host` (check: `grep -rn "location\.\(origin\|host\)" packages/web/src`).
  Only the default parameter in `runtime.ts:62` is expected.
- A test outside your files fails because of the relative redirect.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Plan 012 makes the hub serve this same page at `/app/` and links to it as
  `/app/?runtime=remote&node=<url-encoded node base>`. Keep the `node` parameter name.
- Plan 013 documents `BIRDSONG_URL` in the README.
- The page at `/app/?runtime=remote` **without** `node=` will call
  `/app/api/...` on the hub and fail (HTTP 404). That is expected: `/app/` needs `node=`.
- Reviewers: check that the redirect still works for a node opened directly at `http://localhost:8080/`.
