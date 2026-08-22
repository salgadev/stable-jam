#!/usr/bin/env python3
"""
Clean a beatbox recording before SA3: high-pass fan rumble + spectral-gate hiss.

The audio-to-audio path preserves the input's structure, so a noisy beatbox
(fan rumble, headset hiss) carries its noise straight into the output. This
preprocesses the input so SA3 only sees the beatbox's rhythmic content.

Usage:
  .venv/Scripts/python.exe tools/clean_beatbox.py --in raw.wav --out clean.wav
"""
import argparse

import noisereduce as nr
import numpy as np
import soundfile as sf
from scipy import signal


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--highpass", type=float, default=80.0,
                    help="high-pass cutoff Hz (fan rumble)")
    ap.add_argument("--gate", type=float, default=0.5,
                    help="noise-reduction strength 0-1")
    args = ap.parse_args()

    y, sr = sf.read(args.src)
    if y.ndim > 1:
        y = y.mean(axis=1)  # mono for processing

    # 1. High-pass to kill fan/rumble below cutoff
    sos = signal.butter(4, args.highpass, btype="highpass", fs=sr, output="sos")
    y = signal.sosfilt(sos, y)

    # 2. Spectral-gate the stationary hiss (noisereduce)
    y = nr.reduce_noise(y=y, sr=sr, prop_decrease=args.gate, stationary=True)

    # 3. Normalize to a healthy level
    peak = np.abs(y).max()
    if peak > 0:
        y = y / peak * 0.9

    sf.write(args.out, y, sr)
    print(f"Wrote {args.out}: {len(y)/sr:.1f}s, sr={sr}")


if __name__ == "__main__":
    main()
