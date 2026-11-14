import { useState } from 'preact/hooks';
import { MAX_TEXT_CHARS } from '@birdsong/core';
import { charCount } from '../counter.ts';
import type { Runtime } from '../runtime.ts';

export function Compose(props: { runtime: Runtime; onSent(): void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const n = charCount(text);
  async function send() {
    setError(null);
    try {
      await props.runtime.send(text);
      setText('');
      props.onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <section class="panel">
      <textarea rows={3} value={text} placeholder="Type a message to sing" onInput={(e) => setText(e.currentTarget.value)} />
      <div class="row">
        <span class={n > MAX_TEXT_CHARS ? 'error' : ''}>{n} / {MAX_TEXT_CHARS}</span>
        <button disabled={n === 0 || n > MAX_TEXT_CHARS} onClick={() => void send()}>Send</button>
      </div>
      {error && <p class="error">{error}</p>}
    </section>
  );
}
