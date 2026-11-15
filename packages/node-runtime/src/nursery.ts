// Nursery: starts and stops bird containers for the simulated mesh, so the dashboard can add and remove nodes.
// It talks to the Docker Engine API over the Docker socket and is reached only by the hub (bearer token, no
// published port). An added bird is a container like bird0..bird7: same image, same flags, reachable on the
// compose network as `bird<id>` (so the proxy's /nodes/<id>/ route finds it).
import { createServer, request } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export interface NurseryOptions {
  port?: number;
  /** Path of the Docker socket (default /var/run/docker.sock). */
  dockerSocket?: string;
  /** Bearer token the hub must send. Required. */
  token: string;
  /** Flags every new bird gets before its own (--id, --x, --y, --env, ...). */
  baseArgs: string[];
  /** Image for new birds. Default: this container's own image. */
  image?: string;
  /** Network for new birds. Default: this container's first network. */
  network?: string;
  /** Docker API client; injectable for tests. */
  docker?: DockerApi;
}

export interface BirdSpec {
  id: number;
  x?: number;
  y?: number;
  env?: string;
  profile?: string;
  relayLimit?: number;
}

export interface DockerApi {
  call(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

const LABEL = 'birdsong.nursery';

export function dockerOverSocket(socketPath: string): DockerApi {
  return {
    call(method, path, body) {
      return new Promise((ok, fail) => {
        const data = body === undefined ? undefined : JSON.stringify(body);
        const req = request(
          {
            socketPath, path: `/v1.41${path}`, method,
            headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              let parsed: unknown = text;
              try { parsed = text ? JSON.parse(text) : null; } catch { /* plain text */ }
              ok({ status: res.statusCode ?? 0, body: parsed });
            });
          },
        );
        req.on('error', fail);
        if (data) req.write(data);
        req.end();
      });
    },
  };
}

interface ContainerSummary {
  Id: string;
  Names: string[];
  State: string;
  Labels: Record<string, string>;
}

/** The bird id a container plays: a nursery bird's label, or a compose service named bird<id>. */
function birdId(c: ContainerSummary): number | null {
  const own = c.Labels[`${LABEL}.id`];
  if (own !== undefined) return Number(own);
  const m = /^bird(\d{1,3})$/.exec(c.Labels['com.docker.compose.service'] ?? '');
  return m ? Number(m[1]) : null;
}

