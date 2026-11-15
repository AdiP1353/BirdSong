import { describe, expect, it, vi } from 'vitest';
import { appendDictation, hubBase, speechAvailable, transcribe } from './speech.ts';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe('speech to text', () => {
  it('finds the hub one level above /app/', () => {
    expect(hubBase('https://10.0.0.5:3443/app/?x=1#k=a')).toBe('https://10.0.0.5:3443/');
    expect(hubBase('https://10.0.0.5:3443/app/index.html')).toBe('https://10.0.0.5:3443/');
    expect(hubBase('http://localhost:5173/')).toBe('http://localhost:5173/');
    expect(hubBase('https://x.github.io/birdsong/')).toBe('https://x.github.io/birdsong/');
  });

  it('is available only when the hub says so', async () => {
    const yes = vi.fn(async () => json({ speechToText: true }));
    expect(await speechAvailable('https://h/', yes as unknown as typeof fetch)).toBe(true);
    expect(yes.mock.calls[0]).toEqual(['https://h/config.json']);
    expect(await speechAvailable('https://h/', (async () => json({ speechToText: false })) as unknown as typeof fetch)).toBe(false);
    expect(await speechAvailable('https://h/', (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch)).toBe(false);
    expect(await speechAvailable('https://h/', (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toBe(false);
  });

  it('posts the audio and returns the words', async () => {
    const f = vi.fn(async () => json({ text: 'meet at the bridge' }));
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm;codecs=opus' });
    expect(await transcribe('https://h/', audio, f as unknown as typeof fetch)).toBe('meet at the bridge');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://h/api/transcribe');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('audio/webm;codecs=opus');
  });

  it('passes the hub error on, and says so when the hub cannot be reached', async () => {
    const audio = new Blob([new Uint8Array([1])]);
    await expect(transcribe('https://h/', audio, (async () => json({ error: 'no speech heard' }, 422)) as unknown as typeof fetch)).rejects.toThrow('no speech heard');
    await expect(transcribe('https://h/', audio, (async () => { throw new TypeError('x'); }) as unknown as typeof fetch)).rejects.toThrow('Cannot reach');
  });

  it('adds dictated words after the typed ones, within the limit', () => {
    expect(appendDictation('', ' hello ', 140)).toBe('hello');
    expect(appendDictation('meet at ', 'the bridge', 140)).toBe('meet at the bridge');
    expect(appendDictation('ab', 'cdef', 5)).toBe('ab cd');
    expect(appendDictation('', '🐦🐦🐦', 2)).toBe('🐦🐦');
  });
});
