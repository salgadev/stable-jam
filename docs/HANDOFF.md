# HANDOFF — stable-jam resume guide

> This file exists so a fresh session can `cd D:/CODE/stable-jam` and pick up
> exactly where the previous one left off — no loss of context. Read this first,
> then the linked docs.

**Product:** Jam Buddy (consolidated here as **stable-jam**). "You start playing,
it joins in." A call-and-response AI music companion using Stable Audio 3,
built for the Stability AI Challenge at Music Hackspace Montreal (Aug 22–23 2026).

---

## What this repo is (and is not)

`stable-jam/` is the **source + docs + tests** for the Jam Buddy product. It does
NOT contain the heavy vendored model repos — those stay in the previous
location and are referenced by env vars (below). Don't expect to `git clone` and
get a GPU model; the SA3 weights are a separate download.

**Copied from** `D:/CODE/unstable-drums/` (the previous working dir, still intact
if you need to recover anything). This dir was created to give the hackathon a
clean, product-accurate home.

## Product state (what actually works, verified this session)

- **Web app** (`apps/web`): hardware-sampler rack UI. Instrument pads (bass/lead/
  rhythm/synth/drums), Genre/Mood/Tempo knobs, a "Your take" section with BOTH a
  MIDI file input and an audio file input, JOIN IN + PLAY BOTH buttons, status
  panel (aria-live) showing "Buddy tempo: N BPM", and an audio player. Every
  response is saved to `generations/` at the repo root.
