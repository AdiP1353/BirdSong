# BirdSong pitch outline

An outline for turning into slides (about 3 minutes of talking plus the live demo). Numbers come from the code and `plans/README.md`.

## 1. Title: BirdSong
- A mesh network that hides encrypted messages in birdsong
- Works with no internet, no router, no server
- Team and tracks (Composition, QRT, Neptune North, Marshall Wace, Accenture)

On screen: the dashboard screenshot (`packages/dashboard/screenshot.png`) behind the title.

## 2. The problem
- Internet shutdowns cut people off exactly when they need each other
- Phones still have speakers and microphones
- A message that sounds like nature is hard to notice and hard to ban

On screen: a phone with no signal bars; one line of text only.

## 3. The idea
- Text becomes encrypted chirps; devices that hear it sing it on
- Messages hop across a room like a flock calling
- Anyone can join with a QR code

On screen: diagram, message -> sound -> next device -> sound -> next device.

## 4. An invented physical language
- A symbol is a pitch (3 bits of a musical scale) plus a chirp shape (1 or 2 bits)
- Frames: sync sweep, then 64 chirps (stealth, 8.9 s) or 52 chirps (fast, 3.0 s)
- Four environments: quiet, jungle, coast, city, each with its own scale

On screen: a spectrogram of one frame with the sync sweeps and chirps labelled; the symbol table from `docs/PROTOCOL.md`.

## 5. Surviving a noisy room
- AES-256-GCM encryption; a CRC and Reed-Solomon fix up to 4 bad bytes per 32
- A fountain code: any k droplets rebuild the message, in any order
- Noise tests: 20 of 20 worst-case frames recovered per environment

On screen: the frame layout table; a "droplets" picture (k of any 255 pieces).

## 6. A mesh with no center
- Listen-before-sing, a relay burst, then a Trickle timer, five-minute expiry
- Phones run the same engine as the laptops
- Kill any relay and the flock routes around it

On screen: the dashboard graph live.

## 7. Live demo
- A judge scans the QR and joins
- Send from a laptop, watch it hop, press "Kill 2 random relays", the message still lands
- Switch to jungle and turn on camouflage

On screen: the live dashboard on the projector plus the judge's phone.

## 8. One engine, tested without a speaker
- The same node code runs on laptops (Docker), phones (PWA) and a simulated air
- 242 unit tests and 6 mesh end-to-end tests; the simulated 5-node line delivers in 27.5 s and still delivers with 2 relays killed
- 8-node containerised mesh with dashboard in three commands

On screen: test counts and the architecture diagram from `docs/ARCHITECTURE.md`.

## 9. Honest limits and what's next
- Slow: about a minute per hop in stealth; a short nonce; one shared passphrase; the network tag is visible
- Not yet tested: real rooms at scale, iPhone audio, the arm64 image
- Next: per-person keys, larger nonce, real-room tuning, recorded birdsong as cover
- No AI/LLM component

On screen: a two-column "works today / next" table.

## 10. Thank you
- Repository and the join QR
- Sponsor-track map: Composition (generated music), QRT (the language), Neptune North (works when communication is cut), Marshall Wace (sound as a new medium), Accenture (problem framing)

On screen: QR code and repository link.
