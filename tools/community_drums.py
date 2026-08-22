#!/usr/bin/env python3
"""
Community-mode v0: DI guitar -> tempo map + onset alignment -> drum MIDI.

Takes a DI guitar track and a (notated) tempo/time-map MIDI, builds a
quarter-note beat grid from the tempo curve, nudges each beat to the nearest
detected onset so the drums follow the band's real timing, places a drum
pattern on those beats, and writes a MIDI file (tempo + time sig + ch10
percussion).

Patterns:
  blast       kick+hat every 16th, snare on 2 & 4
  dbeat       kick every 16th, snare on 2 & (3-and), hat on 8ths (1 & 3)
  double      kick every 16th, snare on 2 & 4, hat on 8ths
  groove      kick 1 & 3, snare 2 & 4, hat 8ths (rock beat)
"""
import argparse

import librosa
import mido
import numpy as np

# General MIDI drum notes
KICK = 36
SNARE = 38
HIHAT = 42
CRASH = 49


# ---------------------------------------------------------------------------
# Tempo map from the MIDI time file -> absolute seconds
# ---------------------------------------------------------------------------
def tempo_map_from_midi(path):
    """Return ([(sec, bpm), ...] in order, default_bpm)."""
    mid = mido.MidiFile(path)
    tpb = mid.ticks_per_beat or 480

    # collect (abs_tick, us) tempo changes and (abs_tick, num, den) sigs
    tempo_pts = []
    tsig_pts = []
    running_us = 500000
    abs_tick = 0
    for track in mid.tracks:
        for msg in track:
            abs_tick += msg.time
            if msg.type == "set_tempo":
                running_us = msg.tempo
                tempo_pts.append((abs_tick, running_us))
            elif msg.type == "time_signature":
                tsig_pts.append((abs_tick, msg.numerator, msg.denominator))

    if not tempo_pts:
        return [(0.0, 120.0)], 120.0

    tempo_pts.sort()
    # walk ticks -> seconds using the tempo in effect between anchors
    events = []
    cur_sec = 0.0
    cur_tick = 0
    cur_us = tempo_pts[0][1]
    for tk, us in tempo_pts:
        d_beat = (tk - cur_tick) / tpb
        cur_sec += d_beat * (cur_us / 1e6)
        cur_tick = tk
        cur_us = us
        events.append((cur_sec, round(60e6 / us)))
    return events, round(60e6 / tempo_pts[0][1])


# ---------------------------------------------------------------------------
# Build a quarter-note grid from the tempo curve
# ---------------------------------------------------------------------------
def build_beat_grid(tempo_events, total_sec):
    """Return sorted list of quarter-beat times (sec) over [0, total_sec]."""
    # linear scan: current tempo changes at each event time
    beats = []
    t = 0.0
    idx = 0
    while t < total_sec:
        beats.append(t)
        # tempo currently in effect
        while idx < len(tempo_events) - 1 and tempo_events[idx + 1][0] <= t:
            idx += 1
        bpm = tempo_events[idx][1]
        q = 60.0 / bpm
        t += q
        if q <= 0:
            break
    return beats


# ---------------------------------------------------------------------------
# Onset alignment
# ---------------------------------------------------------------------------
def onset_align(onset_env, sr, hop, beat_times):
    """Nudge each beat to the local onset-strength peak within +/-120ms."""
    win = int(0.12 * sr / hop)
    aligned = []
    for sec in beat_times:
        b = int(round(sec * sr / hop))
        lo = max(0, b - win)
        hi = min(len(onset_env), b + win + 1)
        if hi <= lo:
            aligned.append(b)
            continue
        peak = int(np.argmax(onset_env[lo:hi])) + lo
        aligned.append(peak)
    return librosa.frames_to_time(aligned, sr=sr, hop_length=hop)


# ---------------------------------------------------------------------------
# Pattern placement
# ---------------------------------------------------------------------------
def place_pattern(kind, beat_times, bpm_curve_at):
    """Return list of (sec, note, velocity)."""
    hits = []
    for i, t0 in enumerate(beat_times):
        beat_in_bar = i % 4
        cur_bpm = bpm_curve_at(t0)
        # subdivision 16ths
        for sub in range(4):
            tsub = t0 + sub * (60.0 / cur_bpm) / 4
            if kind in ("blast", "double_beat"):
                # kick on every 16th
                hits.append((tsub, KICK, 95))
                # hat on every 16th
                hits.append((tsub, HIHAT, 80))
            elif kind == "dbeat":
                hits.append((tsub, KICK, 95))
                hits.append((tsub, HIHAT if sub % 2 == 0 else SNARE, 80))
            else:  # groove
                if sub == 0:
                    hits.append((tsub, KICK, 95))
        # snare on beats 2 & 4 (bar positions 1 and 3)
        if beat_in_bar in (1, 3):
            hits.append((t0, SNARE, 100))
    return hits


