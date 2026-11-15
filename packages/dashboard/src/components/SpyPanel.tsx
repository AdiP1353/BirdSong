import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TelemetryEvent } from '@birdsong/core';
import { scramble, spyCapture, tryPassphrase } from '../spy.ts';
import type { FeedMessage } from '../derive.ts';

/**
 * Spy view: what someone with a microphone and no passphrase gets from the same chirps, next to what the birds
 * with the key read. The spy can try a passphrase; only the right one opens the message.
 */
export function SpyPanel(props: { events: TelemetryEvent[]; focus: number | null; message: FeedMessage | undefined }) {
  const { events, focus, message } = props;
  const [guess, setGuess] = useState('password123');
  const [result, setResult] = useState<{ key: string; text: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frames = events.reduce((n, e) => n + (e.type === 'sang' && e.msgId === focus ? 1 : 0), 0);
  const cap = useMemo(() => spyCapture(events, focus), [focus, frames]);
  const key = `${focus}:${guess}:${cap?.envelope ? 1 : 0}`;

  useEffect(() => {
    setError(null);
    if (!cap?.envelope || guess === '') { setResult(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      tryPassphrase(cap.envelope!, guess).then(
        (r) => { if (live) setResult({ key, text: r ? r.text : null }); },
        (err: Error) => { if (live) setError(err.message); },
      );
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [key]);

  const opened = result?.key === key ? result.text : undefined;
  return (
    <div class="panel spy">
      <h2>Spy view</h2>
      {!cap ? (
        <div class="dim hint">Send a message. This shows what an eavesdropper with a microphone, but no passphrase, gets from it.</div>
      ) : (
        <div class="spy-cols">
          <div class="spy-col bad">
            <div class="spy-title">Eavesdropper</div>
            <div class="spy-meta">
              heard {cap.frames} frame{cap.frames === 1 ? '' : 's'} from bird{cap.senders.length === 1 ? '' : 's'} {cap.senders.map((s) => `#${s}`).join(', ')}
              {cap.envelope ? '' : ` · needs about ${cap.k} to rebuild the message`}
            </div>
            <div class="spy-text scrambled" data-tip="The encrypted bytes of the message, one character per byte. This is all a listener without the passphrase gets.">{scramble(cap.ciphertext)}</div>
            <label class="spy-guess" data-tip="Type any passphrase. Only the flock's real one opens the message.">
              Spy tries a passphrase
              <input type="text" value={guess} spellcheck={false} aria-label="Passphrase guess" onInput={(e) => setGuess(e.currentTarget.value)} />
            </label>
            <div class={`spy-result ${opened ? 'ok' : ''}`}>
              {!cap.envelope ? 'Waiting for more frames…'
                : opened === undefined ? 'Trying…'
                : opened === null ? '✗ Wrong key: it does not open.'
                : <>✓ Opened: “{opened}”</>}
            </div>
          </div>
          <div class="spy-col ok">
            <div class="spy-title">Birds with the key</div>
            <div class="spy-meta">{message ? `${message.decodes.length} bird${message.decodes.length === 1 ? ' has' : 's have'} read it` : 'nobody has read it yet'}</div>
            <div class="spy-text">{message ? message.text : '…'}</div>
          </div>
        </div>
      )}
      {error && <div class="error">{error}</div>}
    </div>
  );
}
