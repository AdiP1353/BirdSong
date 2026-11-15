# Handoff: one-command demo, live flock editing, relay limit

Written 2026-11-15 for the next person or agent working on branch `adi`, with no
prior context. Read the whole file before you change anything. It records what
was built, what is committed and what is not, how it was checked, and what is
still open. Unlike `HANDOFF-011-013.md`, there are no numbered plans behind this
work. This file and the code are the record.

## Copy-paste prompt for the next agent

> You are continuing work in `/home/aprakash/Documents/projects/Durhack/BirdSong`
> on branch `adi`. Read `plans/HANDOFF-demo-flock.md` first. Rounds 1-3 are
> committed; rounds 2 and 3 are **not pushed**. **Do not push until the operator
> says so.** Then do what the operator asks, and keep the "Open items" list in
> that file up to date.

## State of the repository (check it, it may have changed)

- Branch `adi`. `main` is at `7430f18`. Commits on `adi` after `main`:
  - `94925ec` round 1, pushed to `origin/adi` (no pull request). Its `README.md` is a stale copy
    (lost round 1 docs and the "Choosing the topology" section).
  - `36252be` round 2 (add/remove birds, nursery). Also repairs `README.md` (rebuilt from `7430f18`).
    Not pushed.
  - The commit after it: round 3 (add noise, tonal carrier sense) and round 3b (Stop birds). Not pushed.
  Committed 2026-11-15 at the operator's request. Round 2 was split out of the shared working tree by
  reversing round 3's edits; that tree typechecked and passed 278 tests (1 skipped) on its own.
- The demo containers were left running with every bird stopped ("Stop birds"); `npm run demo:stop` stops them. Docker was available (`/var/run/docker.sock`, group `docker`).
- Node `v26.13.1`; `node_modules/` installed. No dependency changes in either round.

Files in round 2 (`36252be`):

```
M  README.md  docs/ARCHITECTURE.md  docs/RUNBOOK.md
M  docker/Caddyfile  docker/compose.sim.yml  scripts/demo.sh
M  packages/core/src/telemetry.ts
M  packages/dashboard/src/{app.tsx,hubClient.ts,presetMatch.ts,styles.css}
M  packages/dashboard/src/components/{BirdGrid.tsx,FlockGraph.tsx}
M  packages/dashboard/src/server/{hub.ts,interactionLog.ts,state.ts}
M  packages/dashboard/test/hub.test.ts
?? packages/dashboard/src/components/FlockEditor.tsx
?? packages/node-runtime/src/nursery.ts
?? packages/node-runtime/test/nursery.test.ts
```

## What was built

### Round 1 (committed in `94925ec`)

| Feature | Where |
|---|---|
| One command boots the demo: `bash scripts/demo.sh` (`npm run demo`); `--stop`, `--preset two-flocks\|ring\|line\|distance`, `BIRDSONG_NO_OPEN=1` | `scripts/demo.sh`, `scripts/apply-topology.ts`, `package.json` |
| Topology presets for 8 nodes, with fixed graph layouts. Default **Two flocks**: 0-3 and 4-7 fully linked, bridges 1-5, 2-6, 3-4 (3 node-disjoint paths between any two birds; node 7 is 3 hops from 0) | `packages/dashboard/src/presets.ts` (no imports, so `node` runs it directly), `presetMatch.ts`, `components/Topology.tsx`, `components/FlockGraph.tsx` |
| Dashboard always plays the ether's audio, with a live spectrogram (mute and volume were removed in round 3b). Browsers need one click first. | `packages/dashboard/src/air.ts`, `components/AirControls.tsx` (old `Listen.tsx` deleted) |
| **Turn dashboard off**: the hub drops every node socket, refuses `/node` upgrades with 503 and ignores UI commands; birds keep relaying | `server/hub.ts` (`/api/disabled`, `disabled` in snapshot and `HubToUi`), `app.tsx` |
| Birds view: every container bird's page in a small iframe (`/app/?runtime=remote&compact=1&node=…`) | `components/BirdGrid.tsx`, web `app.tsx`, `components/Flock.tsx`, `styles.css` |
| Inbox folds repeats into one row with a count, shown as "text (n)" | `packages/core/src/node/engine.ts`, `types.ts` (`InboxMessage.count`, `.suppressed`), web `components/Inbox.tsx` |
| Relay limit N: once a node has received a message more than N times, it stops relaying it (default 5, 0 = never). Dashboard control, `--relay-limit`, `relayLimit` in `/api/config`; `relay` telemetry event; graph shows "quiet · heard N×" | `engine.ts`, `types.ts` (`NodeConfig.relayLimit`), `telemetry.ts`, `node-runtime/src/config.ts`, `components/Controls.tsx`, `docs/PROTOCOL.md` §7 |

