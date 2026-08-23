---
title: Jam Buddy
emoji: 🎸
colorFrom: red
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
short_description: You start playing, it joins in — an AI music companion.
---

# Jam Buddy

> An AI music companion that listens to what you play and joins in — at your
> tempo, in the instrument you pick. Built for the Stability AI Challenge at
> Music Hackspace Montreal (August 22–23, 2026).

## What this is

**Jam Buddy** is a call-and-response music practice partner. You start playing,
it joins in.

- Load a **MIDI take** (from a controller) — the buddy detects your tempo and
  matches its length, then responds with a complementary part in your chosen
  instrument at the same tempo.
- Load an **audio take** (mic/interface) — the buddy uses Stable Audio 3's
  audio-to-audio path to actually *hear your groove* and respond to it
  rhythmically.
- Pick an **instrument** (bass / lead / rhythm / synth / drums), a **genre**,
  and a **mood** — the buddy generates the response with SA3.
- **PLAY BOTH** plays your take and the buddy's response together, in tempo.
- Every response is saved to `generations/` so you can keep and inspect what it
  produced.

The whole thing is **screenreader-compatible by design**: every knob is a
labelled `<input type=range>`, buttons have accessible names, and the status is
announced via `aria-live`. Voice-first *is* accessibility.

The SA3 generation runs **locally on the open Stable Audio 3 weights** —
`small-music` for melodic instruments, `small-sfx` for clean isolated drum hits.

Built for the **Stability AI Challenge** at Music Hackspace Montreal
(August 22–23, 2026, in partnership with MUTEK).

## Quick start (web app)

```bash
cd apps/web
pnpm install
pnpm dev
# → http://localhost:3000
```

The web app shells out to `tools/jam_buddy.py` (the SA3 pipeline). That needs
the `stable-audio-3` venv + a one-time model download. See
[`docs/06-stable-audio-integration.md`](docs/06-stable-audio-integration.md).

### CLI (the pipeline directly)

```bash
# MIDI take → tempo + length matched, then respond with bass
python3 tools/jam_buddy.py --midi take.mid --instrument bass --out out.wav

# Audio take → audio-to-audio, responds to the groove
python3 tools/jam_buddy.py --wav take.wav --genre metal --instrument lead --out out.wav

# Manual knob only
python3 tools/jam_buddy.py --bpm 120 --instrument drums --out out.wav
```

## Documentation

| Doc | Purpose |
|---|---|
| [`docs/01-vision.md`](docs/01-vision.md) | What we're building and why |
| [`docs/02-architecture.md`](docs/02-architecture.md) | System architecture, services, data flow |
| [`docs/03-data-model.md`](docs/03-data-model.md) | Prompt builder, knobs, generation metadata |
| [`docs/05-accessibility.md`](docs/05-accessibility.md) | Screenreader/keyboard accessibility strategy |
| [`docs/06-stable-audio-integration.md`](docs/06-stable-audio-integration.md) | SA3 setup, audio-to-audio, Vega notes, LoRA |
| [`docs/07-reaper-integration.md`](docs/07-reaper-integration.md) | DAW integration via Reaper |
| [`docs/08-build-plan.md`](docs/08-build-plan.md) | Hackathon build plan |
| [`docs/09-risks.md`](docs/09-risks.md) | Ranked risks + mitigations |
| [`docs/10-team-pitch.md`](docs/10-team-pitch.md) | Team pitch + skills |

## Conventions

- **Language**: TypeScript (frontend), Python 3.10+ (audio pipeline)
- **Linting**: ESLint + Prettier (TS), ruff + black (Python)
- **Accessibility**: axe-core in CI, NVDA + VoiceOver tested before each demo
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)
- **Branches**: `feat/*`, `fix/*`, `docs/*`, `chore/*`

For the agent harness — commands, test contract, and what's deliberately not in
git — see [`docs/HARNESS.md`](docs/HARNESS.md).

## License

MIT (code). Generated audio stays local / your own material; no third-party
samples ship in this repo.
