#!/usr/bin/env python3
"""Feasibility spike: can we detect the tempo curve + onsets on a real DI track?

Runs librosa onset detection + frame-wise tempo on the DI WAV and compares
against the notated tempo from the MIDI time map (if given).
"""
import argparse
import sys

import librosa
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav", help="DI track WAV path")
    ap.add_argument("--sr", type=int, default=22050, help="resample target")
    args = ap.parse_args()

    print(f"Loading {args.wav} ...")
    y, sr = librosa.load(args.wav, sr=args.sr, mono=True)
    dur = len(y) / sr
    print(f"  duration {dur:.1f}s, sr {sr}, samples {len(y)}")

    # --- 1. Onset strength envelope ---
    print("\n[onset] detecting onset strength ...")
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr,
                                        units="time", backtrack=True)
    print(f"  {len(onsets)} onsets")
    # onset rate (hits/sec) -> coarse BPM indicator
    if len(onsets) > 1:
        inter = np.diff(onsets)
        inter = inter[inter > 0.08]  # ignore sub-80ms jitter
        if len(inter):
            rate = 60.0 / np.median(inter)
            print(f"  median inter-onset {np.median(inter):.3f}s -> ~{rate:.1f} BPM")

    # --- 2. Frame-wise tempo curve ---
    print("\n[tempo] frame-wise tempo curve ...")
    tempo_out = librosa.feature.tempo(
        onset_envelope=onset_env, sr=sr, aggregate=None,
    )
    # some librosa builds return a scalar when aggregate=None; wrap if needed
    if np.isscalar(tempo_out) or (np.ndim(tempo_out) == 0):
        tempo_curve = np.full(onset_env.shape[-1], float(tempo_out))
    else:
        tempo_curve = np.asarray(tempo_out).reshape(-1)
    hop = librosa.get_hop_length() if hasattr(librosa, "get_hop_length") else 512
    frame_dur = hop / sr
    n = len(tempo_curve)
    # Robust per-window median in 4s windows
    win = max(1, int(4.0 / frame_dur))
    print(f"  {n} frames, frame {frame_dur:.2f}s")
    t = 0.0
    i = 0
    print("\n  time(s)  ~BPM(median 4s window)")
    seen = []
    while i < n:
        w = tempo_curve[i:i + win]
        med = float(np.median(w[np.isfinite(w)])) if np.any(np.isfinite(w)) else float("nan")
        t = i * frame_dur
        seen.append((t, med))
        print(f"  {t:7.1f}   {med:6.1f}")
        i += win
    # distinct tempo regimes
    uniq = sorted(set(round(m) for _, m in seen if np.isfinite(m)))
    print("\n  distinct ~tempo values:", uniq)

    # --- 3. Beat tracking (librosa default) ---
    print("\n[beat] beat_track ...")
    tempo_est, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
    if np.ndim(tempo_est):
        tempo_est = float(np.median(np.asarray(tempo_est)))
    beat_times = librosa.frames_to_time(beats, sr=sr)
    print(f"  est BPM {float(tempo_est):.1f}, {len(beat_times)} beats")
    if len(beat_times) > 1:
        ii = np.diff(beat_times); ii = ii[ii > 0]
        print(f"  median beat interval {np.median(ii):.3f}s -> ~{60/np.median(ii):.1f} BPM")


if __name__ == "__main__":
    main()
