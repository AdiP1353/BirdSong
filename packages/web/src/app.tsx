import { useEffect, useRef, useState } from 'preact/hooks';
import { ENVS } from '@birdsong/core';
import type { NodeConfig, NodeState } from '@birdsong/core';
import { Flock } from './components/Flock.tsx';
import { Join } from './components/Join.tsx';
import { parseJoin } from './join.ts';
import { createLocalRuntime, createRemoteRuntime, nodeBaseFromLocation } from './runtime.ts';
import type { Runtime } from './runtime.ts';

const params = new URLSearchParams(location.search);
const remote = params.get('runtime') === 'remote';
const compact = params.get('compact') === '1';
if (compact) document.documentElement.classList.add('compact');
let remoteBase: string | null = null;
let remoteError: string | null = null;
if (remote) {
  try { remoteBase = nodeBaseFromLocation(location.href, params.get('node')); }
  catch (e) { remoteError = e instanceof Error ? e.message : String(e); }
}
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
    return 'Microphone access was denied. Allow the microphone for this site in your browser settings (the lock icon in the address bar), then tap "Turn on the microphone" again.';
  }
  return e instanceof Error ? e.message : String(e);
}

export function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(() => (remoteBase !== null ? createRemoteRuntime(remoteBase) : null));
  const [state, setState] = useState<NodeState | null>(null);
  const [error, setError] = useState<string | null>(remoteError);
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
        <Flock runtime={runtime} state={state} passphrase={secrets.current.passphrase} alias={secrets.current.alias} refresh={refresh} configure={configure} compact={compact} />
      )}
      {runtime && !state && <p class="dim">Connecting...</p>}
    </main>
  );
}
