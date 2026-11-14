import type { AudioPort } from '@birdsong/core';

const CHUNK = 2048;

export type WebAudioPort = AudioPort & { context: AudioContext; analyser: AnalyserNode };

export function createWebAudioPort(): WebAudioPort {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  const master = context.createGain();
  master.gain.value = 0.8;
  master.connect(context.destination);
  const sink = context.createGain(); // gain 0: keeps nodes alive on Safari
  sink.gain.value = 0;
  sink.connect(context.destination);

  let onInput: ((pcm: Float32Array) => void) | null = null;
  let stream: MediaStream | null = null;
  let starting: Promise<void> | null = null;
  let lastEnd = 0;
  let acc = new Float32Array(CHUNK);
  let fill = 0;

  function feed(block: Float32Array): void {
    let i = 0;
    while (i < block.length) {
      const n = Math.min(block.length - i, CHUNK - fill);
      acc.set(block.subarray(i, i + n), fill);
      fill += n;
      i += n;
      if (fill === CHUNK) {
        const out = acc;
        acc = new Float32Array(CHUNK);
        fill = 0;
        onInput?.(out);
      }
    }
  }

  async function doStart(): Promise<void> {
    await context.resume();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    await context.audioWorklet.addModule(new URL('capture-worklet.js', document.baseURI));
    const src = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, 'birdsong-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => feed(e.data);
    src.connect(worklet);
    worklet.connect(sink);
    src.connect(analyser);
    analyser.connect(sink);
  }

  return {
    context,
    analyser,
    sampleRate: context.sampleRate,
    start() {
      starting ??= doStart();
      return starting;
    },
    async stop() {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      starting = null;
      await context.close().catch(() => {});
    },
    onInput(cb) {
      onInput = cb;
    },
    play(pcm) {
      return new Promise<void>((resolve) => {
        const buf = context.createBuffer(1, pcm.length, context.sampleRate);
        buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
        const node = context.createBufferSource();
        node.buffer = buf;
        node.connect(master);
        const at = Math.max(context.currentTime + 0.05, lastEnd);
        lastEnd = at + buf.duration;
        node.onended = () => resolve();
        node.start(at);
      });
    },
    setVolume(v) {
      master.gain.value = Math.max(0, Math.min(1, v));
    },
  };
}