"Received" means one count per decode (including the same alias and text
arriving under a new msgId), plus one for every further `k` frames heard after
decoding. When a node sends a text itself, that row's count restarts at 0.

### Round 3 (committed after `36252be`): add noise, noise-robust carrier sense

Written 2026-11-15. Tests were written first and failed for the expected reasons before the code changed.

| Feature | Where |
|---|---|
| **Add noise panel** in the dashboard: **Microphone** or **Test room noise**, Gain -20..+40 dB, meter of noise vs a bird's song with what to expect (ok up to +10 dB, some frames lost from ~+14, most past ~+18). Mic opened with echo cancellation on, noise suppression and AGC off, resampled to 48 kHz; while the mic is the source the page's air playback uses `?noise=0` (no speaker-to-mic loop). | `dashboard/src/noise.ts`, `noiseLevel.ts` (pure helpers, tested), `components/NoisePanel.tsx`, `air.ts` (`setAirNoise`), `hubClient.ts` (`noiseSources`), `styles.css`, `app.tsx` |
| Hub WebSocket `/noise` (only with `ETHER_CONTROL_URL`): relays binary PCM to the ether's `/noise` with the control token; text `{source, level}` is logged. `noise` log kind (`{sources}`, `{source, level}`), `noise` UI message and `noiseSources` in the snapshot, `noiseEditable` in `/config.json`. | `server/hub.ts`, `server/interactionLog.ts`, `core/src/telemetry.ts` |
| Ether noise sources: `/noise` WebSocket (control token required, else close 1008), mixed at gain 1 into every node whatever the topology, and into listeners unless `?noise=0`; queue capped at 200 ms; samples clamped to +-4; `GET /noise` → `{sources}`. | `ether/src/server.ts` |
| **Carrier sense filter.** Before: busy = block power > 4x the 5 s minimum. Room noise kept every bird "busy" 85-90% of the time, so each frame waited up to 20 backoffs (~35 s). Now a block is song only if it is tonal (strongest ~230 Hz slice of the band >= 16x the median slice, from an FFT of the 20 ms block), > 1.5x the floor, and 2 of the last 3 blocks were song. Busy in room noise: 0-1.7%; frames still detected within 40 ms and covered 99-100%. | `core/src/modem/modem.ts`, `docs/PROTOCOL.md` §6 |
| **Weak sync candidates no longer hold the air.** A pending candidate counts as busy only if its score >= 0.4 (phantoms inside frames score 0.25-0.33). This was a pre-existing flake: in a 3-bird line in silence, 20-60% of runs took 30 s+ instead of 13.8 s, because the relay backed off and Trickle then suppressed it. 0 of 20 after the fix. | `modem.ts` (`STRONG_SYNC`) |
| Synthetic room noise (pink + babble from 3 talkers + 50 Hz hum + clicks), used by tests and the panel; `SimWorld.setAmbient()` adds background sound to every port. | `core/src/sim/roomNoise.ts`, `core/src/sim/world.ts` |

Probe results that set the design (decoder was already fine; carrier sense was not): decode is clean up to
+10 dB room noise for every env/profile, ~80% fixable at +14 dB, collapses past +18 dB. A steeper (8th-order)
band-pass gained almost nothing and was not kept. Loud claps (20-30x the signal) did not hurt decoding, so there
is no impulse blanker.

New tests: `core/src/modem/roomNoise.test.ts` (busy in room noise, frame detection through noise, decode at
+10 dB for every env/profile, phantom syncs, steady whistle, no phantom frames), `core/test/mesh-noise.e2e.test.ts`
(3-bird line: noise at 0 and +6 dB delivers as fast as silence, 13.8 s; a message in flight when noise starts
still arrives), ether `/noise` tests, hub relay tests, `dashboard/test/noiseLevel.test.ts`.

