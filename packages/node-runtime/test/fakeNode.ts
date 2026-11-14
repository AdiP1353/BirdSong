import type { BirdNode, NodeConfig, NodeState, TelemetryEvent } from '@birdsong/core';
import { DEFAULT_NODE_CONFIG } from '@birdsong/core';

export function makeFakeNode(id = 3): BirdNode & { calls: string[]; emit(e: TelemetryEvent): void } {
  const listeners: ((e: TelemetryEvent) => void)[] = [];
  const calls: string[] = [];
  let config: NodeConfig = { ...DEFAULT_NODE_CONFIG };
  return {
    calls,
    emit(e) { for (const l of listeners) l(e); },
    async start() {},
    async stop() {},
    async send(text) {
      if (text.length > 100) throw new RangeError('message too long');
      calls.push(`send:${text}`);
      return 42;
    },
    async configure(patch) {
      calls.push(`configure:${JSON.stringify(patch)}`);
      config = { ...config, ...patch };
    },
    state(): NodeState {
      return { id, species: 1, kind: 'container', config, messages: [], inbox: [] };
    },
    onEvent(cb) { listeners.push(cb); },
    async settled() {},
  };
}
