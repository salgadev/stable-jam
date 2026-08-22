# stable-jam — Agent Harness

**Jam Buddy** — "you start playing, it joins in." An AI music companion for the
**Music Hackspace Montreal** hackathon (Aug 22–23, 2026, Stability AI challenge).
A Next.js web rack + a Python SA3 pipeline that listens to a MIDI or audio take
and responds at your tempo in the instrument you pick.

## Roles

- **Web app** — `apps/web/` (Next.js + TS + Tailwind + Vitest). The hardware
  sampler rack: instrument pads, genre/mood/tempo knobs, MIDI/audio take input,
  JOIN IN + PLAY BOTH, status panel, and `generations/` output.
- **SA3 pipeline** — `tools/jam_buddy.py` (Python). Detects tempo + duration
  from a MIDI take (or runs audio-to-audio from a WAV), builds the SA3 prompt
  from the knobs, generates the response WAV via the `stable-audio-3` venv.
- **Prompt builder** — `apps/web/lib/jambuddy/prompt.ts` (pure, tested).
- **Player** — `apps/web/lib/jambuddy/player.ts` (Web Audio; play take + buddy
  together). Note: PLAY BOTH is banked / not fully debugged.
- **Legacy converters** — `gp5_to_keyswitched_mid.py` / `midi_to_gp5.py` /
  `midjson_to_mid.py` (GP5↔MIDI tooling from the earlier iteration, still present).

## Commands

```bash
# Web app (node_modules NOT committed — install first)
cd apps/web && pnpm install && npx vitest run      # 31 tests
cd apps/web && npx tsc --noEmit                     # typecheck
pnpm dev                                            # local Next.js server -> :3000

# Python pipeline (uses the SA3 venv in the OLD repo, NOT here)
JAM_BUDDY_PYTHON=/d/CODE/unstable-drums/stable-audio-3/.venv/Scripts/python.exe \
  python3 tools/jam_buddy.py --midi take.mid --instrument bass --out out.wav

# Conversion CLIs (if needed)
python gp5_to_keyswitched_mid.py path/to/song.gp5
```

## Test contract

- Web: `apps/web/__tests__/` — `prompt.test.ts` (prompt builder),
  `player.test.ts` (midi parsing/player), `engine.test.ts`, `conversation.test.ts`.
- Python: `tests/` — GP5 conversion against `tests/expected/baseline.yaml`.

## Conventions

- TS for web, Python 3.10+ for audio/conversion.
- Accessibility-first (screenreader-native): axe-core, NVDA + VoiceOver checks.
- Conventional Commits, `feat/*`/`fix/*`/`docs/*`/`chore/*` branches.

## Not-in-git (deliberately)

- `stable-audio-3/` + `text2midi/` (vendored models) live in the previous dir;
  referenced via `JAM_BUDDY_PYTHON`. Don't copy them into this repo.
- `node_modules/`, `.next/`, `generations/*.wav` — regenerable.

See `docs/HANDOFF.md` for the full resume guide and current product state.
