# BirdSong: a mesh network made of birdsong

## Inspiration

When a government shuts down the internet, people still carry phones with speakers and microphones. Could sound alone carry a message from person to person, disguised as something nobody questions: birds?

## What it does

BirdSong turns a text message (up to 140 characters) into encrypted, error-corrected synthetic birdsong. Laptops and phones that hear it decode it and pass it on by singing it again, so a message hops across a room with no internet, no router and no server. Four environments (quiet, jungle, coast, city) change the musical key; a slow "stealth" profile sounds like song and a "fast" one suits noisy rooms. A live dashboard shows the flock and each message hopping. A judge scans a QR code and joins from a phone browser.

## How we built it

- **Codec**: text is compressed (Unishox2), encrypted with AES-256-GCM from a shared passphrase, split into 16-byte blocks and coded with a Vandermonde fountain code over GF(256), so any k droplets rebuild the message. Each 32-byte frame has a CRC and Reed-Solomon parity that corrects 4 bad bytes.
- **Modem**: each symbol is one chirp: 3 bits of pitch from a musical scale plus 1 or 2 bits of chirp shape. A shared sync sweep lets the receiver find frames; correlation against templates decodes them. A frame lasts 8.9 s (stealth, 28.7 bit/s on air) or 3.0 s (fast, 85 bit/s).
- **Mesh**: listen-before-sing, a relay burst with suppression, then a Trickle timer.
- **Stack**: TypeScript everywhere. One pure core package runs in Node, in Docker (one container per laptop, using the host speaker and mic) and in the phone PWA. A simulated air lets us test and demo an 8-node mesh.

## Challenges

- Real rooms corrupt chirps, so we added Reed-Solomon inside each frame and a fountain code across frames.
- A frame is recognised only about 0.4 s in, too late for listen-before-sing, so the receiver also senses band energy.
- Pure Trickle is too slow for multi-hop, so relays send a burst first.

## Accomplishments

- 242 unit tests (1 skipped) and 6 mesh end-to-end tests pass.
- In the simulated mesh (fake modem, deterministic): a message crosses a 5-node line in 27.5 s of virtual time (4 hops); with two relays muted mid-flight it still arrives (69.5 s); it survives the writer going silent after its burst (27.5 s).
- An 8-node containerised mesh with a dashboard: a message sent to node 0 reached node 7 in about 25 s (simulated air).

**Not yet verified:** real speakers and microphones, phones, the two-tab acoustic browser test and the arm64 image build.

## What we learned

Hiding data in sound is mostly an error-correction and timing problem. Making the engine independent of audio hardware made everything testable.

## What's next

Per-person keys, a larger nonce, tuning in real rooms and iOS audio routing.

Honest limits: airtime is slow (a 140-character message is about 7 frames from the writer, roughly 1 minute per hop in stealth); a 4-byte random nonce becomes risky after tens of thousands of messages per passphrase; one shared passphrase per channel (no forward secrecy); the one-byte network tag lets an observer group frames by channel.

## Sponsor tracks

- **Composition (main theme)**: the messages are music. Scales, species timbres and ambient beds make the data into generated birdsong, savable as song files.
- **QRT, Hidden in Plain Sight**: an invented physical language with an encoder and a decoder, specified in `docs/PROTOCOL.md`: pitch and chirp shape carry the bits.
- **Neptune North**: a distributed system that keeps working when communication is interrupted: no server, gossip with Trickle, and a live "kill two relays" demo.
- **Marshall Wace, New Worlds**: sound as a network medium that most people never think to look at.
- **Accenture**: the fit rests on the problem framing only (a shutdown is a "just the way things are" failure of communication). There is **no AI or LLM component** in BirdSong.

## Built with

TypeScript, Node.js 24, Preact, Vite, Web Audio, PulseAudio / PipeWire, Docker, WebSockets, AES-GCM (WebCrypto), Unishox2, fft.js, GitHub Pages.
