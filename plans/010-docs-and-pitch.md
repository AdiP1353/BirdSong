# Plan 010: The project explains itself — spec, architecture, demo runbook, submission text, pitch outline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (edit only your own row).
>
> **Drift check (run first)**: open `plans/README.md` and read the status
> table and "Notes from executors". Every number you write in the docs must
> come from the code or from those notes, not from this plan (this plan's
> numbers are design targets).

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans 002, 003, 005 DONE at minimum; ideally all of 001–009
- **Category**: docs
- **Planned at**: no git history (greenfield), 2026-11-14

## Why this matters

BirdSong is a hackathon entry: an acoustic mesh network that hides encrypted
text messages inside synthetic birdsong, for people under internet shutdowns.
Judges score it against several sponsor briefs. One of them asks for an
invented physical language **with an encoder and a decoder**, so a precise
spec is part of the deliverable, not an afterthought. Judges also need to
follow the system in two minutes, and the team needs a step-by-step demo
script that still works when the venue is loud.

## Current state

Read these before writing (they are the source of truth):
- `packages/core/src/constants.ts`, `envs.ts`, `timing.ts`, `symbols.ts`, `types.ts`, `telemetry.ts`
- `packages/core/src/codec/` (frame layout, crypto envelope, fountain), `modem/` (synth, detector, demod), `node/params.ts` and `node/engine.ts` (gossip rules)
- `packages/node-runtime/src/config.ts` (flags), `scripts/run-node.sh`, `scripts/sim-up.sh`, `docker/compose.sim.yml`
- `plans/README.md` — statuses and measured numbers in "Notes from executors"
- The root `README.md` written by plan 001

The sponsor briefs, for the mapping section:
- **Composition (main theme)**: art, music or anything that creates new things.
- **Accenture**: redesign a frustrating process people accept as "just the way things work", using modern AI and LLMs.
- **Marshall Wace**: "New Worlds": open a door to the unexplored.
- **QRT**: "Hidden in Plain Sight": invent a physical language that encodes digital information; build an encoder and a decoder.
- **Neptune North**: distributed systems that keep working when communication is interrupted.

Known limitations that must be stated honestly (verify each against the code):
4-byte random nonce (collisions become likely after tens of thousands of messages per passphrase);
one shared passphrase per channel (no per-person keys, no forward secrecy);
the netTag byte lets an observer group frames by channel;
airtime is slow (compute it: a k-block message needs k + 1 frames from the
writer, and each stealth frame lasts `frameAirtimeMs(PROFILES.stealth)`; a
140-character message has k ≈ 7–11, so a single hop takes roughly 1–2 minutes);
iOS Safari audio routing; the project has **no AI/LLM component** (the Accenture fit rests on the problem framing only).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Frame airtime | `node -e "import('@birdsong/core').then(m=>console.log(m.frameAirtimeMs(m.PROFILES.fast), m.frameAirtimeMs(m.PROFILES.stealth)))"` (run inside `packages/node-runtime/`) | two numbers |
| Tests | `npm test && npm run test:e2e` | all pass (record the counts) |

## Scope

**In scope**: `README.md` (rewrite), `docs/PROTOCOL.md`, `docs/ARCHITECTURE.md`,
`docs/RUNBOOK.md`, `docs/DEVPOST.md`, `docs/PITCH.md` (all create).

**Out of scope**: all code. If you find a mismatch between code and plan, document the **code's** behaviour and list the mismatch in `plans/README.md` notes.

## Git workflow

Commit only the in-scope files. Style `docs: …`. Do NOT push.

## Steps

### Step 1: `docs/PROTOCOL.md` — the physical language

Precise enough that someone could write a compatible decoder without reading the code:
1. Overview: message → envelope → blocks → droplets → frames → chirps.
2. Envelope: byte layout table, compression flag, key derivation (algorithm, salt, iterations, which derived bytes become the key and the netTag), AES-GCM parameters (IV construction, tag length, additional data).
3. Fountain: field (GF(2⁸), polynomial 0x11d), coefficient rule (block i of droplet seed s gets α^(s·i)), why any k distinct seeds decode (Vandermonde), padding and length check.
4. Frame: the 32-byte table (header, payload, CRC-16/CCITT-FALSE, Reed–Solomon parity: generator and correction capacity).
5. Modulation: frame timeline as an ASCII diagram (intro, sync, data) with millisecond values from `timing.ts`; symbol = 3 pitch bits + 1 or 2 shape bits; the shape table; each environment's 8 pitches as note names and Hz (generate the table with a small `node -e` script and paste it); profiles table with bits per symbol, syllable and gap lengths, frame airtime and resulting bit rate.
6. Receiver: band-pass, sync correlation and threshold, timing search, energy-based busy detection.
7. Medium access and gossip: listen-before-sing, backoff, burst sizes, burst suppression, Trickle parameters, TTL, tombstones, hop limit — all values from `node/params.ts` and `constants.ts`.
8. Limitations (the list above).

