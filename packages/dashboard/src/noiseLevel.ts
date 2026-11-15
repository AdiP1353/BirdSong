/** Pure helpers for the "Add noise" panel (no DOM, no audio), so they can be tested in Node. */

/**
 * RMS of a bird's frame as it reaches its neighbours in the ether: frames peak at 0.8 with an RMS of about
 * 0.52 over their sound, and birds play at volume 0.8 by default. Gain on a link is 1.
 */
export const BIRD_RMS = 0.52 * 0.8;

/** The ether clamps noise samples to this, and so does the panel. */
export const NOISE_CLAMP = 4;

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Noise level relative to a bird's signal, in dB over the whole band. -Infinity for silence. */
export function vsBirdsDb(noiseRms: number): number {
  return noiseRms > 0 ? 20 * Math.log10(noiseRms / BIRD_RMS) : -Infinity;
}

/**
 * What to expect at a noise level. The thresholds come from the tests: every frame decodes through room noise
 * at +10 dB (packages/core/src/modem/roomNoise.test.ts); from about +14 dB some frames are lost, and by +18 dB
 * most are (the fountain code then needs many more frames, so messages slow down a lot).
 */
export function noiseVerdict(db: number): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (db <= 10) return { tone: 'ok', text: 'Birds should hear every frame through this.' };
  if (db <= 16) return { tone: 'warn', text: 'Some frames will be lost; messages get through more slowly.' };
  return { tone: 'bad', text: 'Most frames will be lost; messages may not get through.' };
}

export interface Chunker {
  /** Linear gain applied to every sample. */
  gain: number;
  push(x: Float32Array): void;
  reset(): void;
}

/**
 * Collect samples of any chunk size into blocks of exactly `size`, with `gain` applied and the result clamped
 * to +-NOISE_CLAMP. Calls `onBlock(block, rms)` for every full block.
 */
export function createChunker(size: number, onBlock: (block: Float32Array, rms: number) => void): Chunker {
  let acc = new Float32Array(size);
  let fill = 0;
  let sum = 0;
  const c: Chunker = {
    gain: 1,
    push(x) {
      for (let i = 0; i < x.length; i++) {
        const v = Math.max(-NOISE_CLAMP, Math.min(NOISE_CLAMP, x[i]! * c.gain));
        acc[fill++] = v;
        sum += v * v;
        if (fill === size) {
          const block = acc;
          const rms = Math.sqrt(sum / size);
          acc = new Float32Array(size);
          fill = 0;
          sum = 0;
          onBlock(block, rms);
        }
      }
    },
    reset() {
      fill = 0;
      sum = 0;
    },
  };
  return c;
}

/** Streaming linear-interpolation resampler (microphones often run at 44.1 kHz; the ether runs at 48 kHz). */
export function createResampler(fromRate: number, toRate: number): { push(x: Float32Array): Float32Array } {
  if (fromRate === toRate) return { push: (x) => x.slice() };
  const step = fromRate / toRate;
  let prev = 0; // last input sample of the previous chunk (index -1 of the next one)
  let pos = 0; // next output position in input samples, relative to the next chunk's start; always >= -1
  return {
    push(x) {
      const out: number[] = [];
      while (pos < x.length - 1) {
        const i = Math.floor(pos);
        const f = pos - i;
        const a = i < 0 ? prev : x[i]!;
        const b = x[i + 1]!;
        out.push(a + (b - a) * f);
        pos += step;
      }
      if (x.length > 0) {
        prev = x[x.length - 1]!;
        pos -= x.length;
      }
      return Float32Array.from(out);
    },
  };
}

/** A block of the air this page plays counts as a bird singing above this RMS (the ether's own hiss is 0.002). */
export const ECHO_BUSY_RMS = 0.01;
/** The gate stays shut this long after the last bird sound has played: speaker-to-microphone delay and room echo. */
export const ECHO_HANGOVER_MS = 500;

export interface EchoGate {
  /** A block of air that plays until `endMs` (performance.now() time) with this RMS. */
  played(rms: number, endMs: number): void;
  /** Whether the microphone may pass sound into the air at `nowMs`. */
  open(nowMs: number): boolean;
}

/**
 * "Hear phones" sends this computer's microphone into the simulated air so the birds hear phones in the room. The
 * same speakers play the birds, so the microphone would send every bird's song back into the air a moment later,
 * as an echo. The gate closes while the page plays a bird (and for ECHO_HANGOVER_MS after), and opens when the air
 * is quiet: that is when a phone sings, because a phone waits for silence like any bird (carrier sense).
 */
export function createEchoGate(): EchoGate {
  let busyUntil = -Infinity;
  return {
    played(rms, endMs) {
      if (rms > ECHO_BUSY_RMS) busyUntil = Math.max(busyUntil, endMs + ECHO_HANGOVER_MS);
    },
    open: (nowMs) => nowMs >= busyUntil,
  };
}

export function rmsOf(x: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i]! * x[i]!;
  return x.length > 0 ? Math.sqrt(sum / x.length) : 0;
}
