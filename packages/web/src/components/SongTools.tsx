import { useState } from 'preact/hooks';
import { decodeSong, decodeWav, encodeWav, renderMessageSong } from '@birdsong/core';
import type { DecodedSongMessage, NodeState } from '@birdsong/core';

export interface SongToolsProps { state: NodeState; passphrase: string; alias: string; sampleRate: number }

export function SongTools(props: SongToolsProps) {
  const [hidden, setHidden] = useState(false);
  const [found, setFound] = useState<DecodedSongMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = [...props.state.inbox].filter((m) => m.mine).sort((a, b) => b.receivedAt - a.receivedAt)[0];

  function fail(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('not implemented')) setHidden(true);
    else setError(msg);
  }

  async function save() {
    if (!last) return;
    setError(null);
    try {
      const pcm = await renderMessageSong({
        passphrase: props.passphrase, env: props.state.config.env, profile: props.state.config.profile,
        sampleRate: props.sampleRate, text: last.text, alias: props.alias, species: props.state.species, sender: props.state.id,
      });
      const blob = new Blob([encodeWav(pcm, props.sampleRate) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `birdsong-${last.msgId}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      fail(e);
    }
  }

  async function decode(file: File) {
    setError(null);
    setFound(null);
    try {
      const { pcm, sampleRate } = decodeWav(new Uint8Array(await file.arrayBuffer()));
      setFound(await decodeSong(pcm, {
        passphrase: props.passphrase, env: props.state.config.env, profile: props.state.config.profile, sampleRate,
      }));
    } catch (e) {
      fail(e);
    }
  }

  if (hidden) return null;
  return (
    <section class="panel">
      <h2>Song tools</h2>
      <button disabled={!last} onClick={() => void save()}>Save last message as song</button>
      <label>Decode a song file
        <input type="file" accept="audio/wav,.wav" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void decode(f); }} />
      </label>
      {found && (found.length === 0 ? <p class="dim">No messages found.</p> : found.map((m) => (
        <div class="msg" key={m.msgId}><div class="dim">{m.alias || 'anon'}</div><div>{m.text}</div></div>
      )))}
      {error && <p class="error">{error}</p>}
    </section>
  );
}
