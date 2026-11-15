#!/usr/bin/env bash
# One command for the whole demo: build the image, start the simulated 8-node mesh, apply the
# "two flocks" topology and open the dashboard.
#
#   npm run demo                 start (or restart) the demo
#   npm run demo -- --preset ring    start with another topology preset (two-flocks | ring | line | distance)
#   npm run demo:stop            stop it
#
# Needs only Docker. Set BIRDSONG_NO_OPEN=1 to skip opening the browser.
set -euo pipefail
cd "$(dirname "$0")/.."

# Settings and secrets (such as ELEVENLABS_API_KEY) live in .env or .env.local (the ElevenLabs CLI writes the
# latter); see .env.example. Plain KEY=value lines. .env.local wins when both set a value.
for f in .env .env.local; do
  if [ -f "$f" ]; then
    set -a
    # shellcheck disable=SC1091
    . "./$f"
    set +a
  fi
done

COMPOSE=(docker compose -f docker/compose.sim.yml)
PRESET=two-flocks
HUB=http://localhost:3200

# Birds added from the dashboard are containers outside compose; remove them so a stop or a restart is clean.
clear_added_birds() {
  local ids
  ids=$(docker ps -aq --filter label=birdsong.nursery=1 2>/dev/null || true)
  if [ -n "$ids" ]; then docker rm -f $ids >/dev/null; fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --stop|--down) clear_added_birds; "${COMPOSE[@]}" down; exit 0 ;;
    --preset) PRESET="${2:?--preset needs a name}"; shift 2 ;;
    --preset=*) PRESET="${1#--preset=}"; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker, then run this again." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Cannot reach the Docker daemon. Start it (sudo systemctl start docker) and check that your user may use it." >&2
  exit 1
fi

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

step "Building the BirdSong image (fast after the first time)"
# One build for all ten services: building each from compose can collide on the shared tag.
docker build -f docker/Dockerfile.node -t birdsong-node .

# This computer's address on the local network. The dashboard's QR code sends phones to
# https://<it>:3443/app/: the proxy serves the hub there over HTTPS, because phones get the microphone only on https.
if [ -z "${PHONE_HOST:-}" ]; then
  PHONE_HOST=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)
  if [ -z "$PHONE_HOST" ]; then PHONE_HOST=$(ipconfig getifaddr en0 2>/dev/null || true); fi
  if [ -z "$PHONE_HOST" ]; then PHONE_HOST=$(hostname -I 2>/dev/null | awk '{print $1}' || true); fi
fi
export PHONE_HOST="${PHONE_HOST:-127.0.0.1}"
export PWA_URL="${PWA_URL:-https://$PHONE_HOST:3443/app/}"

step "Starting the mesh: ether, hub, proxy, nursery and 8 birds"
mkdir -p logs   # created by you, not root, before Docker bind-mounts it
clear_added_birds
"${COMPOSE[@]}" up -d --no-build --remove-orphans

step "Waiting for the hub"
for i in $(seq 1 60); do
  if curl -fsS "$HUB/config.json" >/dev/null 2>&1; then break; fi
  if [ "$i" = 60 ]; then echo "The hub did not come up. Logs: ${COMPOSE[*]} logs hub" >&2; exit 1; fi
  sleep 1
done
# A fresh demo starts with the dashboard on.
curl -fsS -X POST "$HUB/api/disabled" -H 'content-type: application/json' -d '{"disabled":false}' >/dev/null || true

if [ "$PRESET" = distance ]; then
  step "Topology: by distance"
  curl -fsS -X PUT "$HUB/api/topology" -H 'content-type: application/json' -d '{"text":""}' >/dev/null
else
  step "Topology: $PRESET"
  # Runs inside the hub container, so the host needs no Node.js.
  for i in $(seq 1 20); do
    if "${COMPOSE[@]}" exec -T hub node scripts/apply-topology.ts "$PRESET" http://localhost:3200; then break; fi
    if [ "$i" = 20 ]; then echo "Could not set the topology (is the ether up?)." >&2; exit 1; fi
    sleep 1
  done
fi

step "Waiting for the birds"
online=0
for i in $(seq 1 30); do
  online=0
  for n in 0 1 2 3 4 5 6 7; do
    if curl -fsS "http://localhost:3100/nodes/$n/api/state" >/dev/null 2>&1; then online=$((online + 1)); fi
  done
  if [ "$online" -ge 8 ]; then break; fi
  sleep 1
done
echo "$online of 8 birds are up"

if [ -n "${ELEVENLABS_API_KEY:-}" ]; then
  SPEECH_NOTE="on (the 🎤 button on the phone page; needs the internet)"
else
  SPEECH_NOTE="off (put ELEVENLABS_API_KEY in .env to turn it on)"
fi

cat <<MSG

BirdSong demo is running.

  Dashboard:     $HUB            (Birds view: $HUB/?view=birds)
  Phones:        $PWA_URL   (the dashboard's QR code; same Wi-Fi; accept the certificate warning once)
  Bird pages:    http://localhost:3100/nodes/0/ ... /nodes/7/
  Send from 0:   curl -X POST localhost:3100/nodes/0/api/send -H 'Content-Type: application/json' -d '{"text":"hello flock"}'
  Speech to text: $SPEECH_NOTE
  Stop:          npm run demo:stop

MSG

if [ "${BIRDSONG_NO_OPEN:-}" != 1 ]; then
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$HUB" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$HUB" || true
  fi
fi
