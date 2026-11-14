import {
  DEFAULT_NODE_CONFIG, createBirdNode, createModem, createRealClock,
} from '@birdsong/core';
import type { AudioPort, NodeConfig } from '@birdsong/core';
import { createEtherPort } from '@birdsong/ether';
import { USAGE, parseConfig } from './config.ts';
import { createPulsePort, pulseAvailable } from './pulsePort.ts';
import { createAmbientPlayer } from './ambientPlayer.ts';
import { startHttp } from './http.ts';
import { connectObservatory } from './telemetry.ts';

let cfg;
try {
  cfg = parseConfig(process.argv.slice(2), process.env);
} catch (err) {
  console.error(`birdsong: ${(err as Error).message}\n\n${USAGE}`);
  process.exit(2);
}
if (cfg.help) {
  console.log(USAGE);
  process.exit(0);
}

process.on('unhandledRejection', (err) => console.error('[birdsong] unhandled rejection:', err));

let port: AudioPort;
if (cfg.audio === 'pulse') {
  if (!(await pulseAvailable())) {
    console.error(
      'birdsong: cannot reach a PulseAudio/PipeWire-Pulse server (`pactl info` failed).\n' +
      'In Docker, mount the host socket and set PULSE_SERVER; scripts/run-node.sh does this for you:\n' +
      '  BIRDSONG_ID=3 scripts/run-node.sh --key <passphrase>\n' +
      'On the host, make sure pipewire-pulse is running: systemctl --user enable --now pipewire-pulse',
    );
    process.exit(3);
  }
  port = createPulsePort();
} else {
  port = createEtherPort({ url: cfg.ether, id: cfg.id, x: cfg.x, y: cfg.y });
}

const config: NodeConfig = {
  ...DEFAULT_NODE_CONFIG,
  env: cfg.env,
  profile: cfg.profile,
  volume: cfg.volume,
  neighbors: cfg.neighbors,
  camouflage: cfg.camouflage,
};
const node = createBirdNode({
  id: cfg.id, kind: 'container', passphrase: cfg.key, alias: cfg.alias, config, port,
  clock: createRealClock(), rng: Math.random, modemFactory: createModem,
});
await node.start();

const http = await startHttp(node, cfg.port);
const observatory = cfg.observatory ? connectObservatory(cfg.observatory, node) : null;

const ambient = cfg.audio === 'pulse' ? createAmbientPlayer({ sampleRate: port.sampleRate }) : null;
function syncAmbient() {
  if (!ambient) return;
  const c = node.state().config;
  ambient.setEnv(c.env);
  ambient.setLevel(c.volume);
  if (c.camouflage && !c.muted) ambient.start();
  else ambient.stop();
}
syncAmbient();

const debug = process.env['BIRDSONG_DEBUG'] === '1';
node.onEvent((e) => {
  if (e.type === 'config') syncAmbient();
  else if (e.type === 'decoded') console.log(`[bird${cfg.id}] ${e.alias}: ${e.text} (hops ${e.hops})`);
  else if (debug && (e.type === 'sang' || e.type === 'heard')) console.log(`[bird${cfg.id}] ${JSON.stringify(e)}`);
});

console.log(`[bird${cfg.id}] up: audio=${cfg.audio} env=${cfg.env} profile=${cfg.profile} ui=http://localhost:${http.port}/`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  ambient?.stop();
  observatory?.close();
  await node.stop().catch((err) => console.error(err));
  await http.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
