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
const ACTIVE_RATIO = 4;
const ACTIVE_MIN_POWER = 1e-7;
const HANGOVER_MS = 250;
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

  function energy(x: Float32Array, endOfChunk: number): void {
    // endOfChunk: absolute index just after the last sample of x
    const startAbs = endOfChunk - x.length;
    for (let i = 0; i < x.length; i++) {
      blockAcc += x[i]! * x[i]!;
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
        if (power > ACTIVE_RATIO * floor && power > ACTIVE_MIN_POWER) lastActiveEnd = startAbs + i + 1;
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
      if (candidates.length > 0) return true;
      return lastActiveEnd >= 0 && total() - lastActiveEnd <= hangover;
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
      blockAcc = 0;
      blockFill = 0;
      lastActiveEnd = -1;
    },
  };
}