Checked: `npm run typecheck` clean; `npm test` 307 passed, 1 skipped; `npm run test:e2e` 11 passed, three runs
in a row. Live against the rebuilt demo: test room noise at +11 dB vs birds, a message from bird 0 reached all 7
birds in about 13 s (bird 7 at 3 hops); the hub log had the `noise` entries.
**Not verified:** the Microphone source (no microphone was used, so permission, echo cancellation and the
resampler were tested only in Node); the noise by ear.

Files in round 3:

```
M  packages/core/src/modem/modem.ts  packages/core/src/sim/{index.ts,world.ts}  packages/core/src/telemetry.ts
M  packages/ether/src/server.ts  packages/ether/test/ether.test.ts
M  packages/dashboard/src/{air.ts,app.tsx,hubClient.ts,styles.css}  packages/dashboard/src/server/{hub.ts,interactionLog.ts}
M  packages/dashboard/test/hub.test.ts  README.md  docs/{ARCHITECTURE,PROTOCOL,RUNBOOK}.md
?? packages/core/src/sim/roomNoise.ts  packages/core/src/modem/roomNoise.test.ts  packages/core/test/mesh-noise.e2e.test.ts
?? packages/dashboard/src/{noise.ts,noiseLevel.ts}  packages/dashboard/src/components/NoisePanel.tsx  packages/dashboard/test/noiseLevel.test.ts
```

(Several of these files also have round 2 changes.)

### Round 3b (same commit as round 3): Stop birds button

The operator could not silence the chirping: the header's mute button and volume slider "did not work". A
likely cause: the dashboard tab in the agent's browser pane, unlocked for sound during testing, was also playing
the air. At the operator's request the volume controls are **removed** (the air plays at a fixed 0.8, and the
saved `birdsong.dash.volume` / `birdsong.dash.muted` values are no longer read) and a **Stop birds / Start birds**
button is in the header.

- Hub: `POST /api/stopped {stopped}` / `GET`; on stop it sends `configure all {muted: true}` to every node
  socket and mutes any bird whose hello arrives while stopped (unless already muted); start sends
  `{muted: false}` to all. Refused (409) while the dashboard is off. `stopped` in the snapshot, `stopped` UI
  message and log kind. Files: `server/hub.ts`, `server/interactionLog.ts`, `core/src/telemetry.ts`,
  `hubClient.ts` (`setStopped`), `app.tsx`, `air.ts`, `components/AirControls.tsx`, `styles.css`; test in
  `dashboard/test/hub.test.ts`.
- Checked live: all 8 birds muted; one bird finished the frame it was singing (2.9 s) and nothing sang after;
  Start unmuted them. The demo was left **stopped**.
- Limits: a frame already being sung finishes (up to 9 s in stealth), because the ether has already queued it;
  Start unmutes every bird, including ones muted one by one; after a hub restart the flag is off but the birds
  stay muted until Start (or Stop then Start).

### Round 2 (`36252be`)

