# Demo-day runbook

Placeholders: `<HUB_IP>` is the LAN IP of the dashboard laptop, `<PASSPHRASE>` the channel passphrase for the day (letters and digits only keeps shell quoting simple), `<PAGES_URL>` the GitHub Pages address of the phone app, ending in `/`.

Everything here was written from the code and scripts. Real speakers and microphones, real phones and the arm64 image build have **not** been verified by the automated runs; step 1 and step 2 are where you verify them.

## 1. Night before

1. On every laptop, from the repository root, build the image:
   `docker build -f docker/Dockerfile.node -t birdsong-node .`
2. Make sure the PipeWire PulseAudio server is on: `systemctl --user enable --now pipewire-pulse.socket pipewire-pulse.service`, then `pactl info` on the host.
3. Confirm the container can reach the host audio server (this mirrors the mounts in `scripts/run-node.sh`):
   `docker run --rm --entrypoint pactl --user "$(id -u):$(id -g)" -e HOME=/tmp -e PULSE_SERVER="unix:$XDG_RUNTIME_DIR/pulse/native" -v "$XDG_RUNTIME_DIR/pulse/native:$XDG_RUNTIME_DIR/pulse/native" birdsong-node info`
   It must print a `Server Name:` line.
4. Build the dashboard on the hub laptop: `npm ci && npm run build -w @birdsong/dashboard`.
5. Open `<PAGES_URL>` on one Android phone and one iPhone. Check the Join screen loads, microphone permission is granted, and test one send. Note what the iPhone does with the sound (earpiece versus speaker); this is the known weak spot.
6. Print the join QR: start the hub (step 3 below), open `http://localhost:3200`, print the "Join the flock" panel.
7. Optional: `npm test && npm run test:e2e` on the hub laptop.

## 2. Physical layout

1. Place the laptops along a line or around the room, about 3 to 5 m apart, speakers facing the next laptop.
2. Set transmit volume (`--volume`, default 0.8, or the node UI Settings) low enough that the **first and last laptop cannot hear each other**.
   Test: run only the two end laptops (step 3 commands, nodes 1 and N). Send from one end. The far end must NOT decode. Raise or lower the volume or the distance until that holds, then start all the laptops.
3. The dashboard laptop also runs a node.
4. Put the projector on the hub laptop (`http://localhost:3200`). Keep the phone volume at about 70%.

## 3. Start commands

Give each laptop a fixed id in 0 to 127; phones pick 128 to 255 themselves.

Hub (dashboard laptop):

```
CHANNEL_PASSPHRASE=<PASSPHRASE> PWA_URL=<PAGES_URL> npm start -w @birdsong/dashboard
```

The dashboard is at `http://localhost:3200` (port 3200).

Each laptop node (change the id; use `ws://localhost:3200` on the hub laptop itself):

```
BIRDSONG_ID=1 bash scripts/run-node.sh --key <PASSPHRASE> --env jungle --observatory ws://<HUB_IP>:3200
BIRDSONG_ID=2 bash scripts/run-node.sh --key <PASSPHRASE> --env jungle --observatory ws://<HUB_IP>:3200
BIRDSONG_ID=3 bash scripts/run-node.sh --key <PASSPHRASE> --env jungle --observatory ws://<HUB_IP>:3200
```

All laptops and phones must use the same passphrase, environment and profile. Useful extra flags: `--profile fast|stealth`, `--volume 0..1`, `--alias <name>`, `--camouflage`, `--neighbors 1,3` (accept only those sender ids). Each node serves its own UI at `http://localhost:8080/?runtime=remote`. All flags: `docker run --rm birdsong-node --help`.

Check: all nodes show as online on the dashboard.

## 4. The 3-minute demo script

1. **The problem (20 s).** "When a government cuts the internet, people still have phones with speakers and microphones. We hide encrypted messages in birdsong, so a flock of devices passes them along and nobody notices."
2. **Join (20 s).** A judge scans the QR on the dashboard, opens the page, taps "Join the flock", allows the microphone. The phone shows up on the dashboard once a laptop hears it.
3. **Send (30 s).** On a laptop, open `http://localhost:8080/?runtime=remote`, type a message, press "Send".
4. **Watch it hop (40 s).** On the dashboard, point at the links pulsing and the rings filling as nodes collect droplets (a stealth frame is about 9 s long, so narrate while it travels; the fast profile is about 3 s per frame).
5. **Kill the relays (30 s).** While the message is in flight, press "Kill 2 random relays". Say: "No central server, no fixed route." Then press "Turn dashboard off": the hub lets go of every bird, but you still hear them and the bird windows still fill up. Say: "The dashboard only watches. Turn it off and the flock carries on." Turn it back on.
6. **It still lands (20 s).** The message appears on the far laptop and on the judge's phone.
7. **Songs (20 s).** On the judge's phone use "Save last message as song" and then "Decode a song file" (or pick one of the files in `samples/`) to show the saved birdsong decodes back to the text. Playing that file near the room's microphones also works in principle (a song is ordinary frames), but this was not tested with real speakers.
8. **Camouflage (20 s).** On the dashboard switch Environment to Jungle and tick "Camouflage": ambient forest sound is mixed in and the chirps sit inside it.

## 5. Fallbacks

- **Room too loud**: set everything to the `fast` profile (dashboard Profile menu) and raise the volume. Then re-check the end-to-end isolation test.
- **Still failing**: run the simulated mesh and play it through the projector speakers: `bash scripts/demo.sh` (8 nodes + ether + hub in Docker, Two flocks topology, opens the dashboard). Click the dashboard once so the browser allows sound; it then plays the air all the time (through the proxy at `ws://localhost:3100/ether/listen`), with a mute button and volume slider in the header. Its sound was only checked through the spectrogram, so listen once the night before. The nodes' pages are `http://localhost:3100/nodes/0/` to `http://localhost:3100/nodes/7/`. Send a test message with `curl -X POST localhost:3100/nodes/0/api/send -H 'content-type: application/json' -d '{"text":"hello"}'`.
- **Show a specific shape in the simulated mesh** (for example a long line, so that a message must take many hops): type the links in the dashboard's Topology panel (for example `0-1 1-2 2-3 3-7 7-6 6-5 5-4`) and press Apply, press a preset (Two flocks, Ring, Line), or put them in `docker/topology.txt` before starting. "Use distance" returns to the grid. See README section 3, "Choosing the topology".
- **Change the flock live**: in the dashboard's Birds panel, press × on a bird to remove it, or tick a few birds and press "Add bird #N" to add one linked to them. Re-running `bash scripts/demo.sh` resets the flock to birds 0 to 7.
- **A phone will not join**: use the laptop's local UI at `http://localhost:8080/?runtime=remote`.
- **Dashboard shows "reconnecting"** right after startup: reload the page once.
- **Fake messages or no messages**: check that every node shows the same environment and profile and the same passphrase.

## 6. Reset between judges

- Inboxes are in memory. Stop each node (Ctrl-C in its terminal, the container is removed on exit) and start it again with the same command.
- Restart the hub too (Ctrl-C, same command) to clear the dashboard feed.
- Simulated mesh: `docker compose -f docker/compose.sim.yml restart`; to stop it: `docker compose -f docker/compose.sim.yml down`.
- Phones: reload the page. The page removes the passphrase from the address bar after joining, so scan the QR again if it asks to join.
