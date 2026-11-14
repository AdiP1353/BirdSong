import { useEffect, useState } from 'preact/hooks';
import { ENVS } from '@birdsong/core';
import { store, subscribe } from './hubClient.ts';
import { dominantEnv, feed, latestMsgId, stats } from './derive.ts';
import { FlockGraph } from './components/FlockGraph.tsx';
import { Score } from './components/Score.tsx';
import { JoinQr } from './components/JoinQr.tsx';
import { Controls } from './components/Controls.tsx';
import { Feed } from './components/Feed.tsx';
import { Listen } from './components/Listen.tsx';
import { NodeLinks } from './components/NodeLinks.tsx';

export function App() {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);

  const nodes = store.state.snapshot();
  const events = store.state.recent();
  const env = dominantEnv(nodes);
  const theme = ENVS[env].theme;
  const focus = store.focus ?? latestMsgId(events);
  const s = stats(nodes, events);
  const profile = nodes.find((n) => n.online)?.config.profile ?? ENVS[env].defaultProfile;
  const camouflage = nodes.some((n) => n.online && n.config.camouflage);

  return (
    <div class="app" style={{ '--bg': theme.bg, '--fg': theme.fg, '--accent': theme.accent }}>
      <header class="stats">
        <h1>BirdSong</h1>
        <span class="stat"><b>{s.online}</b> online</span>
        <span class="stat"><b>{s.heard}</b> frames heard</span>
        <span class="stat"><b>{s.crc}</b> CRC failures</span>
        <span class="stat"><b>{s.delivered}</b> delivered</span>
        <span class={`conn ${store.connected ? 'ok' : 'bad'}`}>{store.connected ? 'live' : 'reconnecting'}</span>
      </header>
      <main class="main">
        <section class="left">
          <FlockGraph nodes={nodes} events={events} focus={focus} />
          <Score nodes={nodes} events={events} env={env} />
        </section>
        <aside class="right">
          <JoinQr join={store.join} env={env} profile={profile} />
          <Controls nodes={nodes} events={events} focus={focus} env={env} profile={profile} camouflage={camouflage} />
          <Listen />
          <NodeLinks nodes={nodes} />
          <Feed messages={feed(events)} focus={focus} />
        </aside>
      </main>
    </div>
  );
}
