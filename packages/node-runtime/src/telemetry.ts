import type { BirdNode, Command, TelemetryEvent } from '@birdsong/core';

export interface Observatory {
  close(): void;
}

const MAX_QUEUE = 200;

export function connectObservatory(base: string, node: BirdNode): Observatory {
  const url = `${base.replace(/\/$/, '')}/node`;
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const queue: string[] = [];

  function hello(): string {
    const s = node.state();
    return JSON.stringify({ type: 'hello', node: s.id, species: s.species, kind: s.kind, config: s.config, t: Date.now() } satisfies TelemetryEvent);
  }

  function handle(raw: string) {
    let cmd: Command;
    try { cmd = JSON.parse(raw) as Command; } catch { return; }
    const me = node.state().id;
    if (cmd.node !== me && cmd.node !== 'all') return;
    if (cmd.type === 'configure') {
      node.configure(cmd.patch).catch((err) => console.error('[telemetry] configure failed:', err));
    } else if (cmd.type === 'send') {
      node.send(cmd.text).catch((err) => console.error('[telemetry] send failed:', err));
    }
  }

  function connect() {
    if (closed) return;
    let sock: WebSocket;
    try { sock = new WebSocket(url); } catch { retry = setTimeout(connect, 2000); return; }
    let lost = false;
    const onLost = () => {
      if (lost) return;
      lost = true;
      if (ws === sock) ws = null;
      if (!closed) retry = setTimeout(connect, 2000);
    };
    sock.onopen = () => {
      if (closed) { sock.close(); return; }
      ws = sock;
      sock.send(hello());
      while (queue.length > 0) sock.send(queue.shift()!);
    };
    sock.onmessage = (ev) => { if (typeof ev.data === 'string') handle(ev.data); };
    sock.onerror = () => {};
    sock.onclose = onLost;
  }

  node.onEvent((e) => {
    const msg = JSON.stringify(e);
    if (ws && ws.readyState === 1) ws.send(msg);
    else {
      queue.push(msg);
      if (queue.length > MAX_QUEUE) queue.shift();
    }
  });
  connect();

  return {
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    },
  };
}
