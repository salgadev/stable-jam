#!/usr/bin/env python3
"""Build a clean half-time drum MIDI for Hextermination's opening.

Opening section (per Carlos):
  3 bars of 4/4, then 2 bars of 3/4.
  Always starts with kick on the downbeat.
  Half-time feel.

Groove per bar:
  - kick on beat 1 (downbeat)
  - snare on beat 3 (half-time backbeat)
  - hi-hat on every 8th note
"""
import argparse

import mido

KICK, SNARE, HIHAT = 36, 38, 42
Q = 960  # quarter-note ticks


def build(bpm, q=Q):
    mid = mido.MidiFile(ticks_per_beat=q)
    tempo_us = int(round(60e6 / bpm))
    eighth = q // 2

    # tempo + time-signature track
    tt = mido.MidiTrack()
    mid.tracks.append(tt)
    tt.append(mido.MetaMessage("set_tempo", tempo=tempo_us, time=0))

    # 3 bars 4/4, then 2 bars 3/4
    sigs = [(4, 4)] * 3 + [(3, 4)] * 2

    # absolute start tick of each bar
    starts = []
    acc = 0
    for num, _ in sigs:
        starts.append(acc)
        acc += num * q

    # time signatures, as deltas
    prev_tick = 0
    for (num, den), st in zip(sigs, starts):
        tt.append(mido.MetaMessage("time_signature", numerator=num,
                                   denominator=den, time=st - prev_tick))
        prev_tick = st

    # percussion track, one continuous stream of (abs_tick, note)
    pt = mido.MidiTrack()
    mid.tracks.append(pt)
    all_hits = []
    for bar_idx, ((num, _), st) in enumerate(zip(sigs, starts)):
        all_hits.append((st, KICK))                # downbeat kick
        all_hits.append((st + 2 * q, SNARE))          # snare on beat 3
        for e in range(num * 2):                       # 8th notes
            all_hits.append((st + e * eighth, HIHAT))
    all_hits.sort()
    prev = 0
    for tick, note in all_hits:
        pt.append(mido.Message("note_on", note=note, velocity=100,
                               time=tick - prev))
        pt.append(mido.Message("note_off", note=note, velocity=0, time=0))
        prev = tick
    return mid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--bpm", type=float, default=117)
    args = ap.parse_args()
    build(args.bpm).save(args.out)
    print(f"Wrote {args.out}: 3x4/4 + 2x3/4, half-time, {args.bpm} BPM")


if __name__ == "__main__":
    main()