- **SA3 pipeline** (`tools/jam_buddy.py`): the CLI that does the generation.
  Two input modes:
  - `--midi take.mid` — detects tempo (exact) + response length from the take,
    generates a complementary melodic part at that tempo. **Ignores the groove**
    (SA3 can't parse MIDI notes).
  - `--wav take.wav` — TRUE audio-to-audio via `init_audio` + `init_noise_level`
    (default 0.4). The buddy actually HEARS the groove and responds rhythmically.
  - `--bpm N` / `--model small-music|small-sfx` / `--genre` / `--duration`.
  - Drums force `small-sfx` (clean isolated hits); everything else `small-music`.
- **API route** (`apps/web/app/api/jambuddy/route.ts`): POST /api/jambuddy with
  `{knobs, bpm?, midi?, audio?, duration?}`, shells to the python, returns the
  WAV + `X-Jam-Buddy-BPM` header. Writes output to `<repo>/generations/`.
- **Prompt builder** (`apps/web/lib/jambuddy/prompt.ts`): pure function building
  the SA3 prompt from the knobs per the official SA3 prompting guide
  (TrackType: Instrument, instrument, genre, mood, BPM, studio recording).
  Negative prompt steers away from a full mix. `MODEL_FOR_INSTRUMENT` maps
  drums→small-sfx.
- **Player** (`apps/web/lib/jambuddy/player.ts`): browser Web Audio. `playTogether`
  renders the MIDI take as oscillators and plays it with the buddy WAV on the
  same clock. **Note: this was "banked" — the user reported PLAY BOTH only
  played the generated part, not the MIDI synth. It's parked, not debugged.**

## Verified this session (proof)

- Web: `pnpm run test` -> 31/31 pass (prompt, player, engine, conversation);
  `tsc --noEmit` clean; page serves the rack.
- CLI: `jam_buddy.py --midi <file>` -> detected 158 BPM, 24.3s response matching
  the take. Audio-to-audio on a 5s take -> ~10s wall, valid WAV (peak 0.43,
  rms 0.08). A ~378s take times out on CPU — keep audio takes short.
- The generations dir fills with timestamped WAVs.

## Key environment / paths

SA3 (the engine) now lives IN this repo at `stable-audio-3/`. The venv's
editable-install `.pth` was repointed to this location (was `D:/CODE/unstable-drums/...`).
The `/api/jambuddy` route auto-resolves it via `join(repoRoot, "stable-audio-3", ...)`.

| Var | Value |
|---|---|
| `JAM_BUDDY_ROOT` | `D:/CODE/stable-jam` (repo root; route walks up to find `tools/jam_buddy.py`) |
| `JAM_BUDDY_PYTHON` | `D:/CODE/stable-jam/stable-audio-3/.venv/Scripts/python.exe` (the SA3 venv) |
| SA3 weights | cached in `stable-audio-3/.venv` + HF cache on G:/AI/models/huggingface |
| `HF_TOKEN` | in old repo's `.env` (needed for gated SA3 model access) — copy if regenerating weights |

The SA3 venv was extended with `mido` and `librosa`
(`uv pip install --python .../stable-audio-3/.venv/Scripts/python.exe mido librosa`).
A fresh session must use that venv or recreate it.

## How to run (fresh session)

```bash
cd D:/CODE/stable-jam
# 1. install web deps (node_modules was NOT copied)
cd apps/web && pnpm install && cd ../..

# 2. run tests + typecheck
cd apps/web && npx vitest run && npx tsc --noEmit

# 3. dev server
cd apps/web && pnpm dev   # -> http://localhost:3000

# 4. python pipeline (SA3 venv is in THIS repo)
./stable-audio-3/.venv/Scripts/python.exe tools/jam_buddy.py --midi take.mid --instrument bass --out out.wav
```

## Docs (all in `docs/`)

- `01-vision.md` — Jam Buddy vision (rewritten from the old PatternTalk framing).
- `02-architecture.md` — note: may still describe the old service layout; the
  real arch is: Next.js web + `tools/jam_buddy.py` + SA3 venv.
- `05-accessibility.md` — the a11y strategy (still relevant; the product is
  screenreader-compatible by design).
- `06-stable-audio-integration.md` — SA3 setup, audio-to-audio, Vega notes.
- `HARNESS.md` — agent harness commands + test contract (may still say
  "PatternTalk" in places; the real product is Jam Buddy).

## What's deliberately NOT in this repo (and why)

- `text2midi/` (2.8G vendored model) — not part of the Jam Buddy product; it
  stays in the previous working dir if needed.
- The SA3 weights / `.venv` are inside `stable-audio-3/` here but **gitignored**
  (large, regenerable, license-gated). See `.gitignore`.
- `node_modules/`, `.next/` — regenerable, not committed.
- `generations/*.wav` — gitignored (regenerable output).
- Source song/GP files + scratch WAVs in the old `tools/` — not product source.

## Pending / next steps (from the last session)

1. **PLAY BOTH** — unbank / fix: the MIDI synth part wasn't audible. Likely the
   object URL or the oscillator gain. That's the "co-play" wow moment.
2. **Metadata sidecar** — add a `<file>.json` next to each `generations/*.wav`
   with prompt / negative / model / BPM / duration / source. Answers "what did it
   go off on."
3. **Re-render the docs** `02-architecture.md`, `03-data-model.md`,
   `04-ux-voice-first.md`, `07-reaper-integration.md` to match Jam Buddy (they
   still describe the old PatternTalk drum-machine in places).
4. **LoRA / underfit** (style trainer) is a real path but needs a GPU — not shipped.
5. **Demo script** — the judge's-eye review (session bg_161745) recommended a
   3-min demo script; see `docs/01-vision.md` "What success looks like".

## The judge's review (session `bg_161745` — hackathon judge design review)

Key finding: **docs and product were telling different stories** (PatternTalk vs
Jam Buddy). That's why this repo was consolidated to `stable-jam`. Scoring
rubric + recs live in that session. The #1 fix was "kill the PatternTalk framing"
— largely done in README + 01-vision; the deeper docs still need the same pass.

## The SA3 tempo/time-signature reality (don't re-learn it)

Stable Audio 3 has NO tempo or time-signature conditioning channel. "BPM" is a
weak semantic hint in the prompt. So "make SA3 follow a time signature" is not
possible with the stock model. The answer is MIDI-first (timing from MIDI/audio
detection) + SA3 as the timbre generator. Full reasoning is in the skill ref
`sa3-no-tempo-control.md`. The LoRA style path is separate.
