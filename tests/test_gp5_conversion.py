"""
Test suite for gp5_to_keyswitched_mid.py.

These tests catch the regressions that have burned us during the week:
- Wrong tempo (was off by 60,000,000/x)
- Wrong time signature (was 4/16 instead of 4/4)
- Missing keyswitches (SlideIn for grace notes, SlideUp/Down direction, etc.)
- Wrong channel assignments
- Empty intro bars (was 35-bar silent intro)
- Tied continuations cutting the note off mid-tail
- Wrong keyswitch note numbers (e.g., sustain colliding with slide-up)

To add a new scenario: re-run tests/record_expected.py after editing the
GP file, then commit the updated baseline.yaml. The test suite will
pick up the new expected counts automatically.
"""
import collections
import os
import subprocess
import sys

import mido
import pytest


# ---------------------------------------------------------------------------
# Re-run the script for each track before the tests run, so we have
# fresh MIDI files in the output directory. (The script regenerates
# everything on each run.)
# ---------------------------------------------------------------------------
def _regenerate(song_name, track_name, include_bass, midi_path=None):
    """Run the script for one track and confirm it produced output.

    `midi_path` is the expected output path; if the same track name
    appears more than once, the file has a " (N)" suffix and we need
    to disambiguate with --only-index.
    """
    parent = os.path.dirname(os.path.dirname(__file__))  # the repo root
    gp5 = os.path.join(parent, "gp5_songs", song_name + ".gp5")
    cmd = ["python", os.path.join(parent, "gp5_to_keyswitched_mid.py"),
           gp5, "-o", track_name]
    if include_bass:
        cmd.insert(4, "-b")
    # If the expected output uses the " (N)" suffix, multiple tracks
    # have the same name; find which occurrence this one is and pass
    # --only-index.
    if midi_path:
        import re as _re
        m = _re.search(r" \((\d+)\)_keyswitched\.mid$", midi_path)
        if m:
            cmd += ["--only-index", m.group(1)]
    result = subprocess.run(
        cmd, capture_output=True, text=True, cwd=parent,
    )
    if result.returncode != 0:
        pytest.fail(
            f"Script failed for {song_name}/{track_name}:\n"
            f"  rc={result.returncode}\n"
            f"  stderr={result.stderr}"
        )


_BASELINE_CACHE = {}


def pytest_generate_tests(metafunc):
    """Parametrize tests over (song, track) pairs from the baseline."""
    if "expected_track" in metafunc.fixturenames:
        baseline = _BASELINE_CACHE.get("data")
        if baseline is None:
            from pathlib import Path
            import yaml
            expected_path = (
                Path(__file__).resolve().parent / "expected" / "baseline.yaml"
            )
            if not expected_path.exists():
                return
            with open(expected_path) as f:
                baseline = yaml.safe_load(f)
            _BASELINE_CACHE["data"] = baseline
        pairs = []
        for song in baseline["songs"]:
            for track in song["tracks"]:
                pairs.append((song["source_gp5"], track["name"], track))
        metafunc.parametrize(
            "expected_track", pairs,
            ids=[f"{s[:20]}/{t['name']}" for s, _, t in pairs],
        )


# ---------------------------------------------------------------------------
# Helper: read a MIDI file and extract facts
# ---------------------------------------------------------------------------
def _keyswitch_counts(midi_path):
    """Return {note_name: count} for keyswitch notes in track 1."""
    note_names = {
        17: "SusDown", 18: "SusUp", 20: "PalmDown", 23: "B0(SlideDown)",
        24: "C1(SlideUp)", 26: "D1(Hammer)", 27: "D#1(SlideIn)",
        91: "Bend", 9: "Harm",
    }
    counts = collections.Counter()
    mid = mido.MidiFile(midi_path)
    if len(mid.tracks) < 2:
        return {}
    for msg in mid.tracks[1]:
        if (hasattr(msg, "channel") and msg.type == "note_on"
                and msg.velocity > 0):
            counts[note_names.get(msg.note, str(msg.note))] += 1
    return dict(counts)


def _first_event_tick(midi_path):
    mid = mido.MidiFile(midi_path)
    if len(mid.tracks) < 2:
        return None
    abs_t = 0
    for msg in mid.tracks[1]:
        abs_t += msg.time
        if (hasattr(msg, "channel") and msg.type == "note_on"
                and msg.velocity > 0):
            return abs_t
    return None


def _last_event_tick(midi_path):
    mid = mido.MidiFile(midi_path)
    if len(mid.tracks) < 2:
        return None
    abs_t = 0
    last = 0
    for msg in mid.tracks[1]:
        abs_t += msg.time
        if hasattr(msg, "channel"):
            last = abs_t
    return last


def _conductor(midi_path):
    mid = mido.MidiFile(midi_path)
    facts = {}
    if not mid.tracks:
        return facts
    for msg in mid.tracks[0]:
        if msg.type == "set_tempo":
            facts["tempo_bpm"] = round(60_000_000 / msg.tempo)
        elif msg.type == "time_signature":
            facts["numerator"] = msg.numerator
            facts["denominator"] = msg.denominator
    return facts


