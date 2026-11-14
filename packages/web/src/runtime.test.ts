import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemoteRuntime, nodeBaseFromLocation } from './runtime.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

it('send posts JSON and returns msgId', async () => {
  const f = vi.fn(async () => new Response(JSON.stringify({ msgId: 42 }), { status: 200 }));
  globalThis.fetch = f as unknown as typeof fetch;
  const rt = createRemoteRuntime('http://localhost:8080');
  expect(await rt.send('hello')).toBe(42);
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://localhost:8080/api/send');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body as string)).toEqual({ text: 'hello' });
  rt.close();
});

it('a 400 rejects with the server error text', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'too long' }), { status: 400 })) as unknown as typeof fetch;
  const rt = createRemoteRuntime('http://localhost:8080');
  await expect(rt.send('x')).rejects.toThrow('too long');
  rt.close();
});

it('send under a path prefix calls the prefixed API', async () => {
  const f = vi.fn(async () => new Response(JSON.stringify({ msgId: 1 }), { status: 200 }));
  globalThis.fetch = f as unknown as typeof fetch;
  const rt = createRemoteRuntime('http://localhost:3100/nodes/3');
  await rt.send('hi');
  const [url] = f.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://localhost:3100/nodes/3/api/send');
  rt.close();
});

describe('nodeBaseFromLocation', () => {
  it.each([
    ['root page', 'http://localhost:8080/?runtime=remote', null, 'http://localhost:8080'],
    ['prefixed page', 'http://localhost:3100/nodes/3/?runtime=remote', null, 'http://localhost:3100/nodes/3'],
    ['prefixed index.html', 'http://localhost:3100/nodes/3/index.html?runtime=remote', null, 'http://localhost:3100/nodes/3'],
    ['empty param ignored', 'http://localhost:8080/', '', 'http://localhost:8080'],
    ['valid ?node=', 'http://localhost:3200/app/?runtime=remote', 'http://localhost:3100/nodes/2/', 'http://localhost:3100/nodes/2'],
  ])('%s', (_name, href, param, expected) => {
    expect(nodeBaseFromLocation(href, param)).toBe(expected);
  });

  it.each([
    ['rejects javascript:', 'javascript:alert(1)'],
    ['rejects ftp:', 'ftp://x/y'],
    ['rejects garbage', 'not a url'],
  ])('%s', (_name, param) => {
    expect(() => nodeBaseFromLocation('http://localhost:3200/app/', param)).toThrow(/http\(s\) URL/);
  });
});
