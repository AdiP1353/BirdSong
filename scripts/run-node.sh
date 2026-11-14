#!/usr/bin/env bash
# Run one BirdSong node in Docker using the host's real speaker and microphone
# (through the PipeWire/PulseAudio socket). Arguments are passed to the node.
# Laptop node ids should be 0-127 (phones pick 128-255), e.g.:
#   BIRDSONG_ID=3 scripts/run-node.sh --key <passphrase>
set -euo pipefail

sock="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pulse/native"
if [ ! -S "$sock" ]; then
  echo "PulseAudio socket not found at $sock" >&2
  echo "Enable the PipeWire PulseAudio server:  systemctl --user enable --now pipewire-pulse.socket pipewire-pulse.service" >&2
  exit 1
fi

args=(run --rm -i --name "birdsong-${BIRDSONG_ID:-node}"
  --network host
  --user "$(id -u):$(id -g)"
  -e HOME=/tmp
  -e PULSE_SERVER="unix:${sock}"
  -v "${sock}:${sock}")
[ -t 0 ] && args+=(-t)
[ -f "$HOME/.config/pulse/cookie" ] && args+=(-v "$HOME/.config/pulse/cookie:/tmp/.config/pulse/cookie:ro")
# Forward every BIRDSONG_* variable that is set on the host (they are the flag fallbacks).
while IFS='=' read -r name _; do args+=(-e "$name"); done < <(env | grep '^BIRDSONG_' || true)
exec docker "${args[@]}" "${BIRDSONG_IMAGE:-birdsong-node}" --audio pulse "$@"
