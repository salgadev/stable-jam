# Test harness for gp5_to_keyswitched_mid.py

This directory holds the test suite that validates the Guitar Pro 5 → keyswitched MIDI conversion script. The goal is to catch regressions before they break a recording session.

## What it tests

For each track in each song, the suite verifies:

1. **Conductor tempo** — must match the source GP file's BPM (was off by 60,000,000÷x in earlier versions).
2. **Conductor time signature** — must be 4/4 for the test corpus (was 4/16 when we read the wrong field).
3. **First event at tick 0** — no empty intro bars (the 35-bar silent intro was a real bug).
4. **Channel preserved** — output channel matches the GP file's channel assignment.
5. **Keyswitch counts exact** — every PalmDown, SlideIn, SlideUp, SlideDown, Hammer, Bend, Harm, Sustain key counted and matched against the baseline.
6. **Total keyswitchs** — sanity check on the count.
7. **Not empty** — placeholder MIDIs (54 bytes) are rejected.
8. **Track count** — exactly 2 tracks (conductor + audio).
9. **MIDI Type 1** — multi-track format.
10. **960 ticks per beat** — matches PyGuitarPro's resolution.

## How to run

```bash
cd D:/CODE/unstable-drums
python -m pytest tests/
```

A clean run takes ~2 minutes (the script regenerates every track). A focused run with `-k`:

```bash
python -m pytest tests/ -k "Dany_Rhythm_Guitar"
```

## How to add a new song

1. Copy the GP5 file into `D:/CODE/unstable-drums/gp5_songs/`.
2. Re-run the baseline recorder:
   ```bash
   python tests/record_expected.py
   ```
   This regenerates `tests/expected/baseline.yaml` with the current script's output.
3. Inspect the YAML to confirm the keyswitch counts and structural facts look right.
4. Commit the updated baseline.yaml.

## How to add a new test scenario

If you find a new edge case (e.g., a new articulation the script doesn't handle yet), add a test function to `tests/test_gp5_conversion.py` and re-run the suite. The test should run against every track in the baseline. Example:

```python
def test_my_new_scenario(track_setup):
    """Every track should have ... whatever."""
    actual = ...
    expected = ...
    assert actual == expected, f"{track_setup['song_name']}/{...}"
```

The new test runs against every (song, track) pair automatically — no need to parametrize manually.

## How to update the baseline

The baseline is the *contract*. When you fix the GP file (e.g., add 5 more grace notes), the baseline's keyswitch counts become stale. Re-run `record_expected.py` to update them, then commit the new YAML.

The expected YAML is **not** a measurement of "what the script does" — it's a measurement of "what the script should do, given the user's intent for the GP file." If you change the GP file on purpose, you update the baseline on purpose.

## How the script handles things

The script writes outputs to subfolders named after the song:
- `D:/CODE/unstable-drums/The Summoning Aug 2026/*.mid`
- `D:/CODE/unstable-drums/Sacrifice ReDrum Full v2 gracenotes/*.mid`

These directories are gitignored. The test suite regenerates them on every run.

## How regressions are caught

The tests re-run the script for every track before testing. If a code change breaks the keyswitch counts, the test fails with a clear message like:

```
Sacrifice ReDrum Full v2 gracenotes/Dany Rhythm Guitar: keyswitch counts mismatch
  Missing (expected but not emitted): {'PalmDown': 2}
  Extra (emitted but not expected): {'C1(SlideUp)': 2}
```

That tells you exactly which song, which track, and which keyswitch is wrong.

## When the test fails for a "good" reason

If the user changes the GP file deliberately, the baseline is stale. Run `python tests/record_expected.py` to refresh the baseline, review the diff, and commit.

If the test fails because the script has a bug, fix the script and re-run the tests. The baseline shouldn't change for a bug fix.
