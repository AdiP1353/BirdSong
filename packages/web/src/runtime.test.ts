import { afterEach, expect, it, vi } from 'vitest';
import { createRemoteRuntime } from './runtime.ts';

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
