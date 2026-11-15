import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import type { EnvName, ProfileName } from '@birdsong/core';

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
export function JoinQr(props: { join: { pwaUrl: string; passphrase: string }; env: EnvName; profile: ProfileName }) {
  const { join, env, profile } = props;
  const [img, setImg] = useState('');
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
    </div>
  );
}
