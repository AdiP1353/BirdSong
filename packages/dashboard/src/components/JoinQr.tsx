import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import type { EnvName, ProfileName } from '@birdsong/core';

export function JoinQr(props: { join: { pwaUrl: string; passphrase: string }; env: EnvName; profile: ProfileName }) {
  const { join, env, profile } = props;
  const url = `${join.pwaUrl}#k=${encodeURIComponent(join.passphrase)}&env=${env}&p=${profile}`;
  const [img, setImg] = useState('');
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
      <h2>Join the flock</h2>
      {img ? <img src={img} width={320} height={320} alt="Join QR code" /> : <div class="qr-ph" />}
      <small class="url">{url}</small>
    </div>
  );
}
