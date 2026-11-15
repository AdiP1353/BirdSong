import { useEffect, useState } from 'preact/hooks';
import { ENVS } from '@birdsong/core';
import { setDisabled, store, subscribe } from './hubClient.ts';
import { dominantEnv, feed, latestMsgId, stats } from './derive.ts';
import { startAir } from './air.ts';
import { FlockGraph } from './components/FlockGraph.tsx';
import { Score } from './components/Score.tsx';
import { JoinQr } from './components/JoinQr.tsx';
import { Controls } from './components/Controls.tsx';
import { Feed } from './components/Feed.tsx';
import { NodeLinks } from './components/NodeLinks.tsx';
import { Topology } from './components/Topology.tsx';
import { AirControls, AirScope } from './components/AirControls.tsx';
import { BirdGrid } from './components/BirdGrid.tsx';

type View = 'graph' | 'birds';

function loadView(): View {
  const q = new URLSearchParams(location.search).get('view');
  if (q === 'birds' || q === 'graph') return q;
  try { return localStorage.getItem('birdsong.dash.view') === 'birds' ? 'birds' : 'graph'; } catch { return 'graph'; }
}

export function App() {
  const [, setV] = useState(0);
  const [view, setView] = useState<View>(loadView);
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  useEffect(() => startAir(), []);

  const pickView = (v: View): void => {
    setView(v);
    try { localStorage.setItem('birdsong.dash.view', v); } catch { /* private mode */ }
  };
  const toggleDisabled = (): void => {
    setBusy(true);
    void setDisabled(!store.disabled).finally(() => setBusy(false));
  };

  const nodes = store.state.snapshot();
  const events = store.state.recent();
  const env = dominantEnv(nodes);
  const theme = ENVS[env].theme;
  const focus = store.focus ?? latestMsgId(events);
  const s = stats(nodes, events);
  const profile = nodes.find((n) => n.online)?.config.profile ?? ENVS[env].defaultProfile;
  const camouflage = nodes.some((n) => n.online && n.config.camouflage);
  const off = store.disabled;

  return (
    <div class={`app ${off ? 'is-off' : ''}`} style={{ '--bg': theme.bg, '--fg': theme.fg, '--accent': theme.accent }}>
      <header class="stats">
        <h1>BirdSong</h1>
        <span class="stat"><b>{s.online}</b> online</span>
        <span class="stat"><b>{s.heard}</b> frames heard</span>
        <span class="stat"><b>{s.crc}</b> CRC failures</span>
        <span class="stat"><b>{s.delivered}</b> delivered</span>
        <div class="seg" role="group" aria-label="View">
          <button class={view === 'graph' ? 'on' : ''} disabled={off} onClick={() => pickView('graph')}>Graph</button>
          <button class={view === 'birds' ? 'on' : ''} disabled={off} onClick={() => pickView('birds')}>Birds</button>
        </div>
        <AirControls />
        <button class={`power ${off ? 'off' : ''}`} disabled={busy || !store.connected} onClick={toggleDisabled}>
          {off ? 'Turn dashboard back on' : 'Turn dashboard off'}
        </button>
        <span class={`conn ${store.connected ? 'ok' : 'bad'}`}>{store.connected ? (off ? 'off' : 'live') : 'reconnecting'}</span>
      </header>
      <main class="main">
        <section class={`left ${off || view === 'birds' ? 'birds-view' : ''}`}>
          {off && (
            <div class="panel off-banner">
              <div>
                <h2>The dashboard is off</h2>
                <p>
                  The hub has cut every bird loose: it can't see them and can't control them. Listen, and watch their
                  own windows below. They still sing to each other, and messages still hop from bird to bird.
                  Try sending one.
                </p>
              </div>
              <AirScope width={360} height={90} class="big" />
            </div>
          )}
          {off || view === 'birds' ? (
            <BirdGrid nodes={nodes} />
          ) : (
            <>
              <FlockGraph nodes={nodes} events={events} focus={focus} />
              <Score nodes={nodes} events={events} env={env} />
            </>
          )}
        </section>
        <aside class="right" inert={off} aria-disabled={off}>
          <JoinQr join={store.join} env={env} profile={profile} />
          <Controls nodes={nodes} events={events} focus={focus} env={env} profile={profile} camouflage={camouflage} />
          <Topology topology={store.topology} />
          <NodeLinks nodes={nodes} />
          <Feed messages={feed(events)} focus={focus} />
        </aside>
      </main>
    </div>
  );
}
