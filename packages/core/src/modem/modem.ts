import FFT from 'fft.js';
import { FRAME_AIR_LEN } from '../constants.ts';
import { envBand, PROFILES } from '../envs.ts';
import { symbolsToBytes } from '../symbols.ts';
import { frameAirtimeMs, SYNC_START_MS } from '../timing.ts';
import type { Modem, ModemOptions, RxMeta } from '../types.ts';
import { demodulateFrame } from './demod.ts';
import { createDetector, DEFAULT_SYNC_THRESHOLD } from './detector.ts';
import type { Detector } from './detector.ts';
import { createBandpass } from './filters.ts';
import type { Bandpass } from './filters.ts';
import { msToSamples, renderFrame } from './synth.ts';
import { buildSymbolTemplates } from './templates.ts';

const ENERGY_BLOCK_MS = 20;
const NOISE_FLOOR_WINDOW_MS = 5000;
/**
 * Carrier sense ("is another bird singing?"). A block counts as song when it is
 * - tonal: the strongest ~230 Hz slice of the pass band holds at least TONAL_RATIO times the median slice
 *   (a chirp is one narrow line; fans, hiss, speech and clicks spread over the band), and
 * - louder than the quietest block of the last 5 s by ACTIVE_RATIO (so a steady whistle or hum is not song), and
 * - above ACTIVE_MIN_POWER.
 * Two of the last three blocks must count, so a lone noise spike does not hold the air for HANGOVER_MS.
 * Energy alone is not enough: with a microphone in a busy room it is above the floor most of the time.
 */
const TONAL_RATIO = 16;
const TONAL_SLICE_HZ = 230;
const ACTIVE_RATIO = 1.5;
const ACTIVE_MIN_POWER = 1e-7;
const HANGOVER_MS = 250;
/**
 * A pending sync candidate holds the air on its own only if it scored at least this. Weaker ones (data chirps
 * that happen to look like a sync score about 0.25-0.33) count only while song is heard anyway; otherwise one
 * found inside a frame would keep the channel busy for a whole frame after that frame ended.
 */
const STRONG_SYNC = 0.4;
const EXTRA_BUFFER_MS = 2000;
const DEMOD_TAIL_MS = 2;

interface Candidate {
  syncStart: number;
  score: number;
}

