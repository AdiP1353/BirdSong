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

This starts an 8-node mesh, a simulated air ("ether") and the dashboard, all in Docker. One command does everything: it builds the image, starts the mesh, sets the **Two flocks** topology and opens the dashboard. It needs only Docker:

```bash
bash scripts/demo.sh
```

(`npm run demo` does the same.) Run it again at any time to rebuild and restart; that also removes any birds you added. Add `--preset ring`, `--preset line` or `--preset distance` for another topology, and set `BIRDSONG_NO_OPEN=1` to skip opening the browser. Stop the demo with:

```bash
bash scripts/demo.sh --stop
```

The older `bash scripts/sim-up.sh` still starts the mesh without a topology preset (build the image first, see [Known limitations](#13-known-limitations)).

Open the dashboard at <http://localhost:3200>. If it says "reconnecting" right after startup, reload the page once. You should see 8 nodes online. The chirps play through the page's speakers all the time; browsers start sound only after you click the page once, so click anywhere if the header says "click anywhere for sound". Use the speaker button and slider in the header to mute or change the volume.

Send a message from node 0, either from its web page at <http://localhost:3100/nodes/0/> (type in the box, press **Send**) or from the command line:

```bash
curl -X POST localhost:3100/nodes/0/api/send -H 'Content-Type: application/json' -d '{"text":"hello flock"}'
```

Watch it spread: on the dashboard the nodes pulse, links light up between neighbours, each node's ring fills as it collects the message, and the Messages panel lists who has decoded it and after how many hops. Press **Birds** in the header to see every bird's own page in a small window, side by side. In the Two flocks topology node 7 is three hops from node 0; in our test a short message reached it in about 25 seconds. Check it there:

```bash
curl -s localhost:3100/nodes/7/api/state
```

Kill two nodes: press **Kill 2 random relays** on the dashboard (or **Mute** on any node in the Controls panel). The remaining nodes keep relaying, so the message can still reach the others (the "two relays killed" case is covered by an end-to-end test). In Two flocks every pair of nodes is joined by three separate paths, so any two dead relays leave the flock connected.

Add and remove birds: the dashboard's **Birds** panel lists every bird with a **×** to remove it, and an **Add bird #N** button. Removing a bird stops its container (birds 0 to 7 are only stopped, so the demo command brings them back) and drops its links from the topology; it disappears from the graph, the bird windows and the controls. Adding a bird starts a new container with the next free id and the flock's current environment, profile and relay limit. In manual topology mode you first tick the birds it hears and is heard by, and those two-way links are added to the topology; in distance mode it joins at grid spot (id mod 4, id div 4). Adding a removed id (such as 2) restarts that bird's container. The graph keeps the preset's shape and places a new bird beside the birds it is linked to. From the command line:

```bash
curl -X POST localhost:3200/api/birds -H 'content-type: application/json' -d '{"links":[7,0]}'
```

```bash
curl -X DELETE localhost:3200/api/birds/8
```

Show that the flock does not need the dashboard: press **✂ Cut the internet**. The hub drops every bird and refuses them until you turn it back on, so it can neither see nor control them. The page switches to the bird windows (which talk to the birds through the proxy, not the hub) and keeps playing the air with a live spectrogram. Send a message from any bird window and watch it reach the others. Press **Turn dashboard back on** and the birds reconnect; the events they queued while it was off (up to 200 each) appear on the dashboard.

Stop the mesh with `bash scripts/demo.sh --stop`. If you started it with `sim-up.sh` and added no birds, this also works:

```bash
docker compose -f docker/compose.sim.yml down
```

The mesh publishes three ports on your machine (the nursery, which adds and removes birds, has none). **3200** is the hub: the dashboard, the node app at `/app/`, and the interaction log at `/api/log` (also written to `logs/interactions.ndjson`). **3100** is a proxy: `/nodes/<id>/` reaches node `<id>` (any id, so added birds work too) and `/ether/listen` reaches the simulated air. **3443** is the same proxy serving the hub over HTTPS for phones (the dashboard's QR code points there, see [section 5](#5-join-with-a-phone)). The nodes and the ether have no ports of their own.

### Choosing the topology

By default, nodes in the simulated mesh hear each other by distance (`ETHER_RANGE`, with the 4 x 2 grid from `docker/compose.sim.yml`). To state the links yourself, list them in [docker/topology.txt](docker/topology.txt):

```
0-1,2     # two-way links 0<->1 and 0<->2
1-3
4>5       # one-way link: 5 hears 4, 4 does not hear 5
```

When the file lists at least one link, sound travels only along the listed links (at the same loudness as two neighbours 1 unit apart), and positions and range are ignored. When the file is empty or has only comments, the nodes hear by distance. The ether reads the file at startup (`docker compose -f docker/compose.sim.yml restart ether` reloads it).

To change the topology while the mesh runs, use the dashboard's **Topology** panel. It has three presets for the 8 nodes: **Two flocks** (0-3 and 4-7, each group fully linked, joined by the bridges 1-5, 2-6 and 3-4), **Ring** and **Line**; the graph draws a preset in its own fixed shape. From the command line, `node scripts/apply-topology.ts <two-flocks|ring|line>` sets one through the hub. The hub is the only service that can change it: it holds the ether's control token (`ETHER_CONTROL_TOKEN`), and the proxy does not forward `/ether/topology`. If the hub is stopped, the mesh keeps the topology it has. When the ether restarts, it goes back to the file. Without Docker, set `ETHER_TOPOLOGY='0-1,2'` (inline) or `ETHER_TOPOLOGY_FILE=<path>` on `packages/ether/src/server.ts`. The topology applies only to the simulated air. Real laptops can use `--neighbors` to ignore senders.

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
| `--relay-limit <n>` | `BIRDSONG_RELAY_LIMIT` | Stop relaying a message once it has been received more than `n` times. `0` = never stop. Default 5. |

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

The dashboard's **Scan to become a bird** panel shows the link as a QR code (built from `PWA_URL`, the hub's passphrase and the flock's current environment and profile). Scan it with the phone camera. The page reads the values and removes them from the address bar. It shows one button, **🎤 Turn on the microphone**, and an optional name (up to 8 characters); the flock settings (passphrase, environment, profile) are filled in and folded away. A link without them opens the settings for typing.

**In the simulated mesh** (`bash scripts/demo.sh`) the phone app comes from the laptop itself: the script finds this computer's LAN address and sets `PWA_URL=https://<LAN IP>:3443/app/`, where the proxy serves the hub over HTTPS with a certificate from Caddy's own CA. The phone must be on the same Wi-Fi. It shows a certificate warning the first time: tap **Advanced**, then **Proceed** (Safari: **Show Details**, **visit this website**). Caddy keeps its CA in the `caddy-data` volume, so the warning does not come back after a restart. The dashboard plays the simulated air through the laptop's speakers, so the phone hears the birds as real sound: send from any bird and the phone decodes the message, puts it in its Inbox and sings it on.

**Press "Turn on the microphone".** This asks the browser for the microphone, starts the node in the page, and the phone begins listening for, relaying and singing messages. Phones pick a random id from 128 to 255 (and remember it). You then get a message box with **🎤 Speak your message** and **Send**, an Inbox, the messages in flight, a spectrogram, a **Camouflage (play ambient bed)** checkbox, **Song tools**, and a Settings panel (environment, profile, volume) plus a Mute button. A message you send is sung by the phone itself, like any other bird.

**The phone is on the dashboard.** A phone app served by a hub (as in the simulated mesh) connects to the hub's `/node` socket once its microphone is on, exactly like a laptop bird with `--observatory`: it says hello with its id and name, sends its events (heard, decoded, singing, ...) and obeys the dashboard's commands (Stop birds, Environment, Profile). The graph draws it dashed, in a corner, with its name, and the travelling glow shows it hearing every bird and every bird hearing it. Only events travel this way; messages still go only as sound.

**The birds hear the phone through the laptop's microphone.** The container birds hear only the simulated air, so the dashboard carries the room into it: when a phone joins, the dashboard turns on **Hear phones** by itself (after the page has had a click; the browser asks once for the microphone), which feeds this computer's microphone into the air every bird hears. The QR panel says whether it is on and has a button for it; switching it off by hand keeps it off on that computer. Because the same speakers play the birds, the microphone would send every bird's song back in a moment later, so an echo gate mutes it while the page plays a bird and for half a second after. A phone sings only when the air is quiet (carrier sense), so its songs pass. Keep the phone near the laptop, and raise **Gain** in Add noise if the meter shows the phones far below a bird.

**Speak your message** records with the same microphone. While it records, the node does not listen for chirps (the button reads "■ Done speaking" and the page says "Not listening for birds while you speak"); it goes back to listening when you press it again, or after 30 seconds. The recording goes to the hub that served the page (`POST /api/transcribe`), which sends it to ElevenLabs and puts the words in the message box for you to check and send. It needs an ElevenLabs key on the hub, see [section 7](#7-the-dashboard); without one the button is hidden, and pages not served by a hub (such as GitHub Pages) never show it.

**Keep the screen on and the page in the foreground.** The page asks the browser to keep the screen awake (and asks again when you come back to the tab), but browsers stop microphones and audio in background tabs and when the phone locks. Leave the tab open and the screen on, with the volume up.

**If the microphone is blocked**, the page shows "Microphone access was denied". Tap the lock icon in the address bar, allow the microphone for the site, then tap **Turn on the microphone** again. Without HTTPS the browser will not offer the microphone at all, so use the HTTPS address from the QR code (or `http://localhost` on a desktop); the page says so instead of offering the button.

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
| `POST /api/config` | A JSON object with any of `env`, `profile`, `volume`, `muted`, `neighbors`, `camouflage`, `relayLimit` | The new node state. HTTP 400 if the body is not a JSON object or a value is refused (numbers such as `volume` are clamped to their range). |
| `GET /api/events` (WebSocket) | none | A stream of the node's events as JSON (heard, decoded, sang, and so on). |

All API responses allow cross-origin requests.

## 7. The dashboard

Start it with `bash scripts/demo.sh` (simulated mesh) or by running the hub yourself, as in [section 4](#4-run-a-real-node-on-a-laptop). It is at <http://localhost:3200> and is meant for a projector.

- **Header:** counters for nodes online, frames heard, CRC failures (frames that arrived damaged beyond repair, or were not frames) and messages delivered. Then the **Graph**/**Birds** view switch, a small live spectrogram of the simulated air (the page plays the air at a fixed volume once you click anywhere; only for the simulated mesh), **Stop birds**, and **✂ Cut the internet**.
- **Stop birds:** mutes every bird, so they stop singing (and listening) and the air goes quiet. A frame already being sung finishes first (up to 3 s with `fast`, 9 s with `stealth`). Birds that connect or are added while it is on are muted as soon as they say hello. **Start birds** unmutes every bird, including any you had muted one by one, and they carry on with the messages still in flight (those expire 5 minutes after they were first heard). The hub's `POST /api/stopped` (`{"stopped": true|false}`; `GET` reads it) does the same and goes in the interaction log as a `stopped` entry. It is refused while the dashboard is off, because the hub cannot reach the birds then.
- **Birds view:** every container bird's own page in a small window (`/app/?runtime=remote&compact=1`), four to a row. Each window has the bird's Mute button, a send box, its Inbox and its messages in flight; ↗ opens the full page. `http://localhost:3200/?view=birds` opens the dashboard in this view.
- **✂ Cut the internet** (the dashboard's off switch): the page goes dark with a blinking NETWORK DOWN, and the hub closes every node connection and refuses new ones (`POST /api/disabled` with `{"disabled": true}`; `GET` reads it), drops dashboard commands, and every open dashboard shows the bird windows and the air instead of the graph. The birds keep singing and relaying. **⏻ Restore the network** lets them reconnect.
- **Flock graph:** one circle per node, coloured by species, with phones drawn dashed. Rings pulse while a node sings and a progress ring fills as it collects a message; muted or offline nodes fade. **Travelling glow:** while a bird sings a frame, a glowing dot (one colour per message) leaves it along every link and arrives as the frame ends. The selected message also leaves a glowing trail (each bird joined to the bird it first heard the message from) and a hop count on every bird that has read it. **Shoot a bird:** tap a bird to mute it (a red cross; tap again to revive it) and watch the message go around it. **Draw the network:** drag from one bird to another to link them two-way, or to unlink them if they are linked; it edits the same topology as the Topology panel (in distance mode it starts from the links seen lately; the last link cannot be removed).
- **Score / Air:** the lower-left panel. **Score** is a live piano-roll of the notes being sung. **Air** is a large spectrogram of the simulated air with the camouflage trick: **Hide the chirps in the jungle** switches every bird to camouflage (and to the Jungle environment if the current one has no ambience) and plays that ambience under the chirps on this page; **Reveal the chirps** then paints the birds' own sound yellow over a dimmed background.
- **Scan to become a bird:** the QR panel. One QR code, for the phone app with the flock's passphrase, environment and profile (see [section 5](#5-join-with-a-phone)). The phone turns on its microphone and becomes a bird: it hears the laptop's speakers, decodes and relays, and its owner can speak or type a message that the phone sings. In the simulated mesh the address is `https://<this computer>:3443/app/` (`scripts/demo.sh` sets `PWA_URL`); the panel warns when the address is `localhost` or plain `http`, which a phone cannot use for the microphone.
- **Speech to text (optional):** the phone's 🎤 button records the person's voice, and ElevenLabs turns it into text that fills the message box. They can fix it before sending. It is off until you give the hub a key:
  ```bash
  cp .env.example .env     # then open .env and paste your key after ELEVENLABS_API_KEY=
  # (or keep the key in .env.local, which the ElevenLabs CLI writes; demo.sh reads both)
  npm run demo             # demo.sh reads .env and passes the key to the hub
  ```
  `.env` and `.env.local` are ignored by git and kept out of the Docker image. The key stays in the hub: phones post audio to `POST /api/transcribe` and never see it. The hub asks for words only (`tag_audio_events=false`), so the birds in the background do not turn up as "[birds chirping]". Without Docker, run the hub with `ELEVENLABS_API_KEY=... node packages/dashboard/src/server/hub.ts`. **This is the one step that needs the internet**, and it happens *before* a message is sent. It is only a convenience for typing; the bird part still needs no network, so do not use it during the "airplane mode" part of the demo. The audio and the words go to ElevenLabs, so tell people before they use it.
- **Spy view:** what an eavesdropper with a microphone and no passphrase gets from the selected message: the frames it caught (sender ids are in clear), the encrypted bytes as scrambled text, and the result of trying a passphrase you type (only the right one opens it). Beside it, the text as the birds with the key read it.
- **Controls:** **Environment** and **Profile** menus and a **Camouflage** checkbox apply to every node at once. **Stop relaying after N receptions** sets every node's relay limit (press Enter or leave the box): a bird that has received a message more than N times stops singing it, and the graph marks it "quiet · heard N×" for the selected message. 0 means never stop. **Kill 2 random relays** mutes two random online laptop nodes (never phones, and never the node that wrote the message you have selected). Below that, every node has its own **Mute**/**Unmute** button and a volume slider; phones are listed as "phone" and cannot be controlled.
- **Messages:** each decoded message with its author and the nodes that decoded it (`#node (hops)`, plus the seconds since the first decode). Click a message to follow it in the graph.
- **Node pages:** only for the simulated mesh. A link to each online container node's page (served by the hub at `/app/`, talking to the node through the proxy).
- **Interaction log:** the hub records every node event, every dashboard command and every node disconnect. `GET /api/log?since=<seq>&limit=<n>` returns `{ entries, next }`; each entry is `{ seq, t, kind: event|command|offline|topology|disabled|flock|noise|stopped|song, data }`. With `HUB_LOG_FILE` set (the simulated mesh uses `logs/interactions.ndjson`) it is also written as one JSON object per line, and the file rotates to `.1` at 10 MiB.
- **Birds panel:** only for the simulated mesh (shown when the hub has `NURSERY_URL`). Every container bird with **×** to remove it, and **Add bird #N** (in manual topology mode, tick its links first). The hub's `POST /api/birds` (`{"id"?, "links"?}`) and `DELETE /api/birds/<id>` do the same; both go in the interaction log as `flock` entries. See [section 3](#3-quick-start-simulated-mesh-no-speakers-needed).
- **Add noise:** only for the simulated mesh (shown when the hub has `ETHER_CONTROL_URL`). Mixes background noise into the air that every bird hears, whatever the topology, on top of their songs. **Hear phones** sends this computer's microphone gated by the echo gate and without echo cancellation, so the birds hear phones in the room (see [section 5](#5-join-with-a-phone)); **Microphone** sends this computer's microphone as noise (the browser asks for permission); **Test room noise** sends a synthetic busy room (people talking, a fan, mains hum, the odd click; the same generator the tests use, `packages/core/src/sim/roomNoise.ts`). Press the active button again to stop. **Gain** (-20 to +40 dB) scales the source. The meter shows the noise against a bird's song over the whole band (the mark is a bird) and what to expect: up to +10 dB every frame should decode, from about +14 dB frames start to fail, past about +18 dB most do. The microphone is opened with echo cancellation on (so the chirps this page plays are not sent back in as an echo) and without noise suppression or automatic gain; while it is the source, this page's own air sound leaves the noise out, so the speakers do not feed the microphone. The page sends 48 kHz PCM to the hub's `/noise` WebSocket; the hub relays it to the ether's `/noise` with the control token, logs `noise` entries (`{sources}` when a source joins or leaves, `{source, level}` when one starts or its gain is set), and tells every dashboard how many sources are on.
- **Topology:** only for the simulated mesh (shown when the hub has `ETHER_CONTROL_URL`). It shows whether the ether is in distance or manual mode, and the current links in the format of [section 3](#choosing-the-topology). Press a preset (**Two flocks**, **Ring**, **Line**; the active one is highlighted), or edit the text and press **Apply**, or press **Use distance** to go back to distance mode. Every open dashboard updates, and the change goes in the interaction log as a `topology` entry.

Phones whose app came from the hub report to it like laptop birds (see [section 5](#5-join-with-a-phone)). A phone that sends no telemetry (the app from GitHub Pages) is inferred: the hub adds a phone when a laptop hears a frame from a sender id it does not know.

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
5. Scan the QR code with the phones, press **Turn on the microphone** and keep their screens on.
6. Send a message from one node, watch it spread, mute a node mid-way.
7. If the room is too loud or the audio fails, use the fallback: `bash scripts/demo.sh` and click the dashboard once so it plays the simulated air.

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
- Real nodes appear only if they were started with `--observatory ws://<HUB_IP>:3200` (and the hub is reachable from the laptop on that port). Phones appear by themselves only when their app came from the hub (the QR code of the simulated mesh); others appear once a laptop hears them.
- If the page is not at <http://localhost:3200>, check the hub is running (`npm start -w @birdsong/dashboard`) and that you built the page first (`npm run build -w @birdsong/dashboard`).
- The QR shows `http://localhost:3200/app/` if `PWA_URL` is not set. That address works only in a browser on the hub machine, because phones need HTTPS for the microphone. `scripts/demo.sh` sets it to `https://<LAN IP>:3443/app/`; for a hub you start yourself, set `PWA_URL` to an HTTPS address of the phone app (the Pages address, which has no speech to text).

**A phone cannot open the QR address.** Check the phone is on the same Wi-Fi as the laptop, that the address in the QR panel is the laptop's LAN address (set `PHONE_HOST=<ip>` before `bash scripts/demo.sh` if it picked the wrong network), and that nothing blocks port 3443. Some guest and university networks keep devices apart; a phone hotspot from the laptop or a travel router avoids that.

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

- **The nursery has the Docker socket.** To add and remove birds, the simulated mesh's `nursery` service mounts `/var/run/docker.sock` (or `$DOCKER_SOCKET`), which gives it full control of Docker on the machine. It publishes no port and accepts only the hub's token, but anyone who can reach the hub (port 3200, open on your network) can add birds (ids 0 to 127, this image only) or stop bird containers. Run the simulated mesh only on a network you trust.

- **Noise filtering is tuned on synthetic noise.** Carrier sense ignores room noise because it waits for tonal chirps (see [docs/PROTOCOL.md](docs/PROTOCOL.md) section 6); this and the decoding limits shown by the Add noise panel were measured against the synthetic room noise in `packages/core/src/sim/roomNoise.ts`, not against real microphone recordings. Other birdsong or whistling in the band still counts as "busy", as it should.

- **Slow.** One frame takes 8.9 s (`stealth`) or 3.0 s (`fast`) and a 140-character message needs 7 to 8 of them per hop. There are no acknowledgements; frames from several singers at once collide.
- **Not tested in a real room.** All automated tests run against the simulated air or synthetic noise and reverb. Real-room tuning of volume and sync threshold, real speakers and microphones, and the two-browser-tab acoustic test have not been run.
- **Not tested on real phones.** Android Chrome and iOS Safari have not been tried; iOS audio routing (earpiece, silent switch) is unverified. The dashboard's always-on sound of the simulated air was checked only through its live spectrogram, not by ear.
- **arm64 image not built.** The Docker image workflow builds `linux/amd64` and `linux/arm64`, but the arm64 build has not been run (the `docker buildx` plugin was not installed when it was checked).
- **Short nonce.** A 4-byte random nonce with one key: after tens of thousands of messages on one passphrase the IV can repeat, which breaks AES-GCM for those messages.
- **Shared passphrase.** One key per channel. Anyone with the passphrase can read and forge messages, and a replay after the 5-minute expiry is accepted again. There is no forward secrecy.
- **Metadata is in clear.** The channel tag, message id, sender id and hop count are sent unencrypted in every frame.
- **Small ids.** The message id is 16 bits (two live messages can collide) and the channel tag is 8 bits (a different channel matches by chance 1 time in 256).
- **Occasional false frames.** The receiver sometimes reports extra frames (for example in reverb tails); error correction and the CRC discard them.
- **Message size.** At most 240 bytes after compression, so a 140-character text that compresses badly can be refused.
- **`sim-up.sh` on a fresh build.** It builds ten services from one image tag in parallel (plus the `caddy:2` proxy image, which is pulled), which can fail with "image already exists". Run `docker build -f docker/Dockerfile.node -t birdsong-node .` first (then the build is a cache hit).
- **Dashboard.** Phones running the app from GitHub Pages send no telemetry, so they appear only when a laptop hears them.
- **Hear phones** is one microphone for the whole room: a phone far from the dashboard laptop may not reach the birds, and while a bird plays through the speakers the gate drops anything the phones sing at the same moment (as a collision would in a real room). Tested with a song streamed straight into the hub's `/noise` socket and in the browser, not yet with a real phone's speaker. A page opened right after startup may need one reload. The default `PWA_URL` is the hub's own `/app/` (`http://localhost:3200/app/`). It works only on the hub machine, because phones need HTTPS for the microphone; `scripts/demo.sh` sets an HTTPS LAN address instead, whose self-signed certificate phones must accept once.
- **No AI.** Compression is a static dictionary (Unishox2); there is no language model in the project.
