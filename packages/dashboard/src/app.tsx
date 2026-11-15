import { useEffect, useState } from 'preact/hooks';
import { ENVS } from '@birdsong/core';
import { setDisabled, setStopped, store, subscribe } from './hubClient.ts';
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
import { FlockEditor } from './components/FlockEditor.tsx';
import { NoisePanel } from './components/NoisePanel.tsx';
import { AirPanel } from './components/AirPanel.tsx';
import { SpyPanel } from './components/SpyPanel.tsx';

type View = 'graph' | 'birds';
type Bottom = 'score' | 'air';

function loadView(): View {
  const q = new URLSearchParams(location.search).get('view');
  if (q === 'birds' || q === 'graph') return q;
  try { return localStorage.getItem('birdsong.dash.view') === 'birds' ? 'birds' : 'graph'; } catch { return 'graph'; }
}

export function App() {
  const [, setV] = useState(0);
  const [view, setView] = useState<View>(loadView);
  const [busy, setBusy] = useState(false);
  const [bottom, setBottom] = useState<Bottom>(() => {
    try { return localStorage.getItem('birdsong.dash.bottom') === 'air' ? 'air' : 'score'; } catch { return 'score'; }
  });
  const pickBottom = (b: Bottom): void => {
    setBottom(b);
    try { localStorage.setItem('birdsong.dash.bottom', b); } catch { /* private mode */ }
  };
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  useEffect(() => startAir(), []);

  const pickView = (v: View): void => {
    setView(v);
    try { localStorage.setItem('birdsong.dash.view', v); } catch { /* private mode */ }
  };
  const toggleStopped = (): void => {
    setBusy(true);
    void setStopped(!store.stopped).finally(() => setBusy(false));
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
        <span class="stat" data-tip="Birds the hub can see right now."><b>{s.online}</b> online</span>
        <span class="stat" data-tip="Frames (one chirped packet, about 3 s) that a bird received intact."><b>{s.heard}</b> frames heard</span>
        <span class="stat" data-tip="Frames that arrived too damaged to repair, or sounds mistaken for a frame. They are thrown away."><b>{s.crc}</b> CRC failures</span>
        <span class="stat" data-tip="Messages that at least one bird has decoded and read."><b>{s.delivered}</b> delivered</span>
        <div class="seg" role="group" aria-label="View">
          <button class={view === 'graph' ? 'on' : ''} disabled={off} data-tip="The flock as a graph: who hears whom, and messages hopping between birds." onClick={() => pickView('graph')}>Graph</button>
          <button class={view === 'birds' ? 'on' : ''} disabled={off} data-tip="Every bird's own screen, with its inbox and a send box." onClick={() => pickView('birds')}>Birds</button>
        </div>
        <AirControls />
        <button
          class={`stop ${store.stopped ? 'stopped' : ''}`} disabled={busy || off || !store.connected} onClick={toggleStopped}
          data-tip={store.stopped ? 'Unmute every bird. They carry on with messages still in flight.' : 'Mute every bird: they stop singing and listening until you press Start.'}
        >
          {store.stopped ? '▶ Start birds' : '■ Stop birds'}
        </button>
        <button
          class={`power ${off ? 'off' : ''}`} disabled={busy || !store.connected} onClick={toggleDisabled}
          data-tip={off ? 'Reconnect the dashboard to the birds.' : 'Cut the dashboard off from every bird. They keep singing and delivering by sound alone.'}
        >
          {off ? '⏻ Restore the network' : '✂ Cut the internet'}
        </button>
        <span class={`conn ${store.connected ? 'ok' : 'bad'}`}>{store.connected ? (off ? 'off' : 'live') : 'reconnecting'}</span>
      </header>
      <main class="main">
        <section class={`left ${off || view === 'birds' ? 'birds-view' : ''}`}>
          {off && (
            <div class="panel off-banner">
              <div>
                <h2 class="down">NETWORK DOWN</h2>
                <p>
                  The internet is cut: the hub has lost every bird. It can't see them and can't control them.
                  Listen. They still sing to each other, and messages still hop from bird to bird, by sound alone.
                  Send one and watch it land in their windows below.
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
              <div class="bottom">
                <div class="seg bottom-pick" role="group" aria-label="Lower panel">
                  <button class={bottom === 'score' ? 'on' : ''} data-tip="The notes being sung, as a piano roll." onClick={() => pickBottom('score')}>Score</button>
                  <button class={bottom === 'air' ? 'on' : ''} data-tip="A large spectrogram of the air, with the camouflage trick." onClick={() => pickBottom('air')}>Air</button>
                </div>
                {bottom === 'score'
                  ? <Score nodes={nodes} events={events} env={env} />
                  : <AirPanel env={env} camouflage={camouflage} disabled={off} />}
              </div>
            </>
          )}
        </section>
        <aside class="right" inert={off} aria-disabled={off}>
          <JoinQr join={store.join} env={env} profile={profile} />
          <Controls nodes={nodes} events={events} focus={focus} env={env} profile={profile} camouflage={camouflage} />
          <NoisePanel sources={store.noiseSources} />
          <SpyPanel events={events} focus={focus} message={feed(events).find((m) => m.msgId === focus)} />
          <FlockEditor nodes={nodes} topology={store.topology} />
          <Topology topology={store.topology} />
          <NodeLinks nodes={nodes} />
          <Feed messages={feed(events)} focus={focus} />
        </aside>
      </main>
    </div>
  );
}
