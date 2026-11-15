import { useState } from 'preact/hooks';
import { MAX_TEXT_CHARS } from '@birdsong/core';
import { charCount } from '../counter.ts';
import type { Runtime } from '../runtime.ts';
import { appendDictation } from '../speech.ts';
import { Dictate } from './Dictate.tsx';

export function Compose(props: { runtime: Runtime; onSent(): void; compact?: boolean }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const n = charCount(text);
  const mic = props.compact ? undefined : props.runtime.mic;
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
      <textarea
        rows={props.compact ? 1 : 3} value={text} placeholder={mic ? 'Type or speak a message to sing' : 'Type a message to sing'}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && n > 0 && n <= MAX_TEXT_CHARS) { e.preventDefault(); void send(); }
        }}
      />
      {mic && <Dictate mic={mic} onError={setError} onText={(heard) => setText((cur) => appendDictation(cur, heard, MAX_TEXT_CHARS))} />}
      <div class="row">
        <span class={n > MAX_TEXT_CHARS ? 'error' : ''}>{n} / {MAX_TEXT_CHARS}</span>
        <button disabled={n === 0 || n > MAX_TEXT_CHARS} onClick={() => void send()}>Send</button>
      </div>
      {error && <p class="error">{error}</p>}
    </section>
  );
}
