import { useEffect, useState } from 'preact/hooks';
import type { NodeSnapshot } from '@birdsong/core';

/**
 * Every container bird's own page, side by side in small windows. Each window talks to its node through the
 * proxy (port 3100), not through the hub, so the windows keep working while the dashboard is disabled.
 */
export function BirdGrid(props: { nodes: NodeSnapshot[] }) {
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => {
    fetch('/config.json').then((r) => r.json()).then(
      (c: { proxyUrl?: string | null }) => setProxyUrl(c.proxyUrl ?? null),
      () => {},
    );
  }, []);
  // Remember every container bird ever seen, so windows stay put while nodes drop off the hub.
  const seen = props.nodes.filter((n) => n.kind === 'container').map((n) => n.node);
  useEffect(() => {
    setIds((old) => {
      const all = [...new Set([...old, ...seen])].sort((a, b) => a - b);
      return all.join(',') === old.join(',') ? old : all;
    });
  }, [seen.join(',')]);

  if (!proxyUrl) {
    return <div class="panel birds-empty dim">Bird windows need the simulated mesh's proxy (PROXY_URL).</div>;
  }
  const base = proxyUrl.replace(/\/+$/, '');
  const shown = ids.length > 0 ? ids : [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <div class="birds" style={{ '--cols': String(Math.min(4, Math.max(1, Math.ceil(shown.length / 2)))) }}>
      {shown.map((id) => {
        const node = `${base}/nodes/${id}`;
        return (
          <div class="bird-win" key={id}>
            <iframe title={`bird ${id}`} src={`/app/?runtime=remote&compact=1&node=${encodeURIComponent(node)}`} />
            <a class="bird-open" href={`/app/?runtime=remote&node=${encodeURIComponent(node)}`} target="_blank" rel="noopener" title={`Open bird ${id}'s full page`}>↗</a>
          </div>
        );
      })}
    </div>
  );
}
