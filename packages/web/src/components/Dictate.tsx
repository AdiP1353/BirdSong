import { useEffect, useRef, useState } from 'preact/hooks';
import type { Runtime } from '../runtime.ts';
import { hubBase } from '../hub.ts';
import { MAX_DICTATION_MS, speechAvailable, transcribe } from '../speech.ts';

type Mic = NonNullable<Runtime['mic']>;

/**
 * Speak the message instead of typing it. Records with the node's own microphone (no second permission prompt), and
 * the node stops listening for chirps until the recording ends, so speech never reaches the decoder. The words go to
 * the hub, which asks ElevenLabs, and land in the message box for the person to check and send.
 * Hidden when the page has no hub with a key (speech to text is the one step that needs the internet).
 */
export function Dictate(props: { mic: Mic; onText(text: string): void; onError(message: string | null): void }) {
  const { mic } = props;
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const base = hubBase(location.href);

  useEffect(() => {
    let live = true;
    void speechAvailable(base).then((ok) => { if (live) setAvailable(ok && typeof MediaRecorder !== 'undefined'); });
    return () => {
      live = false;
      if (timer.current !== null) clearTimeout(timer.current);
      const rec = recorder.current;
      if (rec) {
        rec.onstop = null;
        if (rec.state !== 'inactive') rec.stop();
      }
      mic.setListening(true);
    };
  }, []);

  function finish(chunks: Blob[], type: string): void {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    recorder.current = null;
    mic.setListening(true); // back to listening for birds as soon as the person stops speaking
    setState('working');
    transcribe(base, new Blob(chunks, { type: type || 'audio/webm' })).then(
      (text) => props.onText(text),
      (err: unknown) => props.onError(err instanceof Error ? err.message : String(err)),
    ).finally(() => setState('idle'));
  }

  function toggle(): void {
    if (state === 'recording') {
      recorder.current?.stop();
      return;
    }
    props.onError(null);
    const stream = mic.stream();
    if (!stream) {
      props.onError('The microphone is not on yet.');
      return;
    }
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream);
    } catch {
      props.onError('This browser cannot record speech. Type the message instead.');
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => finish(chunks, rec.mimeType);
    mic.setListening(false);
    recorder.current = rec;
    rec.start();
    timer.current = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, MAX_DICTATION_MS);
    setState('recording');
  }

  if (!available) return null;
  return (
    <>
      <button type="button" class={`mic ${state === 'recording' ? 'rec' : ''}`} disabled={state === 'working'} onClick={toggle}>
        {state === 'recording' ? '■ Done speaking' : state === 'working' ? 'Turning your words into text…' : '🎤 Speak your message'}
      </button>
      {state === 'recording' && <p class="dim">Not listening for birds while you speak.</p>}
    </>
  );
}
