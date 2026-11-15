import { useEffect, useState } from 'preact/hooks';
import type { NodeSnapshot, TopologyView } from '@birdsong/core';
import { addBird, removeBird } from '../hubClient.ts';
import { speciesColor } from '../derive.ts';

/**
 * Add and remove birds in the simulated mesh. Adding starts a new container (through the hub and the nursery);
 * in manual topology mode the new bird is linked two-way to the birds ticked here. Removing stops the container
 * and drops its links.
 */
export function FlockEditor(props: { nodes: NodeSnapshot[]; topology: TopologyView | null }) {
  const [enabled, setEnabled] = useState(false);
  const [links, setLinks] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/config.json').then((r) => r.json()).then(
      (c: { flockEditable?: boolean }) => setEnabled(!!c.flockEditable),
      () => {},
    );
  }, []);

  const birds = props.nodes.filter((n) => n.kind === 'container');
  const ids = new Set(props.nodes.map((n) => n.node));
  // Drop ticks for birds that have left.
  useEffect(() => {
    setLinks((l) => (l.every((x) => ids.has(x)) ? l : l.filter((x) => ids.has(x))));
  }, [[...ids].join(',')]);

  if (!enabled) return null;
  const manual = props.topology?.manual ?? false;
  let next = 0;
  while (next < 128 && ids.has(next)) next++;

  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const toggle = (id: number): void => setLinks((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id].sort((a, b) => a - b)));

  return (
    <div class="panel flock-editor">
      <h2>Birds <span class="badge">{birds.length}</span></h2>
      <div class="chips">
        {birds.map((n) => (
          <span class={`bird-chip ${n.online ? '' : 'dim'}`} key={n.node}>
            <i style={{ background: speciesColor(n.species) }} />#{n.node}
            <button
              class="x" disabled={busy !== null} data-tip={`Remove bird ${n.node}: its container stops and its links are dropped.`} aria-label={`Remove bird ${n.node}`}
              onClick={() => void run(`rm${n.node}`, () => removeBird(n.node))}
            >
              {busy === `rm${n.node}` ? '…' : '×'}
            </button>
          </span>
        ))}
      </div>
      <div class="add">
        {manual ? (
          <>
            <div class="hint">Tick the birds that new bird #{next} hears and is heard by:</div>
            <div class="chips">
              {props.nodes.map((n) => (
                <label class={`pick ${links.includes(n.node) ? 'on' : ''}`} key={n.node}>
                  <input type="checkbox" aria-label={`Link to bird ${n.node}`} checked={links.includes(n.node)} onChange={() => toggle(n.node)} />#{n.node}
                </label>
              ))}
            </div>
          </>
        ) : (
          <div class="dim hint">Distance mode: bird #{next} joins at grid spot ({next % 4}, {Math.floor(next / 4)}).</div>
        )}
        <button
          disabled={busy !== null || next >= 128 || (manual && links.length === 0)}
          onClick={() => void run('add', async () => { await addBird(next, links); setLinks([]); })}
        >
          {busy === 'add' ? 'Starting…' : manual && links.length === 0 ? 'Tick at least one bird above' : `Add bird #${next}`}
        </button>
      </div>
      {error && <div class="error">{error}</div>}
    </div>
  );
}
