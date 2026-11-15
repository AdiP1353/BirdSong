import type { NodeState } from '@birdsong/core';

export function Inbox(props: { state: NodeState }) {
  const rows = [...props.state.inbox].sort((a, b) => b.receivedAt - a.receivedAt);
  return (
    <section class="panel">
      <h2>Inbox</h2>
      {rows.length === 0 && <p class="dim">Nothing yet. Listening...</p>}
      {rows.map((m) => (
        <div class="msg" key={m.msgId}>
          <div class="dim">
            {m.alias || 'anon'} {m.mine ? '(sent)' : ''} · {m.hops} hop{m.hops === 1 ? '' : 's'} · {new Date(m.receivedAt).toLocaleTimeString()}
            {m.suppressed && <span class="quiet" title="Received more times than the relay limit, so this node stopped singing it"> · stopped relaying</span>}
          </div>
          <div>{m.text}{m.count > 1 && <span class="count" title={`Received ${m.count} times`}> ({m.count})</span>}</div>
        </div>
      ))}
    </section>
  );
}

export function InFlight(props: { state: NodeState }) {
  const pending = props.state.messages.filter((m) => !m.decoded);
  const held = props.state.messages.filter((m) => m.decoded);
  if (pending.length === 0 && held.length === 0) return null;
  return (
    <section class="panel">
      <h2>In flight</h2>
      {pending.map((m) => (
        <div key={m.msgId}>
          <div class="dim">message {m.msgId}: {m.rank} / {m.k}</div>
          <progress max={m.k} value={m.rank} />
        </div>
      ))}
      {held.map((m) => (
        <div class="dim" key={m.msgId}>
          message {m.msgId}: sung {m.sang} droplet{m.sang === 1 ? '' : 's'}{m.suppressed ? ' · stopped relaying' : ''}
        </div>
      ))}
    </section>
  );
}
