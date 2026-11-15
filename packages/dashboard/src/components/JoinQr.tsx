import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import type { EnvName, ProfileName } from '@birdsong/core';

type Mode = 'judge' | 'bird';

/**
 * Two QR codes. "Send a message" opens the judge page on a phone (this hub, ?view=judge): type a name and a
 * message and it is sung by a bird. "Join as a bird" opens the phone app, which makes the phone a real node.
 */
export function JoinQr(props: { join: { pwaUrl: string; passphrase: string }; env: EnvName; profile: ProfileName }) {
  const { join, env, profile } = props;
  const [mode, setMode] = useState<Mode>('judge');
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [img, setImg] = useState('');
  useEffect(() => {
    fetch('/config.json').then((r) => r.json()).then((c: { publicUrl?: string | null }) => setPublicUrl(c.publicUrl ?? null), () => {});
  }, []);
  const base = publicUrl ?? location.origin;
  const local = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base);
  const url = mode === 'judge'
    ? `${base}/?view=judge`
    : `${join.pwaUrl}#k=${encodeURIComponent(join.passphrase)}&env=${env}&p=${profile}`;
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { width: 320, margin: 1, color: { dark: '#000000', light: '#ffffff' } }).then((d) => {
      if (live) setImg(d);
    }, () => {});
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <div class="panel qr">
      <div class="seg center" role="group" aria-label="QR code">
        <button class={mode === 'judge' ? 'on' : ''} data-tip="A phone page for typing a message that one bird then sings. The phone must be on the same Wi-Fi." onClick={() => setMode('judge')}>Send a message</button>
        <button class={mode === 'bird' ? 'on' : ''} data-tip="Turns the phone into a real bird that listens and sings through its own microphone and speaker." onClick={() => setMode('bird')}>Join as a bird</button>
      </div>
      <h2>{mode === 'judge' ? 'Scan, type, and watch it fly' : 'Join the flock'}</h2>
      {img ? <img src={img} width={320} height={320} alt={mode === 'judge' ? 'QR code of the message page' : 'Join QR code'} /> : <div class="qr-ph" />}
      <small class="url">{url}</small>
      {mode === 'judge' && local && (
        <small class="warn">A phone cannot open “localhost”. Start the demo with <code>bash scripts/demo.sh</code> (it finds this computer’s address), or set <code>HUB_PUBLIC_URL</code>.</small>
      )}
    </div>
  );
}