### Step 2: `docs/ARCHITECTURE.md`

A Mermaid diagram of the packages and how they connect (core used by node-runtime and web; node-runtime ↔ hub; node-runtime ↔ ether in sim mode; phones ↔ air ↔ laptops), a table of the packages with one line each, the `AudioPort`/`Modem`/`Clock` seams and why they exist (one engine, three audio worlds, deterministic tests), and the test pyramid with the actual test counts from `npm test` and `npm run test:e2e`.

### Step 3: `docs/RUNBOOK.md` — demo day

Numbered checklists:
1. **Night before**: build the image on every laptop (`docker build -f docker/Dockerfile.node -t birdsong-node .`), confirm `pactl info` works inside the container, confirm the Pages URL loads on one Android and one iPhone, print the join QR.
2. **Physical layout**: laptops along a line or around the room, about 3–5 m apart, transmit volume low enough that the first and last laptop cannot hear each other (test: send from one end with only the two end laptops running; the far end must NOT decode); the dashboard laptop also runs a node.
3. **Start commands** for each laptop (copy-paste ready, with the hub IP placeholder `<HUB_IP>`), giving each laptop a fixed id in **0–127** (`BIRDSONG_ID=1 …`, `BIRDSONG_ID=2 …`; phones pick 128–255 themselves), and for the hub (`CHANNEL_PASSPHRASE=… PWA_URL=… npm start -w @birdsong/dashboard`).
4. **The 3-minute demo script**: what to say and click, in order: the problem (shutdowns); a judge scans the QR; send from a laptop; watch it hop on the dashboard; press "Kill 2 random relays" mid-flight; the message still lands on the far node and on the judge's phone; play a saved song WAV from a phone speaker and decode it; switch environment to jungle and turn on camouflage.
5. **Fallbacks**: room too loud → switch everything to `fast` profile and raise volume; still failing → `bash scripts/sim-up.sh` with the dashboard's "Listen to the simulated air" on the projector speakers (works only if plan 009 Step 7 was done; check `plans/README.md`); a phone will not join → use the laptop's local UI at `http://localhost:8080/?runtime=remote`.
6. **Reset between judges**: how to clear inboxes (restart the containers).

### Step 4: `docs/DEVPOST.md`

Sections: Inspiration, What it does, How we built it, Challenges, Accomplishments, What we learned, What's next, Built with. 400–700 words. Concrete and honest; use measured numbers from the notes. Include the sponsor-track mapping as a short list (one or two sentences each), stating plainly that there is no LLM component.

### Step 5: `docs/PITCH.md` — slide outline

8–10 slides, each with a title, 2–4 bullet points, and a "what's on screen" note (live demo, diagram, number). This file is an outline for the team to turn into slides; do not try to produce a deck file.

### Step 6: Root `README.md`

Rewrite: one-paragraph pitch, a screenshot (`packages/dashboard/screenshot.png` if it exists), quick start (sim mesh in Docker in 3 commands; real node with `run-node.sh`; phone via the Pages URL), links to the four docs, the development commands table, and the three source-code rules from plan 001.

**Verify**: `ls docs/*.md | wc -l` → `5`.
**Verify**: every command in `RUNBOOK.md` that starts with `npm`, `node`, `docker` or `bash` refers to a script or file that exists (check each path with `ls`).
**Verify**: `grep -n "TODO\|TBD\|XXX" README.md docs/*.md` → no output.

## Done criteria

- [ ] Five files in `docs/` plus the rewritten `README.md`
- [ ] Every number in `PROTOCOL.md` matches the code (spot-check: frame airtimes, RS parity length, Trickle intervals)
- [ ] No TODO/TBD markers
- [ ] `git status --porcelain` shows only the in-scope files and `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

- More than three code/plan mismatches that change the protocol (for example a different frame size). Report them before writing the spec, since the spec would then describe an unexpected design.

## Maintenance notes

- `PROTOCOL.md` is versioned by `PROTOCOL_VERSION` in `constants.ts`; any on-air change must bump both.