# ---------------------------------------------------------------------------
# MIDI write
# ---------------------------------------------------------------------------
def sec_to_tick(s, tempo_events, tpb=960):
    """Absolute tick at time s, integrating the running tempo.

    tempo_events = [(sec0, bpm0), (sec1, bpm1), ...] where the tempo changes
    to bpm_i at sec_i. Tempo bpm_i applies over [sec_i, sec_{i+1}). The first
    event is normally at sec 0.
    """
    times = [sec for sec, _ in tempo_events]
    bpms = [bpm for _, bpm in tempo_events]
    # clamp s to the map range (never past the last change's tempo)
    if not times:
        return int(round(s * bpms[0] * tpb / 60)) if bpms else 0
    # find active segment index i: times[i] <= s < times[i+1]
    i = 0
    while i < len(times) - 1 and times[i + 1] <= s:
        i += 1
    # sum full prior segments + partial within segment i
    ticks = 0.0
    for j in range(i):
        ticks += (times[j + 1] - times[j]) * bpms[j] * tpb / 60
    ticks += (s - times[i]) * bpms[i] * tpb / 60
    return int(round(ticks))


def write_midi(out, tempo_events, tsig, hits, tpb=960):
    mid = mido.MidiFile(ticks_per_beat=tpb)

    # tempo track
    tt = mido.MidiTrack()
    mid.tracks.append(tt)
    num, den = tsig
    tt.append(mido.MetaMessage("time_signature", numerator=num,
                               denominator=den, time=0))
    # tempo events: absolute ticks via integration; delta between events
    prev_tick = 0
    for sec, bpm in tempo_events:
        us = int(round(60e6 / bpm))
        ticks = sec_to_tick(sec, tempo_events, tpb)
        tt.append(mido.MetaMessage("set_tempo", tempo=us,
                                   time=max(0, ticks - prev_tick)))
        prev_tick = ticks

    # percussion track
    pt = mido.MidiTrack()
    mid.tracks.append(pt)

    # group same-tick hits into chords, emit note_on with delta times
    grouped = {}
    for sec, note, vel in hits:
        tk = sec_to_tick(sec, tempo_events, tpb)
        grouped.setdefault(tk, []).append((note, vel))

    prev_tick = 0
    for tk in sorted(grouped):
        dt = tk - prev_tick
        prev_tick = tk
        for j, (note, vel) in enumerate(grouped[tk]):
            # first note in the chord carries the delta; rest are time=0
            pt.append(mido.Message("note_on", note=note, velocity=vel,
                                   time=dt if j == 0 else 0))
            pt.append(mido.Message("note_off", note=note, velocity=0, time=0))
    mid.save(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--wav", required=True)
    ap.add_argument("--midi", help="tempo/time-map MIDI")
    ap.add_argument("--pattern", default="blast",
                    choices=["blast", "double_beat", "dbeat", "groove"])
    ap.add_argument("--out", default="community_drums.mid")
    args = ap.parse_args()

    print(f"Loading {args.wav} ...")
    y, sr = librosa.load(args.wav, sr=22050, mono=True)
    total_sec = len(y) / sr

    if args.midi:
        tempo_events, default_bpm = tempo_map_from_midi(args.midi)
        print(f"  tempo map: {len(tempo_events)} events, first {default_bpm} BPM")
    else:
        tempo_events, default_bpm = [(0.0, 120.0)], 120.0
        print("  no --midi; using fixed 120 BPM")

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    print("  building grid ...")
    grid = build_beat_grid(tempo_events, total_sec)
    aligned = onset_align(onset_env, sr, 512, grid)
    print(f"  grid {len(grid)} beats, aligned {len(aligned)}")

    # bpm curve function
    def bpm_at(t):
        best = tempo_events[0][1]
        for sec, b in tempo_events:
            if t >= sec:
                best = b
        return best

    hits = place_pattern(args.pattern, aligned, bpm_at)
    print(f"  {len(hits)} drum hits")
    write_midi(args.out, tempo_events, (4, 4), hits)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
