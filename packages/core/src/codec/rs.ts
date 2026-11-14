import { EXP, gfDiv, gfExp, gfMul } from './gf256.ts';

const genCache = new Map<number, Uint8Array>();

/** Generator polynomial, highest degree first, monic. */
function generator(nsym: number): Uint8Array {
  let g = genCache.get(nsym);
  if (g) return g;
  let poly = [1];
  for (let i = 0; i < nsym; i++) {
    const root = gfExp(i);
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, root);
    }
    poly = next;
  }
  g = Uint8Array.from(poly);
  genCache.set(nsym, g);
  return g;
}

/** Returns data followed by `nsym` parity bytes. */
export function rsEncode(data: Uint8Array, nsym: number): Uint8Array {
  const g = generator(nsym);
  const out = new Uint8Array(data.length + nsym);
  out.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = out[i]!;
    if (coef !== 0) {
      for (let j = 1; j < g.length; j++) out[i + j] = out[i + j]! ^ gfMul(g[j]!, coef);
    }
  }
  out.set(data); // restore data; the tail holds the remainder (parity)
  return out;
}

function syndromes(cw: Uint8Array, nsym: number): number[] {
  const s: number[] = [];
  for (let i = 0; i < nsym; i++) {
    const x = gfExp(i);
    let acc = 0;
    for (let j = 0; j < cw.length; j++) acc = gfMul(acc, x) ^ cw[j]!;
    s.push(acc);
  }
  return s;
}

/** Evaluate polynomial with lowest-degree-first coefficients. */
function evalLow(poly: number[], x: number): number {
  let acc = 0;
  for (let i = poly.length - 1; i >= 0; i--) acc = gfMul(acc, x) ^ poly[i]!;
  return acc;
}

/** Corrects up to floor(nsym/2) byte errors. Returns null if uncorrectable. */
export function rsDecode(codeword: Uint8Array, nsym: number): { data: Uint8Array; corrected: number } | null {
  const n = codeword.length;
  if (n <= nsym || n > 255) return null;
  const dataLen = n - nsym;
  const S = syndromes(codeword, nsym);
  if (S.every((v) => v === 0)) return { data: codeword.slice(0, dataLen), corrected: 0 };

  // Berlekamp-Massey (polynomials lowest-degree first)
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let i = 0; i < nsym; i++) {
    let d = S[i]!;
    for (let j = 1; j <= L; j++) d ^= gfMul(C[j] ?? 0, S[i - j]!);
    if (d === 0) {
      m++;
      continue;
    }
    const scale = gfDiv(d, b);
    const T = C.slice();
    const need = B.length + m;
    while (C.length < need) C.push(0);
    for (let j = 0; j < B.length; j++) C[j + m] = C[j + m]! ^ gfMul(scale, B[j]!);
    if (2 * L <= i) {
      L = i + 1 - L;
      B = T;
      b = d;
      m = 1;
    } else {
      m++;
    }
  }
  while (C.length > 1 && C[C.length - 1] === 0) C.pop();
  const deg = C.length - 1;
  if (deg !== L || deg > nsym / 2 || deg === 0) return null;

  // Chien search: power j (position n-1-j) is in error if Lambda(alpha^-j) == 0
  const powers: number[] = [];
  for (let j = 0; j < n; j++) {
    if (evalLow(C, gfExp((255 - (j % 255)) % 255)) === 0) powers.push(j);
  }
  if (powers.length !== deg) return null;

  // Omega = S(x) * Lambda(x) mod x^nsym
  const omega: number[] = new Array<number>(nsym).fill(0);
  for (let i = 0; i < nsym; i++) {
    for (let j = 0; j < C.length && i + j < nsym; j++) omega[i + j] = omega[i + j]! ^ gfMul(S[i]!, C[j]!);
  }
  // Formal derivative of Lambda (odd terms only in characteristic 2)
  const dLam: number[] = [];
  for (let i = 1; i < C.length; i += 2) {
    while (dLam.length < i - 1) dLam.push(0);
    dLam[i - 1] = C[i]!;
  }

  const fixed = codeword.slice();
  for (const j of powers) {
    const xInv = gfExp((255 - (j % 255)) % 255);
    const X = EXP[j % 255]!;
    const denom = evalLow(dLam, xInv);
    if (denom === 0) return null;
    const mag = gfMul(X, gfDiv(evalLow(omega, xInv), denom));
    fixed[n - 1 - j] = fixed[n - 1 - j]! ^ mag;
  }
  if (syndromes(fixed, nsym).some((v) => v !== 0)) return null;
  return { data: fixed.slice(0, dataLen), corrected: deg };
}

