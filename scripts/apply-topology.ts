// Set the simulated mesh's topology to a preset, through the hub (the only service allowed to change it).
// Usage: node scripts/apply-topology.ts [preset] [hub URL]   (default: two-flocks, http://localhost:3200)
import { DEFAULT_PRESET, TOPOLOGY_PRESETS } from '../packages/dashboard/src/presets.ts';

const id = process.argv[2] ?? DEFAULT_PRESET;
const hub = (process.argv[3] ?? 'http://localhost:3200').replace(/\/+$/, '');
const preset = TOPOLOGY_PRESETS.find((p) => p.id === id);
if (!preset) {
  console.error(`unknown preset "${id}"; choose one of: ${TOPOLOGY_PRESETS.map((p) => p.id).join(', ')}`);
  process.exit(2);
}
const r = await fetch(`${hub}/api/topology`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: preset.text }),
});
if (!r.ok) {
  console.error(`hub refused the topology (HTTP ${r.status}): ${await r.text()}`);
  process.exit(1);
}
console.log(`topology: ${preset.label} (${preset.id})`);
