# PatternTalk — Agent Harness

Voice-first, screenreader-compatible AI drum machine for the **Music Hackspace
Montreal** hackathon (Aug 22–23, 2026, Stability AI challenge). This is the
working harness: the GP5↔MIDI conversion pipeline that turns band Guitar Pro
files into Sforzando keyswitched MIDI, plus the Next.js pattern web app.

## Roles

- **Web app** — `apps/web/` (Next.js + TS + Tailwind + Vitest). Pattern engine,
  voice conversation, onomatopoeia → MIDI.
- **GP5 → keyswitched MIDI** — `gp5_to_keyswitched_mid.py` (Python). Reads a
  `.gp5`, detects articulations (palm mute, staccato, harmonics…), emits a
  keyswitched MIDI per track for Sforzando.
- **MIDI → GP5 (reverse)** — `midi_to_gp5.py` (Python). Inverse: infers
  technique from the keyswitch note preceding each pitched note. Mirror of the
  forward script; see `MIDI_TO_GP5.md`.
- **Event trace** — `midjson_to_mid.py` / `gp_to_keyswitched_mid.js` produce
  `fallen_events.json`, `summoning_js_events.json` event traces for debugging.
- **Vendored model repo** — `text2midi/` (2.8 GB clone, NOT part of this
  project). If you need it, it's a separate git repo with its own `.venv`.

## Commands

```bash
# Python conversion harness (140 tests) — unset PYTHONPATH/VIRTUAL_ENV/SSL_CERT_FILE first
python -m pytest tests/ -q                  # 140 tests against tests/expected/baseline.yaml
python tests/record_expected.py             # regenerate baseline.yaml when converter contract changes

# Web app
cd apps/web && npx vitest run               # 22 tests (engine + conversation)
pnpm dev                                    # local Next.js server

# Conversion CLI
python gp5_to_keyswitched_mid.py path/to/song.gp5            # → keyswitched MIDI per track
python gp5_to_keyswitched_mid.py path/to/song.gp5 output.mid # explicit output
python gp5_to_keyswitched_mid.py song.gp5 -b                 # also process bass
python gp5_to_keyswitched_mid.py song.gp5 -V 100 -r          # velocity 100, sustain reset
```

## Test golden-file contract

- Canonical corpus: `gp5_songs/` (Altars, Sacrifice, The) — **deliberately not
  in git**. The committed `tests/expected/baseline.yaml` encodes the expected
  output so the converter can be validated against a fixed contract without the
  source files.
- `tests/fixtures/` holds scratch GP5 files (also not in git) for one-off
  converter experiments.
- When the converter contract intentionally changes: run
  `python tests/record_expected.py` to regenerate the baseline, then review the
  diff carefully. Never blanket-regenerate to hide a regression.

## Conventions

- TS for web, Python 3.10+ for conversion/audio, JSON for pattern templates.
- Python: ruff lint, black format, type hints, Pydantic for data models.
- TS: ESLint + Prettier, no `any` unless commented, no `useEffect` for derived
  state.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`), branches
  `feat/*`, `fix/*`, `docs/*`, `chore/*`.
- Accessibility-first (this is a screenreader-native product): axe-core in CI,
  NVDA + VoiceOver manual checks before each demo.

## Scratch / not-in-git

- `*.gp5`, `*.gp`, `gp5_songs/`, `tests/fixtures/`, `fallen_events.json`,
  `summoning_js_events.json`, `text2midi/` are all gitignored.
- Song source data stays local. Only baseline + code + docs are committed.