export function createModem(opts: ModemOptions): Modem {
  const { sampleRate, env, profile } = opts;
  const band = envBand(env);
  if (!(band.highHz < 0.45 * sampleRate)) {
    throw new RangeError(`environment "${env}" needs a sample rate above ${Math.ceil(band.highHz / 0.45)} Hz, got ${sampleRate}`);
  }
  const p = PROFILES[profile];
  const threshold = opts.syncThreshold ?? DEFAULT_SYNC_THRESHOLD;
  const templates = buildSymbolTemplates(env, profile, sampleRate);

  const airtimeMs = frameAirtimeMs(p);
  const keepLen = msToSamples(airtimeMs + EXTRA_BUFFER_MS, sampleRate);
  const readyAfterSync = msToSamples(airtimeMs - SYNC_START_MS, sampleRate) + msToSamples(DEMOD_TAIL_MS, sampleRate);
  const lead = msToSamples(10, sampleRate);

  const blockLen = msToSamples(ENERGY_BLOCK_MS, sampleRate);
  const floorBlocks = Math.round(NOISE_FLOOR_WINDOW_MS / ENERGY_BLOCK_MS);
  const hangover = msToSamples(HANGOVER_MS, sampleRate);

  let filter: Bandpass = createBandpass(band.lowHz, band.highHz, sampleRate);
  const detector: Detector = createDetector(env, sampleRate, threshold);

  let buf = new Float32Array(keepLen * 2);
  let bufLen = 0;
  let bufBase = 0;
  let candidates: Candidate[] = [];
  let callback: ((air: Uint8Array, meta: RxMeta) => void) | null = null;
  let epoch = 0;

  // carrier sense
  const blockSamples = new Float32Array(blockLen);
  let fftN = 1;
  while (fftN < blockLen) fftN <<= 1;
  const fft = new FFT(fftN);
  const fftIn = fft.createComplexArray() as number[];
  const fftOut = fft.createComplexArray() as number[];
  const hann = new Float32Array(blockLen);
  for (let i = 0; i < blockLen; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / blockLen);
  const binHz = sampleRate / fftN;
  const k0 = Math.max(1, Math.ceil(band.lowHz / binHz));
  const k1 = Math.min(fftN / 2 - 1, Math.floor(band.highHz / binHz));
  const slice = Math.max(1, Math.min(k1 - k0 + 1, Math.round(TONAL_SLICE_HZ / binHz)));
  const slices = new Float64Array(Math.max(1, k1 - k0 + 2 - slice));
  const sorted = new Float64Array(slices.length);
  let tonalRecent = 0; // bit i = block i ago was song-like
  const history = new Float64Array(floorBlocks);
  let historyCount = 0;
  let historyPos = 0;
  let blockAcc = 0;
  let blockFill = 0;
  let lastActiveEnd = -1;

  function total(): number {
    return bufBase + bufLen;
  }

  function appendToBuffer(x: Float32Array): void {
    if (bufLen + x.length > buf.length) {
      const bigger = new Float32Array(Math.max(buf.length * 2, bufLen + x.length));
      bigger.set(buf.subarray(0, bufLen));
      buf = bigger;
    }
    buf.set(x, bufLen);
    bufLen += x.length;
  }

  function trimBuffer(): void {
    if (bufLen <= 2 * keepLen) return;
    let keepFrom = total() - keepLen;
    for (const c of candidates) keepFrom = Math.min(keepFrom, c.syncStart - lead * 2);
    const drop = keepFrom - bufBase;
    if (drop <= 0) return;
    buf.copyWithin(0, drop, bufLen);
    bufLen -= drop;
    bufBase += drop;
  }

  /** Strongest slice of the pass band over the median slice, for the block in blockSamples. */
  function tonality(): number {
    for (let i = 0; i < fftN; i++) {
      fftIn[2 * i] = i < blockLen ? blockSamples[i]! * hann[i]! : 0;
      fftIn[2 * i + 1] = 0;
    }
    fft.transform(fftOut, fftIn);
    let acc = 0;
    let j = 0;
    for (let k = k0; k <= k1; k++) {
      acc += fftOut[2 * k]! ** 2 + fftOut[2 * k + 1]! ** 2;
      const drop = k - slice;
      if (drop >= k0) acc -= fftOut[2 * drop]! ** 2 + fftOut[2 * drop + 1]! ** 2;
      if (k - k0 + 1 >= slice) slices[j++] = Math.max(0, acc);
    }
    let peak = 0;
    for (let i = 0; i < j; i++) {
      sorted[i] = slices[i]!;
      if (slices[i]! > peak) peak = slices[i]!;
    }
    const med = sorted.subarray(0, j).sort()[j >> 1]!;
    return med > 0 ? peak / med : peak > 0 ? Infinity : 0;
  }

  function energy(x: Float32Array, endOfChunk: number): void {
    // endOfChunk: absolute index just after the last sample of x
    const startAbs = endOfChunk - x.length;
    for (let i = 0; i < x.length; i++) {
      blockAcc += x[i]! * x[i]!;
      blockSamples[blockFill] = x[i]!;
      blockFill++;
      if (blockFill === blockLen) {
        const power = blockAcc / blockLen;
        blockAcc = 0;
        blockFill = 0;
        if (historyCount === 0) history.fill(power);
        history[historyPos] = power;
        historyPos = (historyPos + 1) % floorBlocks;
        historyCount++;
        let floor = Infinity;
        for (let k = 0; k < floorBlocks; k++) if (history[k]! < floor) floor = history[k]!;
        const song = power > ACTIVE_RATIO * floor && power > ACTIVE_MIN_POWER && tonality() >= TONAL_RATIO;
        tonalRecent = ((tonalRecent << 1) | (song ? 1 : 0)) & 0b111;
        const count = (tonalRecent & 1) + ((tonalRecent >> 1) & 1) + ((tonalRecent >> 2) & 1);
        if (song && count >= 2) lastActiveEnd = startAbs + i + 1;
      }
    }
  }

  function serviceCandidates(): void {
    const myEpoch = epoch;
    while (candidates.length > 0) {
      const c = candidates[0]!;
      const end = c.syncStart + readyAfterSync;
      if (total() < end) return;
      candidates.shift();
      const from = Math.max(bufBase, c.syncStart - lead * 2);
      const segment = buf.subarray(from - bufBase, end - bufBase);
      const { symbols, confidence } = demodulateFrame(segment, c.syncStart - from, templates, p, sampleRate);
      const bytes = symbolsToBytes(symbols, p.bitsPerSymbol, FRAME_AIR_LEN);
      if (callback) callback(bytes, { sync: c.score, confidence, startSample: c.syncStart, symbols });
      if (myEpoch !== epoch) return;
    }
  }

  return {
    sampleRate,
    encode(air: Uint8Array, species: number): Float32Array {
      return renderFrame(air, species, env, profile, sampleRate);
    },
    push(pcm: Float32Array): void {
      if (pcm.length === 0) return;
      const filtered = filter.process(pcm);
      appendToBuffer(filtered);
      energy(filtered, total());
      for (const d of detector.push(filtered)) candidates.push({ syncStart: d.sample, score: d.score });
      serviceCandidates();
      trimBuffer();
    },
    onFrame(cb: (air: Uint8Array, meta: RxMeta) => void): void {
      callback = cb;
    },
    busy(): boolean {
      if (lastActiveEnd >= 0 && total() - lastActiveEnd <= hangover) return true;
      return candidates.some((c) => c.score >= STRONG_SYNC);
    },
    reset(): void {
      epoch++;
      filter = createBandpass(band.lowHz, band.highHz, sampleRate);
      detector.reset();
      bufLen = 0;
      bufBase = 0;
      candidates = [];
      history.fill(0);
      historyCount = 0;
      historyPos = 0;
      tonalRecent = 0;
      blockAcc = 0;
      blockFill = 0;
      lastActiveEnd = -1;
    },
  };
}
