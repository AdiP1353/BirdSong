import { useEffect, useRef, useState } from 'preact/hooks';
import type { TopologyView } from '@birdsong/core';
import { setTopology } from '../hubClient.ts';
import { TOPOLOGY_PRESETS } from '../presets.ts';
import { matchPreset } from '../presetMatch.ts';

/** Edit which simulated node hears which. The hub relays changes to the ether; nothing else may change them. */
export function Topology(props: { topology: TopologyView | null }) {
  const [editable, setEditable] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const edited = useRef(false);

  useEffect(() => {
    fetch('/config.json').then((r) => r.json()).then(
      (c: { topologyEditable?: boolean }) => {
        if (!c.topologyEditable) return;
        setEditable(true);
        void load();
      },
      () => {},
    );
  }, []);

  // A change from another tab replaces the text, unless this tab has unsaved edits.
  useEffect(() => {
    if (props.topology && !edited.current) setDraft(props.topology.text);
  }, [props.topology?.text]);

  async function load(): Promise<void> {
    try {
      const r = await fetch('/api/topology');
      const body = await r.json() as TopologyView | { error: string };
      if (!r.ok || 'error' in body) { setError('error' in body ? body.error : `HTTP ${r.status}`); return; }
      setError(null);
      setTopology(body);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function apply(text: string): Promise<void> {
    setBusy(true);
    try {
      const r = await fetch('/api/topology', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
      });
      const body = await r.json() as TopologyView | { error: string };
      if (!r.ok || 'error' in body) { setError('error' in body ? body.error : `HTTP ${r.status}`); return; }
      setError(null);
      edited.current = false;
      setDraft(body.text);
      setTopology(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!editable) return null;
  const manual = props.topology?.manual ?? false;
  const active = matchPreset(props.topology);
  return (
    <div class="panel topology">
      <h2>
        Topology <span class={`badge ${manual ? 'on' : ''}`}>{props.topology ? (manual ? 'manual' : 'distance') : '…'}</span>
      </h2>
      <div class="row presets">
        {TOPOLOGY_PRESETS.map((p) => (
          <button
            key={p.id} disabled={busy} data-tip={p.description}
            class={active?.id === p.id ? 'on' : ''}
            onClick={() => void apply(p.text)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <textarea
        rows={4} spellcheck={false} value={draft} placeholder="Blank = hear by distance. Example: 0-1,2"
        aria-label="Topology links"
        onInput={(e) => { edited.current = true; setDraft(e.currentTarget.value); }}
      />
      <div class="dim hint"><code>0-1,2</code> two-way links 0↔1 and 0↔2 · <code>4&gt;5</code> only 5 hears 4 · <code>#</code> comment</div>
      <div class="row">
        <button disabled={busy} onClick={() => void apply(draft)}>Apply</button>
        <button disabled={busy || !manual} onClick={() => void apply('')}>Use distance</button>
      </div>
      {error && <div class="error">{error}</div>}
    </div>
  );
}
