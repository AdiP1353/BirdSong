import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import type { EnvName, NodeSnapshot, ProfileName } from '@birdsong/core';
import { autoHearPhones, noise, setHearPhones, subscribeNoise } from '../noise.ts';

/** Why a phone could not use this address, or null when it can. Phones need a LAN address, and HTTPS for the microphone. */
export function phoneUrlProblem(pwaUrl: string): string | null {
  let u: URL;
  try { u = new URL(pwaUrl); } catch { return 'The phone address is not a URL. Set PWA_URL.'; }
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) {
    return 'A phone cannot open “localhost”. Start the demo with bash scripts/demo.sh (it finds this computer’s address), or set PWA_URL.';
  }
  if (u.protocol !== 'https:') return 'Phones get the microphone only on https:// pages. Set PWA_URL to an https address.';
  return null;
}

/**
 * One QR code: the phone app, with the flock's passphrase, environment and profile after the '#'. The phone turns on
 * its microphone and becomes a bird: it listens for, relays and sings messages, and its owner can speak or type one.
 */
export function JoinQr(props: { join: { pwaUrl: string; passphrase: string }; env: EnvName; profile: ProfileName; nodes: NodeSnapshot[] }) {
  const { join, env, profile } = props;
  const [img, setImg] = useState('');
  const [, setV] = useState(0);
  useEffect(() => subscribeNoise(() => setV((v) => v + 1)), []);
  const online = props.nodes.filter((n) => n.kind === 'browser' && n.online).map((n) => n.node).sort((a, b) => a - b);
  const phones = online.length;
  /** The phone this computer stands in for in the simulated air (one microphone: the lowest-numbered phone). */
  const phone = online[0] ?? null;
  // A phone joined: put it in the simulated air as a node of its own (this computer's microphone and speakers).
  useEffect(() => {
    autoHearPhones(phone);
    if (phone === null) return;
    const retry = (): void => autoHearPhones(phone);
    document.addEventListener('pointerdown', retry, { once: true });
    return () => document.removeEventListener('pointerdown', retry);
  }, [phone]);
  const hearing = noise.source === 'phones';
  const url = `${join.pwaUrl}#k=${encodeURIComponent(join.passphrase)}&env=${env}&p=${profile}`;
  const problem = join.pwaUrl ? phoneUrlProblem(join.pwaUrl) : null;
  const selfSigned = /^https:\/\/\d{1,3}(\.\d{1,3}){3}(:|\/)/.test(join.pwaUrl);
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
      <h2 data-tip="The phone listens through its microphone, sings through its speaker, and lets you speak or type a message. Same Wi-Fi as this computer.">Scan to become a bird</h2>
      {img ? <img src={img} width={320} height={320} alt="QR code that turns a phone into a bird" /> : <div class="qr-ph" />}
      <small class="url">{join.pwaUrl}</small>
      {selfSigned && <small class="dim">The phone shows a certificate warning (this computer signs its own): tap Advanced, then Proceed.</small>}
      {problem && <small class="warn">{problem}</small>}
      {noise.available && (
        <div class="ear">
          <span>
            {phones > 0 ? `${phones} phone${phones > 1 ? 's' : ''} in the flock. ` : ''}
            {hearing ? `Phone #${noise.phone} is in the air: the birds linked to it hear it through this computer’s microphone, and the speakers play only those birds.` : noise.source ? `The microphone is busy with “Add noise”.` : 'The birds cannot hear phones yet.'}
          </span>
          <button
            class={hearing ? 'on' : ''} disabled={noise.starting || (!hearing && phone === null)}
            data-tip="This computer stands in the simulated air as the phone: its microphone is the phone's song, heard only by the birds linked to the phone, and its speakers play only what those birds sing. Drag on the graph to change the phone's links."
            onClick={() => void setHearPhones(!hearing, phone)}
          >
            {noise.starting ? 'Starting…' : hearing ? 'Stop hearing phones' : '📱 Let the birds hear phones'}
          </button>
          {noise.error && noise.source === null && <small class="warn">{noise.error}</small>}
        </div>
      )}
    </div>
  );
}
