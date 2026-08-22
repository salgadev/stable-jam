"""
pytest fixtures for the gp5_to_keyswitched_mid test suite.

The test corpus is two Guitar Pro 5 files in D:/CODE/unstable-drums/gp5_songs/. The expected
output (keyswitch counts, channel assignments, structural facts) is
encoded in tests/expected/baseline.yaml. The GP files themselves are NOT
in git (user's preference); the baseline is committed so the script can
be re-run and validated against a fixed contract.
"""
import os
from pathlib import Path

import mido
import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
GP5_DIR = REPO_ROOT / "gp5_songs"
EXPECTED_PATH = Path(__file__).resolve().parent / "expected" / "baseline.yaml"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def baseline():
    """Load the expected baseline YAML once per test session."""
    if not EXPECTED_PATH.exists():
        pytest.skip(
            f"baseline.yaml not found at {EXPECTED_PATH}. "
            "Run tests/record_expected.py to generate it."
        )
    with open(EXPECTED_PATH) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Parametrize IDs (positive and negative lookups)
# ---------------------------------------------------------------------------
SCRIPT_PATH = REPO_ROOT / "gp5_to_keyswitched_mid.py"


def _script_path():
    """Return the path to the script under test."""
    return str(SCRIPT_PATH)


def _gp5_path_for_song(song_name):
    """Return the absolute path to the GP5 file for a given song."""
    # Match the source_gp5 filename in the baseline.
    for gp5 in GP5_DIR.glob("*.gp5"):
        if gp5.stem == song_name:
            return str(gp5)
    raise FileNotFoundError(f"No GP5 file for song '{song_name}'")


def _exported_midi_path(song_name, track_name):
    """Return the absolute path to the MIDI produced by the script."""
    return str(REPO_ROOT / song_name / f"{track_name}_keyswitched.mid")


# ---------------------------------------------------------------------------
# Parametrize over every (song, track) pair in the baseline
# ---------------------------------------------------------------------------
def _all_track_pairs(baseline):
    pairs = []
    for song in baseline["songs"]:
        for track in song["tracks"]:
            pairs.append((song["source_gp5"], track["name"], track))
    return pairs


def _track_param(baseline):
    """Yields (gp5, track_name, expected_track_dict) for every track."""
    return _all_track_pairs(baseline)