export function startNursery(opts: NurseryOptions): Promise<{ port: number; close(): Promise<void> }> {
  const docker = opts.docker ?? dockerOverSocket(opts.dockerSocket ?? '/var/run/docker.sock');
  let self: Promise<{ image: string; network: string; project: string | null }> | null = null;

  /** This container's image, network and compose project, so new birds join the same flock. */
  function whoAmI(): Promise<{ image: string; network: string; project: string | null }> {
    self ??= (async () => {
      if (opts.image && opts.network) return { image: opts.image, network: opts.network, project: null };
      const r = await docker.call('GET', `/containers/${encodeURIComponent(hostname())}/json`);
      if (r.status !== 200) throw new Error(`cannot inspect the nursery's own container (HTTP ${r.status})`);
      const info = r.body as { Config: { Image: string; Labels?: Record<string, string> }; NetworkSettings: { Networks: Record<string, unknown> } };
      return {
        image: opts.image ?? info.Config.Image,
        network: opts.network ?? Object.keys(info.NetworkSettings.Networks)[0]!,
        project: info.Config.Labels?.['com.docker.compose.project'] ?? null,
      };
    })();
    self.catch(() => { self = null; });
    return self;
  }

  async function birds(): Promise<Array<ContainerSummary & { bird: number }>> {
    const me = await whoAmI();
    const r = await docker.call('GET', '/containers/json?all=true');
    if (r.status !== 200) throw new Error(`docker: HTTP ${r.status}`);
    const out: Array<ContainerSummary & { bird: number }> = [];
    for (const c of r.body as ContainerSummary[]) {
      const id = birdId(c);
      if (id === null) continue;
      const mine = c.Labels[LABEL] === '1';
      const sameProject = me.project === null || c.Labels['com.docker.compose.project'] === me.project;
      if (mine || sameProject) out.push({ ...c, bird: id });
    }
    return out;
  }

  async function add(spec: BirdSpec): Promise<{ id: number; started: 'existing' | 'new' }> {
    const list = await birds();
    const existing = list.find((c) => c.bird === spec.id);
    if (existing) {
      if (existing.State === 'running') throw Object.assign(new Error(`bird ${spec.id} is already running`), { status: 409 });
      const s = await docker.call('POST', `/containers/${existing.Id}/start`);
      if (s.status !== 204 && s.status !== 304) throw new Error(`docker start: HTTP ${s.status} ${JSON.stringify(s.body)}`);
      return { id: spec.id, started: 'existing' };
    }
    const me = await whoAmI();
    const args = [
      ...opts.baseArgs,
      '--id', String(spec.id), '--x', String(spec.x ?? 0), '--y', String(spec.y ?? 0), '--port', '8080',
      ...(spec.env ? ['--env', spec.env] : []),
      ...(spec.profile ? ['--profile', spec.profile] : []),
      ...(spec.relayLimit !== undefined ? ['--relay-limit', String(spec.relayLimit)] : []),
    ];
    const name = `birdsong-nursery-bird${spec.id}`;
    const c = await docker.call('POST', `/containers/create?name=${name}`, {
      Image: me.image,
      Cmd: args,
      Labels: { [LABEL]: '1', [`${LABEL}.id`]: String(spec.id) },
      HostConfig: { RestartPolicy: { Name: 'on-failure' } },
      NetworkingConfig: { EndpointsConfig: { [me.network]: { Aliases: [`bird${spec.id}`] } } },
    });
    if (c.status !== 201) throw new Error(`docker create: HTTP ${c.status} ${JSON.stringify(c.body)}`);
    const id = (c.body as { Id: string }).Id;
    const s = await docker.call('POST', `/containers/${id}/start`);
    if (s.status !== 204) {
      await docker.call('DELETE', `/containers/${id}?force=true`);
      throw new Error(`docker start: HTTP ${s.status} ${JSON.stringify(s.body)}`);
    }
    return { id: spec.id, started: 'new' };
  }

  /** Nursery birds are removed; compose birds (bird0..bird7) are only stopped, so `compose up` brings them back. */
  async function remove(id: number): Promise<void> {
    const found = (await birds()).filter((c) => c.bird === id);
    if (found.length === 0) throw Object.assign(new Error(`no bird ${id}`), { status: 404 });
    for (const c of found) {
      if (c.Labels[LABEL] === '1') {
        const r = await docker.call('DELETE', `/containers/${c.Id}?force=true`);
        if (r.status !== 204 && r.status !== 404) throw new Error(`docker rm: HTTP ${r.status}`);
      } else if (c.State === 'running') {
        const r = await docker.call('POST', `/containers/${c.Id}/stop?t=2`);
        if (r.status !== 204 && r.status !== 304) throw new Error(`docker stop: HTTP ${r.status}`);
      }
    }
  }

  function reply(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((ok, fail) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 4096) { fail(new Error('body too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
      req.on('error', fail);
    });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${opts.token}`) { reply(res, 401, { error: 'bad or missing token' }); return; }
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    try {
      if (path === '/birds' && req.method === 'GET') {
        reply(res, 200, (await birds()).map((c) => ({ id: c.bird, running: c.State === 'running', added: c.Labels[LABEL] === '1' })));
        return;
      }
      if (path === '/birds' && req.method === 'POST') {
        const spec = JSON.parse(await readBody(req)) as BirdSpec;
        if (!Number.isInteger(spec.id) || spec.id < 0 || spec.id > 127) { reply(res, 400, { error: 'id must be an integer 0..127' }); return; }
        for (const k of ['x', 'y', 'relayLimit'] as const) {
          if (spec[k] !== undefined && !Number.isFinite(spec[k])) { reply(res, 400, { error: `${k} must be a number` }); return; }
        }
        for (const k of ['env', 'profile'] as const) {
          if (spec[k] !== undefined && !/^[a-z]{1,16}$/.test(spec[k]!)) { reply(res, 400, { error: `bad ${k}` }); return; }
        }
        reply(res, 201, await add(spec));
        return;
      }
      const m = /^\/birds\/(\d{1,3})$/.exec(path);
      if (m && req.method === 'DELETE') {
        await remove(Number(m[1]));
        reply(res, 200, { id: Number(m[1]), removed: true });
        return;
      }
      reply(res, 404, { error: 'not found' });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      reply(res, status, { error: (err as Error).message });
    }
  }

  const server = createServer((req, res) => { void route(req, res); });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(opts.port ?? 7090, () => {
      const addr = server.address();
      ok({
        port: typeof addr === 'object' && addr ? addr.port : 0,
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = process.env.NURSERY_TOKEN;
  if (!token) {
    console.error('NURSERY_TOKEN is required');
    process.exit(2);
  }
  const n = await startNursery({
    port: Number(process.env.NURSERY_PORT ?? 7090),
    dockerSocket: process.env.DOCKER_SOCKET || undefined,
    token,
    baseArgs: (process.env.NURSERY_BIRD_ARGS ?? '').split(' ').filter(Boolean),
    image: process.env.NURSERY_IMAGE || undefined,
    network: process.env.NURSERY_NETWORK || undefined,
  });
  console.log(`nursery listening on ${n.port}`);
}
