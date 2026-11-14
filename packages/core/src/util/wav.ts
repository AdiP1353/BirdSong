export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = pcm.length * 2;
  const out = new Uint8Array(44 + dataLen);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, dataLen, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    dv.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return out;
}

export function decodeWav(bytes: Uint8Array): { pcm: Float32Array; sampleRate: number } {
  const bad = () => new Error('unsupported wav');
  if (bytes.length < 12) throw bad();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw bad();
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    const size = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      if (body + 16 > bytes.length) throw bad();
      let format = dv.getUint16(body, true);
      if (format === 0xfffe && size >= 26) format = dv.getUint16(body + 24, true);
      fmt = { format, channels: dv.getUint16(body + 2, true), sampleRate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt || fmt.channels < 1) throw bad();
      const len = Math.min(size, bytes.length - body);
      const bytesPer = fmt.bits / 8;
      const isPcm16 = fmt.format === 1 && fmt.bits === 16;
      const isF32 = fmt.format === 3 && fmt.bits === 32;
      if (!isPcm16 && !isF32) throw bad();
      const frames = Math.floor(len / (bytesPer * fmt.channels));
      const pcm = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const o = body + (i * fmt.channels + c) * bytesPer;
          sum += isPcm16 ? dv.getInt16(o, true) / 32768 : dv.getFloat32(o, true);
        }
        pcm[i] = sum / fmt.channels;
      }
      return { pcm, sampleRate: fmt.sampleRate };
    }
    pos = body + size + (size & 1);
  }
  throw bad();
}
