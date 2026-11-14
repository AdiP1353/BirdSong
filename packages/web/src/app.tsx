import { useEffect, useRef, useState } from 'preact/hooks';
import { ENVS } from '@birdsong/core';
import type { NodeConfig, NodeState } from '@birdsong/core';
import { Flock } from './components/Flock.tsx';
import { Join } from './components/Join.tsx';
import { parseJoin } from './join.ts';
import { createLocalRuntime, createRemoteRuntime } from './runtime.ts';
import type { Runtime } from './runtime.ts';

const remote = new URLSearchParams(location.search).get('runtime') === 'remote';
const initialJoin = parseJoin(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

async function keepAwake(): Promise<void> {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {
    // ignore
  }
}

function micMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was denied. Allow the microphone for this site in your browser settings (the lock icon in the address bar), then tap Join again.';
  }
  return e instanceof Error ? e.message : String(e);
}

export function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(() => (remote ? createRemoteRuntime() : null));
  const [state, setState] = useState<NodeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const secrets = useRef({ passphrase: initialJoin.passphrase ?? '', alias: '' });

  const refresh = () => {
    runtime?.state().then(setState).catch(() => {});
  };

  useEffect(() => {
    if (!runtime) return;
    refresh();
    runtime.onEvent(refresh);
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [runtime]);

  useEffect(() => {
    if (!state) return;
    const th = ENVS[state.config.env].theme;
    const s = document.documentElement.style;
    s.setProperty('--bg', th.bg);
    s.setProperty('--fg', th.fg);
    s.setProperty('--accent', th.accent);
  }, [state?.config.env]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && runtime) void keepAwake();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [runtime]);

  function join(p: { passphrase: string; env: NodeConfig['env']; profile: NodeConfig['profile']; alias: string }) {
    setError(null);
    setBusy(true);
    secrets.current = { passphrase: p.passphrase, alias: p.alias };
    const rt = createLocalRuntime(p);
    // Synchronous within the click: starts the audio port while the user gesture is live.
    const started = rt.start();
    void keepAwake();
    started.then(
      () => {
        setRuntime(rt);
        setBusy(false);
      },
      (e) => {
        setError(micMessage(e));
        setBusy(false);
      },
    );
  }

  const configure = (patch: Partial<NodeConfig>) => {
    runtime?.configure(patch).then(setState).catch((e) => setError(String(e)));
  };

  return (
    <main>
      {!runtime && <Join initial={initialJoin} error={error} busy={busy} onJoin={join} />}
      {runtime && state && (
        <Flock runtime={runtime} state={state} passphrase={secrets.current.passphrase} alias={secrets.current.alias} refresh={refresh} configure={configure} />
      )}
      {runtime && !state && <p class="dim">Connecting...</p>}
    </main>
  );
}
