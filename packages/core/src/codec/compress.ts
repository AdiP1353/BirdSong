/// <reference path="../unishox.d.ts" />
import unishox from 'unishox2.siara.cc';

const { unishox2_compress_simple, unishox2_decompress_simple } = unishox;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Returns the smaller of Unishox2-compressed and raw UTF-8. */
export function compressText(s: string): { compressed: boolean; bytes: Uint8Array } {
  const raw = enc.encode(s);
  try {
    const out = new Uint8Array(512);
    const n = Math.ceil(unishox2_compress_simple(s, s.length, out));
    if (n > 0 && n < raw.length) {
      const bytes = out.slice(0, n);
      if (unishox2_decompress_simple(bytes, n) === s) return { compressed: true, bytes };
    }
  } catch {
    // fall through to raw
  }
  return { compressed: false, bytes: raw };
}

export function decompressText(bytes: Uint8Array, compressed: boolean): string {
  if (!compressed) return dec.decode(bytes);
  return unishox2_decompress_simple(bytes, bytes.length);
}
