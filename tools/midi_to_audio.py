#!/usr/bin/env python3
"""
Path 2 sampler: render aligned drum MIDI into audio using SA3 one-shots.

MIDI = perfect alignment to the guitar's real pulses (the aligned grid).
SA3 one-shots = produced drum sound. Placing one-shots at MIDI hit times
gives you both: drums that lock to the guitar AND sound produced.

Reads a drum MIDI (ch10 percussion), maps notes to kick/snare/hat one-shots,
places them at the exact hit times, and optionally mixes the result over the
guitar reference.

Usage:
  .venv/Scripts/python.exe tools/midi_to_audio.py \
      --midi demos/tupatutupatututata.mid \
      --oneshots tools/oneshots \
      --bpm 184 --out drums.wav
  # add --guitar ref.wav to mix drums under the guitar
"""
import argparse
import os

import mido
import numpy as np
import soundfile as sf

SR = 44100
# GM note -> one-shot file (extensionless)
NOTE_MAP = {36: "kick", 38: "snare", 42: "hat", 46: "hat"}


def load_oneshots(dirpath):
    shots = {}
    for name in ["kick", "snare", "hat"]:
        y, sr = sf.read(os.path.join(dirpath, f"{name}.wav"))
        if y.ndim > 1:
            y = y.mean(axis=1)
        shots[name] = y.astype(np.float32)
    return shots, sr


def midi_hits(mid_path, tpb=960):
    """Return list of (abs_beat, note) from the percussion track."""
    mid = mido.MidiFile(mid_path)
    pt = mid.tracks[-1]  # percussion track
    hits = []
    t = 0
    for msg in pt:
        t += msg.time
        if msg.type == "note_on" and msg.velocity > 0:
            hits.append((t / tpb, msg.note))
    return hits


def render(hits, shots, bpm, total_sec, guitar=None):
    """Place one-shots at hit times (beats -> sec at tempo map), mix guitar."""
    n = int(total_sec * SR)
    out = np.zeros(n, dtype=np.float32)
    for beat, note in hits:
        name = NOTE_MAP.get(note)
        if name is None:
            continue
        sample = shots[name]
        sec = beat * 60.0 / bpm
        start = int(sec * SR)
        end = min(n, start + len(sample))
        if start >= n:
            continue
        out[start:end] += sample[: end - start]
    # clip
    peak = np.abs(out).max()
    if peak > 1.0:
        out = out / peak
    if guitar is not None:
        g = guitar[:n]
        # mix: drums prominent, guitar underneath
        out = 0.9 * out + 0.35 * g
        if np.abs(out).max() > 1.0:
            out = out / np.abs(out).max()
    return out


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--midi", required=True)
    ap.add_argument("--oneshots", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bpm", type=float, default=184)
    ap.add_argument("--guitar", default=None)
    ap.add_argument("--dur", type=float, default=30.0)
    args = ap.parse_args()

    shots, sr = load_oneshots(args.oneshots)
    hits = midi_hits(args.midi)
    print(f"{len(hits)} MIDI hits")

    lead = None
    if args.guitar and os.path.exists(args.guitar):
        lead, _ = sf.read(args.guitar)
        if lead.ndim > 1:
            lead = lead.mean(axis=1)
        lead = lead.astype(np.float32)
        print(f"  mixing guitar {args.guitar} ({len(lead)/sr:.1f}s)")

    total = args.dur if lead is None else len(lead) / sr
    out = render(hits, shots, args.bpm, total, lead)
    sf.write(args.out, out, SR)
    print(f"Wrote {args.out}: {len(out)/SR:.1f}s")


if __name__ == "__main__":
    main()
