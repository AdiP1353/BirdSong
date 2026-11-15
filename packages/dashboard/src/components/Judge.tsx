import { useEffect, useState } from 'preact/hooks';
import { ENVS, MAX_TEXT_CHARS } from '@birdsong/core';
import { store, subscribe } from '../hubClient.ts';
import { dominantEnv, feed, speciesColor } from '../derive.ts';
import { PcmScope } from './PcmScope.tsx';

/** A URL from the hub's config, made reachable from this device: "localhost" becomes the host this page came from. */
export function reachable(url: string, host: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') u.hostname = host;
    return u.href.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

interface Sent { msgId: number; text: string; name: string; via: number }

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v) as T; } catch { return fallback; }
}
function save(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

/**
 * The judge's phone (http://<this computer>:3200/?view=judge, from the QR code): type a name and a message,
 * send it through one bird, watch it reach the others, see the air live, and take the message home as a song.
 */
export function Judge() {
  const [, setV] = useState(0);
  const [cfg, setCfg] = useState<{ proxy: string | null; ether: string | null } | null>(null);
  const [name, setName] = useState(() => load('birdsong.judge.name', ''));
  const [text, setText] = useState('');
  const [sent, setSent] = useState<Sent | null>(() => load<Sent | null>('birdsong.judge.sent', null));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [song, setSong] = useState<{ url: string; name: string } | null>(null);
  const [found, setFound] = useState<{ text: string; alias: string }[] | null>(null);

  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  useEffect(() => {
    fetch('/config.json').then((r) => r.json()).then((c: { proxyUrl?: string | null; etherUrl?: string | null }) => {
      setCfg({
        proxy: c.proxyUrl ? reachable(c.proxyUrl, location.hostname) : null,
        ether: c.etherUrl ? reachable(c.etherUrl, location.hostname) : null,
      });
    }, () => setCfg({ proxy: null, ether: null }));
  }, []);

  const nodes = store.state.snapshot();
  const events = store.state.recent();
  const theme = ENVS[dominantEnv(nodes)].theme;
  const birds = nodes.filter((n) => n.kind === 'container');
  const prefix = name.trim() ? `${name.trim()}: ` : '';
  const room = MAX_TEXT_CHARS - prefix.length;
  const mine = sent ? feed(events).find((m) => m.msgId === sent.msgId) : undefined;
  const reached = new Set(mine?.decodes.map((d) => d.node) ?? []);
  const others = birds.filter((b) => b.node !== sent?.via);
  const arrived = others.filter((b) => reached.has(b.node)).length;

  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label);
    setError(null);
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  };

  const send = (): Promise<void> => run('send', async () => {
    if (!cfg?.proxy) throw new Error('This demo has no birds to send through.');
    // Any bird that can sing will do; when the network is down the hub sees none, so try them all.
    const able = birds.filter((b) => b.online && !b.config.muted);
    const pool = able.length > 0 ? able : birds;
    if (pool.length === 0) throw new Error('No birds yet. Try again in a moment.');
    const via = pool[Math.floor(Math.random() * pool.length)]!.node;
    const full = `${prefix}${text.trim()}`.slice(0, MAX_TEXT_CHARS);
    const r = await fetch(`${cfg.proxy}/nodes/${via}/api/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: full }),
    });
    const body = await r.json().catch(() => ({})) as { msgId?: number; error?: string };
    if (!r.ok || body.msgId === undefined) throw new Error(body.error ?? `Bird #${via} did not take it (HTTP ${r.status}).`);
    const s: Sent = { msgId: body.msgId, text: full, name: name.trim(), via };
    setSent(s);
    save('birdsong.judge.sent', s);
    save('birdsong.judge.name', name);
    setText('');
    setSong(null);
  });

  const makeSong = (): Promise<void> => run('song', async () => {
    if (!sent) return;
    const r = await fetch('/api/song', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: sent.text, alias: sent.name }),
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
    const file = `birdsong-${(sent.name || 'message').replace(/[^\w-]+/g, '_')}.wav`;
    const url = URL.createObjectURL(await r.blob());
    setSong({ url, name: file });
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    a.click();
  });

  const decode = (file: File): Promise<void> => run('decode', async () => {
    setFound(null);
    const r = await fetch('/api/song/decode', { method: 'POST', body: file });
    const body = await r.json().catch(() => ({})) as { messages?: { text: string; alias: string }[]; error?: string };
    if (!r.ok || !body.messages) throw new Error(body.error ?? `HTTP ${r.status}`);
    setFound(body.messages);
  });

  return (
    <div class="judge" style={{ '--bg': theme.bg, '--fg': theme.fg, '--accent': theme.accent }}>
      <header>
        <h1>BirdSong</h1>
        <span class={`conn ${store.connected ? 'ok' : 'bad'}`}>{store.connected ? (store.disabled ? 'network down' : 'live') : 'reconnecting'}</span>
      </header>

      <section class="panel">
        <h2>Send your own message</h2>
        <p class="dim">It leaves one bird as birdsong and hops from bird to bird. Watch the big screen.</p>
        <label>Your name
          <input type="text" value={name} maxLength={20} placeholder="Ada" autocomplete="off" onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label>Your message or secret
          <textarea rows={2} value={text} maxLength={Math.max(1, room)} placeholder="The eagle lands at noon" onInput={(e) => setText(e.currentTarget.value)} />
        </label>
        <button class="go" disabled={busy !== null || text.trim() === '' || !cfg} onClick={() => void send()}>
          {busy === 'send' ? 'Singing…' : 'Send as birdsong'}
        </button>
        {store.stopped && <p class="warn">The birds are stopped on the big screen. Ask for “Start birds”.</p>}
        {store.disabled && <p class="warn">The network is down, on purpose. Send anyway: the birds do not need it.</p>}
      </section>

      {sent && (
        <section class="panel">
          <h2>“{sent.text}”</h2>
          <p>
            Sung by bird #{sent.via}.{' '}
            {store.disabled
              ? 'The network is down, so this phone cannot follow it. Look at the bird windows on the big screen.'
              : others.length > 0 && arrived === others.length ? <b>Every bird has it.</b>
              : <>Read by <b>{arrived}</b> of {others.length} other birds so far.</>}
          </p>
          <div class="chips">
            {birds.map((b) => (
              <span key={b.node} class={`jbird ${b.node === sent.via || reached.has(b.node) ? 'got' : ''}`}>
                <i style={{ background: speciesColor(b.species) }} />#{b.node}
                {mine?.decodes.find((d) => d.node === b.node && d.hops > 0) && <small> {mine.decodes.find((d) => d.node === b.node)!.hops} hop{mine.decodes.find((d) => d.node === b.node)!.hops === 1 ? '' : 's'}</small>}
              </span>
            ))}
          </div>
          <button disabled={busy !== null} onClick={() => void makeSong()}>
            {busy === 'song' ? 'Composing…' : 'Save your message as a song'}
          </button>
          {song && <p>Saved. <a href={song.url} download={song.name}>Download again</a> — it is your words as birdsong, and any bird with the passphrase can read it back.</p>}
        </section>
      )}

      {cfg?.ether && (
        <section class="panel">
          <h2>The air, live</h2>
          <PcmScope url={cfg.ether} height={150} />
          <p class="dim">
            {store.noiseSources > 0
              ? 'The microphone at the big screen is on. Whistle or clap at it: your noise lands here, and the message still gets through.'
              : 'Each streak is a chirp. Ask for the microphone to be switched on (Add noise), then whistle or clap at it.'}
          </p>
        </section>
      )}

      <section class="panel">
        <h2>Read a song back</h2>
        <label>Pick a saved birdsong (.wav)
          <input type="file" accept="audio/wav,.wav" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void decode(f); }} />
        </label>
        {busy === 'decode' && <p class="dim">Listening…</p>}
        {found && (found.length === 0
          ? <p class="dim">No message found in that file.</p>
          : found.map((m, i) => <p key={i}>It says: <b>“{m.text}”</b></p>))}
      </section>
      {error && <p class="error">{error}</p>}
    </div>
  );
}
