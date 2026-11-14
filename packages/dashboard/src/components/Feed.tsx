import { setFocus } from '../hubClient.ts';
import type { FeedMessage } from '../derive.ts';

export function Feed(props: { messages: FeedMessage[]; focus: number | null }) {
  return (
    <div class="panel feed">
      <h2>Messages</h2>
      {props.messages.length === 0 && <p class="dim">Waiting for the first message...</p>}
      {props.messages.map((m) => (
        <div key={m.msgId} class={`msg ${m.msgId === props.focus ? 'focus' : ''}`} onClick={() => setFocus(m.msgId)}>
          <div class="msg-text">"{m.text}" <span class="alias">- {m.alias}</span></div>
          <div class="chips">
            {m.decodes.map((d) => (
              <span class="chip" key={d.node}>
                #{d.node} ({d.hops}){d.afterMs !== null && d.hops > 0 ? ` ${(d.afterMs / 1000).toFixed(1)}s` : ''}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
