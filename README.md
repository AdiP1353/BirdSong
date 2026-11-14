# BirdSong

BirdSong is an acoustic mesh network for people under internet shutdowns. It hides encrypted text messages (up to 140 characters) inside synthetic birdsong. Laptops and phones that hear a message decode it and sing it on, so it hops across a room with no internet, router or server. Messages are encrypted with a shared passphrase, error-corrected with Reed-Solomon and a fountain code, and sound like a jungle, a coast or a city dawn.

![The BirdSong dashboard showing a simulated flock](packages/dashboard/screenshot.png)

The screenshot was taken against the dashboard's mock flock.

## 1. What it is

Every device in the flock is a **node**. A node turns a message into a short run of bird-like chirps, plays it through its speaker, and listens through its microphone for chirps from its neighbours. A node that hears enough of a message decodes it and keeps singing it on, so messages travel hop by hop without any network. Laptops run a node in a Docker container, phones run the same node inside a web page, and a dashboard shows the whole flock for a projector. Everyone in a flock shares one passphrase, one environment and one profile.

## 2. Requirements

- **Linux** (the supported host for real laptop nodes).
- **Docker**, with the daemon running and your user allowed to use it.
- **PipeWire with the PulseAudio server (`pipewire-pulse`), or PulseAudio**, for real speakers and microphone. `scripts/run-node.sh` looks for the socket at `$XDG_RUNTIME_DIR/pulse/native`. The simulated mesh needs no audio at all.
- **Node.js 24 or newer** on the host (`engines` in `package.json`; developed on Node 26) for `npm` scripts, the dashboard hub and the CLI.
- **A browser for phones**: a current Chrome on Android. iOS Safari has not been tested (see [Known limitations](#13-known-limitations)). Phones need a page served over HTTPS (or `localhost`) so the browser allows the microphone.

## 3. Quick start: simulated mesh (no speakers needed)

This starts an 8-node mesh, a simulated air ("ether") and the dashboard, all in Docker.

Install once:

```bash
npm install
```

Build the image once. Build it before the first start: `sim-up.sh` builds ten services from the same image tag, and on a fresh build they can collide with "image already exists":

```bash
docker build -f docker/Dockerfile.node -t birdsong-node .
```

Start the mesh:

```bash
bash scripts/sim-up.sh
```

Open the dashboard at <http://localhost:3200>. If it says "reconnecting" right after startup, reload the page once. You should see 8 nodes online.

Send a message from node 0, either from its web page at <http://localhost:3100/nodes/0/> (type in the box, press **Send**) or from the command line:

```bash
curl -X POST localhost:3100/nodes/0/api/send -H 'Content-Type: application/json' -d '{"text":"hello flock"}'
```

Watch it spread: on the dashboard the nodes pulse, links light up between neighbours, each node's ring fills as it collects the message, and the Messages panel lists who has decoded it and after how many hops. Node 7 is at least three hops from node 0; in our test a short message reached it in about 25 seconds. Check it there:

```bash
curl -s localhost:3100/nodes/7/api/state
```

Kill two nodes: press **Kill 2 random relays** on the dashboard (or **Mute** on any node in the Controls panel). The remaining nodes keep relaying, so the message can still reach the others (the "two relays killed" case is covered by an end-to-end test).

Stop the mesh:

```bash
docker compose -f docker/compose.sim.yml down
```

The mesh publishes two ports on your machine. **3200** is the hub: the dashboard, the node app at `/app/`, and the interaction log at `/api/log` (also written to `logs/interactions.ndjson`). **3100** is a proxy: `/nodes/<id>/` reaches node `<id>` and `/ether/listen` reaches the simulated air. The nodes and the ether have no ports of their own.

### Choosing the topology

By default, nodes in the simulated mesh hear each other by distance (`ETHER_RANGE`, with the 4 x 2 grid from `docker/compose.sim.yml`). To state the links yourself, list them in [docker/topology.txt](docker/topology.txt):

```
0-1,2     # two-way links 0<->1 and 0<->2
1-3
4>5       # one-way link: 5 hears 4, 4 does not hear 5
```

When the file lists at least one link, sound travels only along the listed links (at the same loudness as two neighbours 1 unit apart), and positions and range are ignored. When the file is empty or has only comments, the nodes hear by distance. The ether reads the file at startup (`docker compose -f docker/compose.sim.yml restart ether` reloads it).

To change the topology while the mesh runs, use the dashboard's **Topology** panel. The hub is the only service that can change it: it holds the ether's control token (`ETHER_CONTROL_TOKEN`), and the proxy does not forward `/ether/topology`. If the hub is stopped, the mesh keeps the topology it has. When the ether restarts, it goes back to the file. Without Docker, set `ETHER_TOPOLOGY='0-1,2'` (inline) or `ETHER_TOPOLOGY_FILE=<path>` on `packages/ether/src/server.ts`. The topology applies only to the simulated air. Real laptops can use `--neighbors` to ignore senders.

If Docker is not available, `bash scripts/smoke-ether.sh` runs a two-node version natively (about 8 seconds) and checks that a message arrives.

## 4. Run a real node on a laptop

Build the image once:

```bash
docker build -f docker/Dockerfile.node -t birdsong-node .
```

Run a node. Give each laptop its own id from 0 to 127 (phones choose 128 to 255 themselves):

```bash
BIRDSONG_ID=1 bash scripts/run-node.sh --key my-secret-phrase --env jungle --profile stealth --volume 0.8
```

`scripts/run-node.sh` runs the image with the host network and your PipeWire/PulseAudio socket, and passes every argument to the node. Every flag also has an environment variable (`BIRDSONG_<NAME>`). The key ones:

| Flag | Environment variable | Meaning |
|---|---|---|
| `--id <0..255>` | `BIRDSONG_ID` | Node id. Use 0 to 127 on laptops. Default: random. |
| `--key <text>` | `BIRDSONG_KEY` | The shared passphrase. Required. |
| `--alias <text>` | `BIRDSONG_ALIAS` | Display name (default `bird<id>`). |
| `--env <name>` | `BIRDSONG_ENV` | `quiet`, `jungle`, `coast` or `city` (default `quiet`). |
| `--profile <name>` | `BIRDSONG_PROFILE` | `stealth` or `fast` (default: the environment's default). |
| `--volume <0..1>` | `BIRDSONG_VOLUME` | Output gain (default 0.8). |
| `--observatory <url>` | `BIRDSONG_OBSERVATORY` | Dashboard hub, for example `ws://192.168.1.10:3200`. Shows the node on the dashboard. |
| `--port <n>` | `BIRDSONG_PORT` | Port of the node's web page and API (default 8080). |
| `--camouflage` | `BIRDSONG_CAMOUFLAGE` | Play the ambient bed of the environment. |
| `--neighbors <ids>` | `BIRDSONG_NEIGHBORS` | Only accept frames from these sender ids, for example `1,3`. |

The full list is printed by:

```bash
docker run --rm birdsong-node --help
```

Every node in a flock must use the same `--key`, `--env` and `--profile`. The node's own page is then at <http://localhost:8080>.

Optional: put the node on the dashboard. On one laptop (after `npm install`), build and start the hub, then add `--observatory ws://<HUB_IP>:3200` to each `run-node.sh` command (use `ws://localhost:3200` on the hub laptop). `PWA_URL` is the address of the phone app that goes into the dashboard's QR code, see [section 5](#5-join-with-a-phone).

```bash
npm run build -w @birdsong/dashboard
```

The hub also serves the node app at `/app/`, so build that too:

```bash
npm run build -w @birdsong/web
```

```bash
CHANNEL_PASSPHRASE=my-secret-phrase PWA_URL=<PAGES_URL> npm start -w @birdsong/dashboard
```

### Check the speaker and microphone from inside the container

The container reaches your audio through the same PulseAudio socket. This should print `Server Name: PulseAudio (on PipeWire ...)`:

```bash
docker run --rm --user "$(id -u):$(id -g)" -e PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native" -v "${XDG_RUNTIME_DIR}/pulse/native:${XDG_RUNTIME_DIR}/pulse/native" -e HOME=/tmp --entrypoint pactl birdsong-node info
```

List the speakers (sinks) and microphones (sources) the container can see; the default ones are marked in the full `info` output:

```bash
docker run --rm --user "$(id -u):$(id -g)" -e PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native" -v "${XDG_RUNTIME_DIR}/pulse/native:${XDG_RUNTIME_DIR}/pulse/native" -e HOME=/tmp --entrypoint pactl birdsong-node list short sinks
```

```bash
docker run --rm --user "$(id -u):$(id -g)" -e PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native" -v "${XDG_RUNTIME_DIR}/pulse/native:${XDG_RUNTIME_DIR}/pulse/native" -e HOME=/tmp --entrypoint pactl birdsong-node list short sources
```

To hear the speaker, play one of the sample WAVs through the container (needs speakers/mic):

```bash
docker run --rm --user "$(id -u):$(id -g)" -e PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native" -v "${XDG_RUNTIME_DIR}/pulse/native:${XDG_RUNTIME_DIR}/pulse/native" -e HOME=/tmp -v "$PWD/samples:/samples:ro" --entrypoint paplay birdsong-node /samples/ambient-jungle.wav
```

To test the microphone, record three seconds to `/tmp/mic-test.wav`, then play it with any player (needs speakers/mic):

```bash
docker run --rm --user "$(id -u):$(id -g)" -e PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native" -v "${XDG_RUNTIME_DIR}/pulse/native:${XDG_RUNTIME_DIR}/pulse/native" -e HOME=/tmp -v /tmp:/out --entrypoint timeout birdsong-node -s INT 3 parecord --channels=1 --rate=48000 --file-format=wav /out/mic-test.wav
```

If `run-node.sh` cannot find the socket it tells you to run `systemctl --user enable --now pipewire-pulse.socket pipewire-pulse.service`. If the node cannot reach a PulseAudio server it exits with code 3.

## 5. Join with a phone

A phone joins as a full node, running the web app in the browser; it is not a remote control. The app is a static page built from `packages/web`, deployed to GitHub Pages by `.github/workflows/pages.yml`. In the commands below `<PAGES_URL>` is wherever you host it (the address Pages gives you after you set it up).

**The join link** has this format; the passphrase, environment and profile live in the part after `#`, so they are never sent to a server:

```text
<PAGES_URL>#k=<passphrase>&env=<quiet|jungle|coast|city>&p=<stealth|fast>
```

The dashboard's **Join the flock** panel shows the link as a QR code (built from `PWA_URL`, the hub's passphrase and the flock's current environment and profile). Scan it with the phone camera. The page reads the values, removes them from the address bar, and shows the Join screen with the fields filled in: Passphrase, Environment, Profile and Alias (up to 8 characters).

**Press "Join the flock".** This asks the browser for the microphone, starts the node in the page, and the phone begins listening for, relaying and singing messages. Phones pick a random id from 128 to 255 (and remember it). You then get a box ("Type a message to sing") with **Send**, an Inbox, the messages in flight, a spectrogram, a **Camouflage (play ambient bed)** checkbox, **Song tools**, and a Settings panel (environment, profile, volume) plus a Mute button.

**Keep the screen on and the page in the foreground.** The page asks the browser to keep the screen awake (and asks again when you come back to the tab), but browsers stop microphones and audio in background tabs and when the phone locks. Leave the tab open and the screen on, with the volume up.

**If the microphone is blocked**, the page shows "Microphone access was denied". Tap the lock icon in the address bar, allow the microphone for the site, then tap **Join the flock** again. Without HTTPS the browser will not offer the microphone at all, so use the Pages address (or `http://localhost` on a desktop).

To try the phone app on your own machine, `npm run dev -w @birdsong/web` serves it with Vite at <http://localhost:5173/> (the address is printed in the terminal); `localhost` counts as secure, so a desktop browser can join there.

## 6. Using a node

### The local web page

Every container node serves its own page. Open <http://localhost:8080/?runtime=remote> (plain `http://localhost:8080/` redirects there; use the node's `--port` if you changed it). It shows the node's id and species, the environment and profile, a **Mute**/**Unmute** button, the Send box, the Inbox, messages in flight and a Settings panel (environment, profile, volume). The `?runtime=remote` part makes the page control the container node. Without it, the same page starts a phone-style node in your browser.

In the simulated mesh, node N's page is <http://localhost:3100/nodes/N/>; the dashboard's **Node pages** panel links to each one.

### The command line

The CLI talks to a node's HTTP API (port 8080, or the port in `BIRDSONG_PORT`; `BIRDSONG_URL` overrides `BIRDSONG_PORT` with a full base URL). Run it from the repository:

```bash
node packages/node-runtime/src/cli.ts send "meet at the bridge"
```

```bash
node packages/node-runtime/src/cli.ts inbox
```

```bash
node packages/node-runtime/src/cli.ts state
```

```bash
node packages/node-runtime/src/cli.ts config volume=0.5 muted=true
```

`config` takes `key=value` pairs for `env`, `profile`, `volume`, `muted`, `camouflage` and `neighbors` (for example `neighbors=[1,3]`, or `neighbors=null` to hear everyone). To reach another node, set its base URL (here node 1 of the simulated mesh):

```bash
BIRDSONG_URL=http://localhost:3100/nodes/1 node packages/node-runtime/src/cli.ts inbox
```

### The HTTP API

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/state` | none | The node state: id, species, config, messages in flight (with rank), and the inbox. |
| `POST /api/send` | `{"text": "..."}` (max 140 characters) | `{"msgId": <number>}`. HTTP 400 with `{"error": "..."}` if the text is refused. |
| `POST /api/config` | A JSON object with any of `env`, `profile`, `volume`, `muted`, `neighbors`, `camouflage` | The new node state. HTTP 400 if the body is not a JSON object or a value is refused (numbers such as `volume` are clamped to their range). |
| `GET /api/events` (WebSocket) | none | A stream of the node's events as JSON (heard, decoded, sang, and so on). |

All API responses allow cross-origin requests.

## 7. The dashboard

Start it with `bash scripts/sim-up.sh` (simulated mesh) or by running the hub yourself, as in [section 4](#4-run-a-real-node-on-a-laptop). It is at <http://localhost:3200> and is meant for a projector.

- **Header:** counters for nodes online, frames heard, CRC failures (frames that arrived damaged beyond repair, or were not frames) and messages delivered.
- **Flock graph:** one circle per node, coloured by species, with phones drawn dashed. Links between nodes light up when one hears the other, rings pulse when a node sings, and a progress ring fills as a node collects a message. Muted or offline nodes fade.
- **Score:** a live piano-roll of the notes being sung, in the current environment's key.
- **Controls:** **Environment** and **Profile** menus and a **Camouflage** checkbox apply to every node at once. **Kill 2 random relays** mutes two random online laptop nodes (never phones, and never the node that wrote the message you have selected). Below that, every node has its own **Mute**/**Unmute** button and a volume slider; phones are listed as "phone" and cannot be controlled.
- **Messages:** each decoded message with its author and the nodes that decoded it (`#node (hops)`, plus the seconds since the first decode). Click a message to follow it in the graph.
- **Join the flock:** the QR code and link for phones, see [section 5](#5-join-with-a-phone).
- **Node pages:** only for the simulated mesh. A link to each online container node's page (served by the hub at `/app/`, talking to the node through the proxy).
- **Interaction log:** the hub records every node event, every dashboard command and every node disconnect. `GET /api/log?since=<seq>&limit=<n>` returns `{ entries, next }`; each entry is `{ seq, t, kind: event|command|offline|topology, data }`. With `HUB_LOG_FILE` set (the simulated mesh uses `logs/interactions.ndjson`) it is also written as one JSON object per line, and the file rotates to `.1` at 10 MiB.
- **Topology:** only for the simulated mesh (shown when the hub has `ETHER_CONTROL_URL`). It shows whether the ether is in distance or manual mode, and the current links in the format of [section 3](#choosing-the-topology). Edit the text and press **Apply**, or press **Use distance** to go back to distance mode. Every open dashboard updates, and the change goes in the interaction log as a `topology` entry.
- **Listen to the simulated air:** only for the simulated mesh. It plays what the ether carries through the page's speakers, so a projector can play the flock. Press again ("Stop listening") to stop. In our check the button toggled and the page stayed connected; we could not hear the audio output.

The dashboard sees phones only indirectly: they send no telemetry, so the hub infers a phone when a laptop hears a frame from a sender id it does not know.

## 8. Environments and profiles

An **environment** picks the notes (pitch range) and the matching ambient sound for camouflage. A **profile** picks how fast the chirps are. Nodes only understand each other when both settings match.

| Environment | Receiver band | Ambient bed (camouflage) | Default profile |
|---|---|---|---|
| `quiet` (Quiet room, C major) | 1884 - 5476 Hz | none | `fast` |
| `jungle` (A major pentatonic) | 1996 - 7744 Hz | rain and insects | `stealth` |
| `coast` (D mixolydian) | 1057 - 3073 Hz | surf and gulls | `stealth` |
| `city` (E minor pentatonic) | 1778 - 6899 Hz | traffic rumble | `fast` |

| Profile | Speed | Airtime per frame | Symbols per frame |
|---|---|---|---|
| `stealth` | Slow, 4 bits per chirp: 90 ms chirps with a pause every 8, it sounds like birdsong | 8.91 s (8910 ms) | 64 |
| `fast` | About three times quicker, 5 bits per chirp: 40 ms chirps with no pauses | 3.01 s (3010 ms) | 52 |

A message of 140 characters needs 7 to 8 frames from its writer: roughly 1 minute in `stealth` and 21 to 24 seconds in `fast`, per hop. Details and measurements are in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## 9. Message songs

A message can also be saved as an audio file and decoded from one.

- **Save a message as a WAV:** in the phone app (or any browser node you started yourself, not the container page), press **Save last message as song**. It downloads `birdsong-<msgId>.wav`, the last message you wrote, sung in the current environment and profile.
- **Play it from any device:** it is an ordinary WAV, so any player works. It contains the whole message (a few more frames than strictly needed, so a lost frame does not matter).
- **Decode a WAV:** in the same app, **Decode a song file** takes a WAV. It decodes it with the node's passphrase, environment and profile, and lists the messages it finds, or "No messages found." (wrong passphrase, wrong environment or profile, or not a message).

To hear examples, the repository ships `samples/` (message songs for every environment and profile, and the ambient beds). They use the passphrase `demo-flock` and the text "Meet at the old bridge at 6". Regenerate them with:

```bash
node scripts/render-samples.ts
```

## 10. Running a demo

A short checklist; [docs/RUNBOOK.md](docs/RUNBOOK.md) has the full 3-minute script, the physical layout and the fallbacks.

1. Charge and plug in the laptops; build the image on each (`docker build -f docker/Dockerfile.node -t birdsong-node .`).
2. Pick the passphrase, environment and profile; every device must use the same ones.
3. Start the hub on the projector laptop, then one `run-node.sh` per laptop with its own id (0 to 127) and `--observatory`.
4. Check the dashboard shows every laptop as online.
5. Scan the QR code with the phones, press **Join the flock** and keep their screens on.
6. Send a message from one node, watch it spread, mute a node mid-way.
7. If the room is too loud or the audio fails, use the fallback: `bash scripts/sim-up.sh` and press "Listen to the simulated air".

## 11. Troubleshooting

**No audio in Docker.** Run the `pactl info` check from [section 4](#4-run-a-real-node-on-a-laptop). If the socket `$XDG_RUNTIME_DIR/pulse/native` is missing, enable the PulseAudio server with `systemctl --user enable --now pipewire-pulse.socket pipewire-pulse.service`. Use `scripts/run-node.sh` rather than a bare `docker run`: it mounts the socket and runs the container as your user. Set `BIRDSONG_DEBUG=1` to log every frame a node hears and sings.

**Docker says "permission denied".** Your user needs access to the Docker socket (membership of the `docker` group, then log in again).

**Messages are not arriving.**

- Volume: raise `--volume` on the singer and put the laptops close together; speakers that are too quiet or too loud and distorted both fail.
- Distance: sound only reaches nearby nodes, and a hop over a long gap may need a relay in between. The singer cannot be heard by a node out of earshot.
- Wrong passphrase, environment or profile: a node with a different passphrase cannot read the message, and a different environment or profile cannot even hear it. Check that every node shows the same environment and profile (dashboard Controls, or `node packages/node-runtime/src/cli.ts state`).
- Be patient: a hop takes about a minute in `stealth`. Frames sung at the same time collide.
- Room noise: switch everything to `fast` and raise the volume, or move away from loud sources.

**A phone is silent (iOS).** iOS Safari has not been tested here. The page may be routing the sound to the earpiece, or iOS may mute web audio when the silent switch is on or when the page is in the background. Turn off silent mode, raise the media volume, keep the page open and in front. If a phone still will not join, use a laptop node's page at <http://localhost:8080/?runtime=remote> instead.

**The dashboard shows no nodes.**

- Right after startup it can say "reconnecting": reload the page once.
- Real nodes appear only if they were started with `--observatory ws://<HUB_IP>:3200` (and the hub is reachable from the laptop on that port). Phones never appear by themselves.
- If the page is not at <http://localhost:3200>, check the hub is running (`npm start -w @birdsong/dashboard`) and that you built the page first (`npm run build -w @birdsong/dashboard`).
- The QR shows `http://localhost:3200/app/` if `PWA_URL` is not set. That address works only in a browser on the hub machine, because phones need HTTPS for the microphone. Set `PWA_URL` to the HTTPS Pages address of the phone app.

## 12. Development

```bash
npm install
```

```bash
npm run typecheck
```

Unit and component tests:

```bash
npm test
```

Mesh end-to-end tests (the simulated mesh, with a fake modem and a real-modem case):

```bash
npm run test:e2e
```

Run one test file with `npx vitest run <path>`. The source-code rules (relative imports end in `.ts`, `import type`, no enums), the test pyramid and the package layout are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The protocol is in [docs/PROTOCOL.md](docs/PROTOCOL.md), demo-day material in [docs/RUNBOOK.md](docs/RUNBOOK.md), [docs/DEVPOST.md](docs/DEVPOST.md) and [docs/PITCH.md](docs/PITCH.md). The implementation plans, their status and the measured numbers are in `plans/` (`plans/README.md`).

## 13. Known limitations

From [docs/PROTOCOL.md](docs/PROTOCOL.md) section 9 and the notes in `plans/README.md`:

- **Slow.** One frame takes 8.9 s (`stealth`) or 3.0 s (`fast`) and a 140-character message needs 7 to 8 of them per hop. There are no acknowledgements; frames from several singers at once collide.
- **Not tested in a real room.** All automated tests run against the simulated air or synthetic noise and reverb. Real-room tuning of volume and sync threshold, real speakers and microphones, and the two-browser-tab acoustic test have not been run.
- **Not tested on real phones.** Android Chrome and iOS Safari have not been tried; iOS audio routing (earpiece, silent switch) is unverified. The "Listen to the simulated air" button toggled correctly against the live simulated mesh, but nobody has listened to its audio.
- **arm64 image not built.** The Docker image workflow builds `linux/amd64` and `linux/arm64`, but the arm64 build has not been run (the `docker buildx` plugin was not installed when it was checked).
- **Short nonce.** A 4-byte random nonce with one key: after tens of thousands of messages on one passphrase the IV can repeat, which breaks AES-GCM for those messages.
- **Shared passphrase.** One key per channel. Anyone with the passphrase can read and forge messages, and a replay after the 5-minute expiry is accepted again. There is no forward secrecy.
- **Metadata is in clear.** The channel tag, message id, sender id and hop count are sent unencrypted in every frame.
- **Small ids.** The message id is 16 bits (two live messages can collide) and the channel tag is 8 bits (a different channel matches by chance 1 time in 256).
- **Occasional false frames.** The receiver sometimes reports extra frames (for example in reverb tails); error correction and the CRC discard them.
- **Message size.** At most 240 bytes after compression, so a 140-character text that compresses badly can be refused.
- **`sim-up.sh` on a fresh build.** It builds ten services from one image tag in parallel (plus the `caddy:2` proxy image, which is pulled), which can fail with "image already exists". Run `docker build -f docker/Dockerfile.node -t birdsong-node .` first (then the build is a cache hit).
- **Dashboard.** Phones do not send telemetry, so they appear only when a laptop hears them. A page opened right after startup may need one reload. The default `PWA_URL` is the hub's own `/app/` (`http://localhost:3200/app/`). It works only on the hub machine, because phones need HTTPS for the microphone, so set `PWA_URL` to the HTTPS Pages address for real phones.
- **No AI.** Compression is a static dictionary (Unishox2); there is no language model in the project.
