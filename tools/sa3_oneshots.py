#!/usr/bin/env python3
"""Generate SA3 one-shot drum samples (kick/snare/hat) for the sampler path."""
import argparse
import os

import torchaudio

from stable_audio_3 import StableAudioModel

PROMPTS = {
    "kick": "single bass drum kick hit, punchy, tight, triggered, isolated drum sound",
    "snare": "single snare drum hit, snappy, tight, triggered, isolated drum sound",
    "hat": "single closed hi-hat hit, crisp, short, isolated drum sound",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default="tools/oneshots")
    ap.add_argument("--model", default="small-sfx")
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--cfg", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=4)
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    print(f"Loading {args.model} ...")
    model = StableAudioModel.from_pretrained(args.model, device="cpu", model_half=False)

    for name, prompt in PROMPTS.items():
        out = os.path.join(args.outdir, f"{name}.wav")
        print(f"  generating {name} ...")
        audio = model.generate(
            prompt=prompt,
            duration=1.5,
            steps=args.steps,
            cfg_scale=args.cfg,
            seed=args.seed + (0 if name == "kick" else 1 if name == "snare" else 2),
            sampler_type="pingpong",
            apg_scale=1.0,
        )
        a = audio.squeeze(0).cpu()
        torchaudio.save(out, a, 44100)
        print(f"  wrote {out}")
    print("done")


if __name__ == "__main__":
    main()