@pytest.fixture
def track_setup(expected_track):
    """Regenerate the MIDI for this track and return the expected dict."""
    gp5 = expected_track[0]
    track = expected_track[2]
    base = os.path.basename(gp5)
    song_name = os.path.splitext(base)[0]

    include_bass = track.get("include_bass", False)
    repo = os.path.dirname(os.path.dirname(__file__))
    expected_midi_relpath = track.get("midi_path", f"{song_name}/{track['name']}_keyswitched.mid")
    expected_midi_abs = os.path.join(repo, expected_midi_relpath)
    _regenerate(song_name, track["name"], include_bass,
                midi_path=expected_midi_relpath)
    return {
        "track": track,
        "song_name": song_name,
        "midi_path": expected_midi_abs,
        "include_bass": include_bass,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_conductor_tempo(track_setup):
    """The conductor track has the correct tempo."""
    expected = track_setup["track"]["conductor"]["tempo_bpm"]
    actual = _conductor(track_setup["midi_path"])["tempo_bpm"]
    assert actual == expected, (
        f"{track_setup['song_name']}/{track_setup['track']['name']}: "
        f"tempo {actual} BPM, expected {expected} BPM"
    )


def test_conductor_time_signature(track_setup):
    """The conductor track has the correct time signature."""
    expected = track_setup["track"]["conductor"]
    actual = _conductor(track_setup["midi_path"])
    assert actual["numerator"] == expected["numerator"], (
        f"{track_setup['song_name']}/{track_setup['track']['name']}: "
        f"numerator {actual['numerator']}, expected {expected['numerator']}"
    )
    assert actual["denominator"] == expected["denominator"], (
        f"{track_setup['song_name']}/{track_setup['track']['name']}: "
        f"denominator {actual['denominator']}, expected {expected['denominator']}"
    )


def test_first_event_at_tick_zero(track_setup):
    """The first note_on lands at tick 0 (no empty intro bars)."""
    actual = _first_event_tick(track_setup["midi_path"])
    assert actual == 0, (
        f"{track_setup['song_name']}/{track_setup['track']['name']}: "
        f"first note_on at tick {actual}, expected tick 0"
    )


def test_channel_preserved(track_setup):
    """The output channel matches the GP file's channel for this track."""
    # The channel is preserved in the expected metadata.
    # We just verify that the file has at least one note_on on the
    # expected channel. (PyGuitarPro channel 1-16 = MIDI 0-15.)
    expected_ch = track_setup["track"]["channel"]
    mid = mido.MidiFile(track_setup["midi_path"])
    if len(mid.tracks) < 2:
        pytest.skip("Track 1 missing")
    channels_seen = set()
    for msg in mid.tracks[1]:
        if hasattr(msg, "channel"):
            channels_seen.add(msg.channel)
    assert expected_ch in channels_seen, (
        f"{track_setup['song_name']}/{track_setup['track']['name']}: "
        f"expected channel {expected_ch} not used; saw {channels_seen}"
    )


def test_keyswitch_counts_exact(track_setup):
    """The keyswitch counts match the expected baseline exactly."""
    expected = track_setup["track"]["keyswitch_counts"]
    actual = _keyswitch_counts(track_setup["midi_path"])
    # Diff in both directions so we can see what's missing and what's extra.
    missing = {k: v for k, v in expected.items() if actual.get(k, 0) < v}
    extra = {k: v for k, v in actual.items() if expected.get(k, 0) < v}
    if missing or extra:
        msg = (f"{track_setup['song_name']}/{track_setup['track']['name']}: "
               f"keyswitch counts mismatch")
        if missing:
            msg += f"\n  Missing (expected but not emitted): {missing}"
        if extra:
            msg += f"\n  Extra (emitted but not expected): {extra}"
        pytest.fail(msg)


def test_total_keyswitch_count(track_setup):
    """The total number of keyswitches matches the expected total."""
    expected = sum(track_setup["track"]["keyswitch_counts"].values())
    actual = sum(_keyswitch_counts(track_setup["midi_path"]).values())
    assert actual == expected, (
        f"{track_setup['song_name']}/{track_setup['track']['name']}: "
        f"total keyswitches {actual}, expected {expected}"
    )


def test_no_empty_track(track_setup):
    """The exported MIDI is not an empty placeholder (54 bytes)."""
    size = os.path.getsize(track_setup["midi_path"])
    assert size > 100, (
        f"{track_setup['song_name']}/{track_setup['track']['name']}: "
        f"MIDI is only {size} bytes (likely empty/placeholder)"
    )


def test_track_count(track_setup):
    """The exported MIDI has exactly 2 tracks (conductor + audio)."""
    mid = mido.MidiFile(track_setup["midi_path"])
    assert len(mid.tracks) == 2, (
        f"{track_setup['song_name']}/{track_setup['track']['name']}: "
        f"expected 2 tracks, got {len(mid.tracks)}"
    )


def test_midi_type_1(track_setup):
    """The exported MIDI is a Type 1 file (multi-track)."""
    mid = mido.MidiFile(track_setup["midi_path"])
    assert mid.type == 1, (
        f"{track_setup['song_name']}/{track_setup['track']['name']}: "
        f"expected Type 1, got Type {mid.type}"
    )


def test_ticks_per_beat(track_setup):
    """The MIDI uses 960 ticks per beat (matches PyGuitarPro resolution)."""
    mid = mido.MidiFile(track_setup["midi_path"])
    assert mid.ticks_per_beat == 960, (
        f"{track_setup['song_name']}/{track_setup['track']['name']}: "
        f"expected 960 ticks/beat, got {mid.ticks_per_beat}"
    )