| Feature | Where |
|---|---|
| **Add and remove birds live.** Dashboard **Birds** panel: × per bird, tick links, then **Add bird #N** (the button reads "Tick at least one bird above" until a link is ticked in manual mode). | `components/FlockEditor.tsx`, `hubClient.ts` (`addBird`, `removeBird`) |
| Hub API `POST /api/birds {id?, links?}` and `DELETE /api/birds/<id>`. Add: next free id, nursery starts the container with the flock's env/profile/relayLimit, then in manual mode the hub appends `id-links` to the ether topology. Remove: nursery stops it, links involving it are dropped (unless that would leave no links), hub forgets it (`state.remove`, `nodeRemoved` UI message), `flock` log entries. `/config.json` gains `flockEditable`. | `server/hub.ts`, `server/state.ts`, `server/interactionLog.ts`, `core/src/telemetry.ts` |
| **Nursery** service: starts and stops bird containers through the Docker Engine API on the socket. Bearer token, no published port, only the hub calls it. New birds are containers named `birdsong-nursery-bird<id>`, labelled `birdsong.nursery=1`, with network alias `bird<id>`. Compose birds 0-7 are only **stopped**, and adding their id again **starts** the existing container. | `packages/node-runtime/src/nursery.ts`, `docker/compose.sim.yml` (`nursery` service, `NURSERY_*` env on the hub, `DOCKER_SOCKET` override) |
| Proxy: one regex route `/nodes/<id>/…` → `bird<id>:8080` (it was eight fixed routes) | `docker/Caddyfile` |
| `demo.sh` removes nursery containers on start and on `--stop` (otherwise `compose down` cannot remove the network) | `scripts/demo.sh` |
| Graph keeps its shape: the closest preset (at least 50% of links in common) pins the birds it has; an added bird starts beside its linked birds | `presetMatch.ts` (`closestPreset`), `FlockGraph.tsx` |
| Bird windows and controls follow the hub snapshot, so removed birds disappear | `BirdGrid.tsx` |

## How it was checked

- `npm run typecheck`: clean. `npm test`: **278 passed, 1 skipped** (after
  round 2). `npm run test:e2e`: **7 passed** (run after round 1; round 2 does
  not touch the engine). New tests: engine relay limit and inbox folding
  (`engine.test.ts`), hub disabled mode and add/remove with fake ether and
  nursery (`dashboard/test/hub.test.ts`), nursery against a fake Docker API
  (`node-runtime/test/nursery.test.ts`).
- Live, in a browser against the 10-container mesh:
  - Bird 7 → 4/5/6 delivery while the dashboard was off.
  - Relay limit N=1 makes birds "quiet".
  - Added bird 8 (links 0, 7): its message reached bird 5 in about 24 s, 2 hops.
  - Removed bird 2, then re-added it (links 0, 3): it went back to its preset spot.
  - Birds view showed 9 windows.
  - Proxy route works for ids 0-8, including the bare-path redirect (308).
- **Not verified:** the dashboard's sound by ear (only the spectrogram); phones;
  `sim-up.sh` after round 2; `npm run test:e2e` after round 2.

## Open items

1. **Push** rounds 2 and 3 when the operator says so (`git push origin adi`). Pushing also fixes the stale
   README on `origin/adi`.
2. **Security trade-off, documented in README §13:** the nursery mounts the
   Docker socket, which gives it full control of Docker. Anyone who can reach
   the hub on port 3200 (open on the LAN) can add birds (ids 0-127, this image
   only) or stop bird containers. Alternative if that is unacceptable: run the
   extra birds inside one nursery process instead of separate containers.
3. **Birds panel is below the fold** in the right-hand column (under Join and
   Controls). The operator first could not find it. Moving it to the top of the
   column was offered but not done.
4. Hub restart forgets which birds were removed. This is harmless: a removed
   compose bird stays stopped until re-added or until `demo.sh` runs again.
5. Relay limit: the last birds to hear a message may never reach N (everyone
   else has gone quiet), so they keep relaying until the message expires after 5 minutes.
   This is expected behaviour, and the engine test allows for it.
6. **Microphone noise not tried with a real microphone** (round 3). Try it once: allow the mic, talk and clap,
   watch the meter. If the projector speakers cause echo despite echo cancellation, use headphones.
7. The Add noise and Birds panels read `/config.json` once on load; a page opened while the hub is restarting
   does not show them until reloaded (same as before for the Birds panel).
8. No row in `plans/README.md` for this work. Add one (for example 015, 016) if
   the operator wants the plans table to stay complete.

## Gotchas

- Chrome autoplay: the dashboard's sound starts only after a click or key press on the page.
- `docker build` prints a legacy-builder deprecation warning. It is harmless.
- `presets.ts` must stay import-free: `scripts/apply-topology.ts` runs inside
  the hub container with plain `node`, which will not strip types under
  `node_modules`.
- After changing dashboard code against a running demo, the quickest refresh is
  `docker build -q -f docker/Dockerfile.node -t birdsong-node . && docker compose -f docker/compose.sim.yml up -d --no-build hub`,
  then a hard reload. That restarts only the hub; the birds keep running.
