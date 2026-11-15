import { afterEach, describe, expect, it } from 'vitest';
import { startNursery } from '../src/nursery.ts';
import type { DockerApi } from '../src/nursery.ts';

interface Fake { Id: string; Names: string[]; State: string; Labels: Record<string, string> }

function fakeDocker(containers: Fake[]): DockerApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(method, path, body) {
      calls.push(`${method} ${path}${body ? ' ' + JSON.stringify(body) : ''}`);
      if (path.startsWith('/containers/json')) return { status: 200, body: containers };
      if (method === 'POST' && path.startsWith('/containers/create')) {
        const b = body as { Labels: Record<string, string> };
        containers.push({ Id: 'new1', Names: ['/x'], State: 'created', Labels: b.Labels });
        return { status: 201, body: { Id: 'new1' } };
      }
      const start = /^\/containers\/(\w+)\/start$/.exec(path);
      if (start) { containers.find((c) => c.Id === start[1])!.State = 'running'; return { status: 204, body: null }; }
      const stop = /^\/containers\/(\w+)\/stop/.exec(path);
      if (stop) { containers.find((c) => c.Id === stop[1])!.State = 'exited'; return { status: 204, body: null }; }
      const del = /^\/containers\/(\w+)\?force=true$/.exec(path);
      if (method === 'DELETE' && del) {
        containers.splice(containers.findIndex((c) => c.Id === del[1]), 1);
        return { status: 204, body: null };
      }
      return { status: 404, body: { message: 'no' } };
    },
  };
}

const compose = (id: number, state = 'running'): Fake => ({
  Id: `c${id}`, Names: [`/docker-bird${id}-1`], State: state,
  Labels: { 'com.docker.compose.service': `bird${id}`, 'com.docker.compose.project': 'docker' },
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => { await close?.(); close = null; });

async function start(docker: DockerApi) {
  const n = await startNursery({ port: 0, token: 't', baseArgs: ['--audio', 'ether'], image: 'birdsong-node', network: 'docker_default', docker });
  close = n.close;
  const base = `http://127.0.0.1:${n.port}`;
  const call = (method: string, path: string, body?: unknown, token = 't') => fetch(base + path, {
    method, headers: { authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return call;
}

describe('nursery', () => {
  it('needs the token', async () => {
    const call = await start(fakeDocker([]));
    expect((await call('GET', '/birds', undefined, 'wrong')).status).toBe(401);
  });

  it('creates a new bird container with the alias bird<id> and the flock flags', async () => {
    const docker = fakeDocker([compose(0)]);
    const call = await start(docker);
    const r = await call('POST', '/birds', { id: 9, x: 1, y: 2, env: 'jungle', relayLimit: 3 });
    expect(r.status).toBe(201);
    const create = docker.calls.find((c) => c.startsWith('POST /containers/create'))!;
    const body = JSON.parse(create.slice(create.indexOf(' {') + 1));
    expect(create).toContain('name=birdsong-nursery-bird9');
    expect(body.Image).toBe('birdsong-node');
    expect(body.Cmd).toEqual(['--audio', 'ether', '--id', '9', '--x', '1', '--y', '2', '--port', '8080', '--env', 'jungle', '--relay-limit', '3']);
    expect(body.NetworkingConfig.EndpointsConfig.docker_default.Aliases).toEqual(['bird9']);
    expect(await (await call('GET', '/birds')).json()).toEqual([
      { id: 0, running: true, added: false }, { id: 9, running: true, added: true },
    ]);
    expect((await call('POST', '/birds', { id: 9 })).status).toBe(409);
    expect((await call('POST', '/birds', { id: 200 })).status).toBe(400);
    expect((await call('POST', '/birds', { id: 5, env: 'x y' })).status).toBe(400);
  });

  it('stops a compose bird (so compose can bring it back), restarts it on add, and deletes added birds', async () => {
    const docker = fakeDocker([compose(3)]);
    const call = await start(docker);
    expect((await call('DELETE', '/birds/3')).status).toBe(200);
    expect(docker.calls).toContain('POST /containers/c3/stop?t=2');
    expect((await call('POST', '/birds', { id: 3 })).status).toBe(201);
    expect(docker.calls).toContain('POST /containers/c3/start');
    expect(docker.calls.some((c) => c.startsWith('POST /containers/create'))).toBe(false);
    await call('POST', '/birds', { id: 12 });
    expect((await call('DELETE', '/birds/12')).status).toBe(200);
    expect(docker.calls).toContain('DELETE /containers/new1?force=true');
    expect((await call('DELETE', '/birds/40')).status).toBe(404);
  });
});
