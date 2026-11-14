import { useEffect, useState } from 'preact/hooks';
import type { NodeSnapshot } from '@birdsong/core';

/** Links to each container node's page, served by the hub at /app/ and pointed at the node through the proxy. */
export function NodeLinks(props: { nodes: NodeSnapshot[] }) {
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  useEffect(() => {
    fetch('/config.json').then((r) => r.json()).then(
      (c: { proxyUrl?: string | null }) => setProxyUrl(c.proxyUrl ?? null),
      () => {},
    );
  }, []);
  const nodes = props.nodes.filter((n) => n.online && n.kind === 'container');
  if (!proxyUrl || nodes.length === 0) return null;
  const base = proxyUrl.replace(/\/+$/, '');
  return (
    <div class="panel">
      <h2>Node pages</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
        {nodes.map((n) => (
          <a key={n.node} style={{ color: 'var(--accent)' }} target="_blank" rel="noopener"
             href={`/app/?runtime=remote&node=${encodeURIComponent(`${base}/nodes/${n.node}`)}`}>
            node {n.node}
          </a>
        ))}
      </div>
    </div>
  );
}
