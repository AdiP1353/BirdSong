#!/usr/bin/env node
const base = `http://localhost:${process.env['BIRDSONG_PORT'] ?? 8080}`;

async function call(path: string, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(base + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`cannot reach the node at ${base}: ${(err as Error).message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

function usage(): never {
  console.error('usage: birdsong send "<text>" | inbox | state | config key=value ...');
  process.exit(1);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'send': {
      if (rest.length === 0) usage();
      const r = await call('/api/send', { text: rest.join(' ') });
      console.log(`sent message ${r.msgId}`);
      break;
    }
    case 'inbox': {
      const s = await call('/api/state');
      if (s.inbox.length === 0) console.log('(inbox empty)');
      for (const m of s.inbox) console.log(`#${m.msgId} ${m.alias}${m.mine ? ' (me)' : ''} [hops ${m.hops}]: ${m.text}`);
      break;
    }
    case 'state': {
      const s = await call('/api/state');
      console.log(`node ${s.id} (${s.kind}) species ${s.species}`);
      console.log(`config: ${JSON.stringify(s.config)}`);
      for (const m of s.messages) {
        console.log(`message ${m.msgId}: rank ${m.rank}/${m.k}${m.decoded ? ' decoded' : ''} hop ${m.hop} heard ${m.heard} sang ${m.sang}`);
      }
      console.log(`inbox: ${s.inbox.length} message(s)`);
      break;
    }
    case 'config': {
      if (rest.length === 0) usage();
      const patch: Record<string, unknown> = {};
      for (const kv of rest) {
        const i = kv.indexOf('=');
        if (i < 1) usage();
        const raw = kv.slice(i + 1);
        let v: unknown = raw;
        try { v = JSON.parse(raw); } catch { /* keep string */ }
        patch[kv.slice(0, i)] = v;
      }
      const s = await call('/api/config', patch);
      console.log(`config: ${JSON.stringify(s.config)}`);
      break;
    }
    default: usage();
  }
}

main().catch((err: Error) => {
  console.error(`birdsong: ${err.message}`);
  process.exit(1);
});
