/**
 * Synthetic room noise: a stand-in for what a laptop microphone picks up in a busy room.
 * Used by the tests (instead of a real recording) and by the dashboard's "test noise" source.
 *
 * Components, each scaled so that it contributes the given fraction of the total power:
 * - pink noise (fans, air conditioning, traffic): 1/f spectrum, most energy at low frequencies;
 * - babble (people talking): voiced pulse trains at 90-250 Hz pitch with harmonics up to ~8 kHz and
 *   unvoiced hiss, shaped by three formant resonators, in talk spurts with syllable-rate (4 Hz) modulation;
 * - hum: 50 Hz mains and its harmonics;
 * - clicks (keyboard, cups, claps): short decaying broadband bursts, 5-15x the background RMS.
 *
 * The background (pink + babble + hum) has about unit RMS; clicks come on top. Deterministic for a given rng.
 */
export interface RoomNoiseOptions {
  pink?: number;
  babble?: number;
  hum?: number;
  /** Clicks per second. 0 = none. Default 1.5. */
  clicksPerSecond?: number;
  /** Number of simultaneous talkers. Default 3. */
  talkers?: number;
}

function resonator(freq: number, bw: number, sampleRate: number): (x: number) => number {
  const fc = Math.min(freq, 0.45 * sampleRate);
  const r = Math.exp((-Math.PI * bw) / sampleRate);
  const a1 = -2 * r * Math.cos((2 * Math.PI * fc) / sampleRate);
  const a2 = r * r;
  const g = 1 - r;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = g * x - a1 * y1 - a2 * y2;
    y2 = y1;
    y1 = y;
    return y;
  };
}

function normalise(x: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  const r = Math.sqrt(s / Math.max(1, x.length));
  if (r > 0) for (let i = 0; i < x.length; i++) x[i] = x[i]! / r;
  return x;
}

function gauss(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function pinkNoise(n: number, rng: () => number): Float32Array {
  // Paul Kellet's refined filter.
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = gauss(rng);
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return normalise(out);
}

function talker(n: number, sampleRate: number, rng: () => number): Float32Array {
  const out = new Float32Array(n);
  const f0Base = 90 + rng() * 160;
  const formants = [
    resonator(500 + rng() * 300, 120, sampleRate),
    resonator(1300 + rng() * 600, 180, sampleRate),
    resonator(2400 + rng() * 800, 250, sampleRate),
  ];
  const hiss = resonator(4500 + rng() * 2000, 2500, sampleRate);
  let phase = 0;
  let talking = rng() < 0.6;
  let left = Math.round((talking ? 1 + rng() * 2 : 0.3 + rng() * 0.7) * sampleRate);
  let voiced = true;
  let segLeft = 0;
  const syll = 3.5 + rng();
  let env = 0;
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) {
      talking = !talking;
      left = Math.round((talking ? 1 + rng() * 2 : 0.3 + rng() * 0.7) * sampleRate);
    }
    if (segLeft-- <= 0) {
      voiced = rng() < 0.75;
      segLeft = Math.round((0.05 + rng() * 0.15) * sampleRate);
    }
    const t = i / sampleRate;
    const f0 = f0Base * (1 + 0.15 * Math.sin(2 * Math.PI * 0.7 * t + f0Base));
    phase += f0 / sampleRate;
    let ex: number;
    if (voiced) {
      // Band-limited-ish glottal pulse: one sample spike per period, plus a little breath.
      ex = phase >= 1 ? 8 : 0;
      ex += 0.3 * gauss(rng);
    } else {
      ex = 0;
    }
    if (phase >= 1) phase -= 1;
    let v = 0;
    for (const f of formants) v += f(ex);
    if (!voiced) v += 3 * hiss(gauss(rng));
    const target = talking ? 0.55 + 0.45 * Math.sin(2 * Math.PI * syll * t) : 0;
    env += 0.002 * (Math.max(0, target) - env);
    out[i] = v * env;
  }
  return out;
}

export function makeRoomNoise(seconds: number, sampleRate: number, rng: () => number, opts: RoomNoiseOptions = {}): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const wPink = opts.pink ?? 0.4;
  const wBabble = opts.babble ?? 0.5;
  const wHum = opts.hum ?? 0.1;
  const out = new Float32Array(n);
  const add = (x: Float32Array, w: number): void => {
    const g = Math.sqrt(w);
    for (let i = 0; i < n; i++) out[i]! += g * x[i]!;
  };
  if (wPink > 0) add(pinkNoise(n, rng), wPink);
  if (wBabble > 0) {
    const b = new Float32Array(n);
    const talkers = opts.talkers ?? 3;
    for (let k = 0; k < talkers; k++) {
      const t = talker(n, sampleRate, rng);
      for (let i = 0; i < n; i++) b[i]! += t[i]!;
    }
    add(normalise(b), wBabble);
  }
  if (wHum > 0) {
    const h = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      for (let k = 1; k <= 7; k++) h[i]! += Math.sin(2 * Math.PI * 50 * k * t + k) / k;
    }
    add(normalise(h), wHum);
  }
  const cps = opts.clicksPerSecond ?? 1.5;
  if (cps > 0) {
    let t = Math.round((rng() / cps) * sampleRate);
    while (t < n) {
      const amp = (5 + rng() * 10) * (rng() < 0.5 ? -1 : 1);
      const len = Math.round((0.002 + rng() * 0.008) * sampleRate);
      const tau = len / 4;
      for (let i = 0; i < len && t + i < n; i++) out[t + i]! += amp * Math.exp(-i / tau) * gauss(rng);
      t += Math.round(((0.2 + rng() * 1.6) / cps) * sampleRate);
    }
  }
  return out;
}
