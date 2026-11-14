/** GF(2^8) arithmetic, primitive polynomial 0x11d, generator alpha = 2. */
export const EXP = new Uint8Array(512);
export const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('division by zero in GF(256)');
  if (a === 0) return 0;
  return EXP[LOG[a]! + 255 - LOG[b]!]!;
}

export function gfInv(a: number): number {
  if (a === 0) throw new RangeError('zero has no inverse in GF(256)');
  return EXP[255 - LOG[a]!]!;
}

export function gfPow(a: number, n: number): number {
  if (n === 0) return 1;
  if (a === 0) return 0;
  return EXP[(LOG[a]! * n) % 255]!;
}

/** alpha^n, n any non-negative integer. */
export function gfExp(n: number): number {
  return EXP[n % 255]!;
}
