#!/usr/bin/env python3
"""
Record the current script's output as a baseline YAML.

Run this once to create the expected/ files. Re-run only when the user's
contract changes (i.e., when they edit the .gp5 files and want the new
expected counts). NOT part of the test suite itself.
"""
import os
import sys
import collections
import subprocess

import mido
import yaml


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GP5_DIR = os.path.join(REPO_ROOT, "gp5_songs")
EXPECTED_DIR = os.path.join(os.path.dirname(__file__), "expected")
SCRIPT = os.path.join(REPO_ROOT, "gp5_to_keyswitched_mid.py")

NOTE_NAMES = {
    17: "SusDown", 18: "SusUp", 20: "PalmDown", 23: "B0(SlideDown)",
    24: "C1(SlideUp)", 26: "D1(Hammer)", 27: "D#1(SlideIn)", 91: "Bend",
    9: "Harm",
}


def keyswitch_counts(midi_path):
    counts = collections.Counter()
    mids = mido.MidiFile(midi_path)
    if len(mids.tracks) < 2:
        return {}
    for msg in mids.tracks[1]:
        if hasattr(msg, "channel") and msg.type == "note_on" and msg.velocity > 0:
            counts[msg.note] += 1
    return {NOTE_NAMES.get(n, str(n)): c for n, c in sorted(counts.items())}


def conductor_facts(midi_path):
    mids = mido.MidiFile(midi_path)
    if not mids.tracks:
        return {}
    facts = {}
    for msg in mids.tracks[0]:
        if msg.type == "set_tempo":
            facts["tempo_bpm"] = round(60_000_000 / msg.tempo)
        elif msg.type == "time_signature":
            facts["numerator"] = msg.numerator
            facts["denominator"] = msg.denominator
    return facts


def first_event_tick(midi_path):
    mid = mido.MidiFile(midi_path)
    if len(mid.tracks) < 2:
        return None
    abs_t = 0
    for msg in mid.tracks[1]:
        abs_t += msg.time
        if hasattr(msg, "channel") and msg.type == "note_on" and msg.velocity > 0:
            return abs_t
    return None


def last_event_tick(midi_path):
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


def track_is_bass(track_name):
    return "bass" in track_name.lower()


def song_block(gp5_filename):
    """Run the script for each track in the song and return the expected data."""
    gp5_path = os.path.join(GP5_DIR, gp5_filename)
    song_name = os.path.splitext(gp5_filename)[0]
    songs_subdir = os.path.join(REPO_ROOT, song_name)

    # First pass: run the script for each track to populate the output dir.
    # We always pass --only "<track>" to get a single output file per run.
    track_names = []
    # We need to know the track names. Run the script once in verbose mode
    # and parse the printed output for the list of tracks.
    proc = subprocess.run(
        ["python", SCRIPT, gp5_path],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    # Lines like "  Track Name  [track:Track Name] channel N"
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("Skipped") or line.startswith("OK:"):
            continue
        if "No guitar" in line:
            continue
        if line.startswith("["):
            continue
        if "[track:" in line:
            name = line.split("[track:")[0].strip()
            channel = int(line.split("channel")[-1].strip())
            track_names.append((name, channel))

    tracks_expected = []
    for idx, (name, channel) in enumerate(track_names):
        is_bass = track_is_bass(name)
        # Re-run for this specific track. If the same name appears more
        # than once, use --only-index to disambiguate.
        cmd = ["python", SCRIPT, gp5_path, "-o", name, "-q"]
        if is_bass:
            cmd.insert(4, "-b")
        same_name_count = sum(1 for n, _ in track_names if n == name)
        if same_name_count > 1:
            # 1-based index of this occurrence.
            only_index = sum(1 for n, _ in track_names[:idx] if n == name) + 1
            cmd += ["--only-index", str(only_index)]
        try:
            subprocess.run(cmd, check=True, cwd=REPO_ROOT)
        except subprocess.CalledProcessError:
            # The run may have produced a multi-track file when
            # only-index wasn't applied. Skip this track.
            print(f"  WARN: {name} (index {idx}) export failed, skipping",
                  file=sys.stderr)
            continue

        # Sanity: the output file should exist. With --only-index, the
        # filename gets a " (N)" suffix when there are multiple matches.
        midi_path = os.path.join(songs_subdir, f"{name}_keyswitched.mid")
        candidate_paths = [midi_path]
        if same_name_count > 1:
            only_index = sum(1 for n, _ in track_names[:idx] if n == name) + 1
            candidate_paths.insert(0, os.path.join(
                songs_subdir, f"{name} ({only_index})_keyswitched.mid"))
        actual_midi_path = None
        for p in candidate_paths:
            if os.path.exists(p):
                actual_midi_path = p
                break
        if actual_midi_path is None:
            print(f"  WARN: expected output missing for {name} (index {idx})",
                  file=sys.stderr)
            continue

        tracks_expected.append({
            "name": name,
            "channel": channel,
            "include_bass": is_bass,
            "midi_path": f"{song_name}/{os.path.basename(actual_midi_path)}",
            "conductor": conductor_facts(actual_midi_path),
            "first_event_tick": first_event_tick(actual_midi_path),
            "last_event_tick": last_event_tick(actual_midi_path),
            "keyswitch_counts": keyswitch_counts(actual_midi_path),
        })

    return {
        "source_gp5": gp5_filename,
        "songs_subdir": song_name,
        "tracks": tracks_expected,
    }


def main():
    gp5_files = sorted(f for f in os.listdir(GP5_DIR) if f.endswith(".gp5"))
    expected = {"songs": [song_block(gp5) for gp5 in gp5_files]}
    out_path = os.path.join(EXPECTED_DIR, "baseline.yaml")
    with open(out_path, "w") as f:
        yaml.dump(expected, f, sort_keys=False, default_flow_style=False)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
