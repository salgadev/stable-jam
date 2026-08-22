#!/usr/bin/env python3
"""
SA3 inpaint spike mirroring the official HF Space's default settings.

The Space (stabilityai/stable-audio-3, Advanced tab -> Inpainting) uses:
  steps=8, cfg_scale=1.0, sampler=pingpong, sigma_max=1.0, apg_scale=1.0,
  duration_padding_sec=6.0, seed=-1
  inpaint_audio + inpaint_mask_start/end (mask a region, keep the rest)

High cfg_scale (4.0) over-processes noisy input into garbage. The Space
defaults to cfg_scale=1.0 which is far gentler and preserves the input beat.
"""
import argparse

import torchaudio

from stable_audio_3 import StableAudioModel


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--wav", required=True, help="inpaint audio (beatbox) WAV")
    ap.add_argument("--prompt", default="drums only heavy metal beat played in isolation (NO MUSIC JUST DRUMS)")
    ap.add_argument("--out", default="out.wav")
    ap.add_argument("--model", default="small-sfx")
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--cfg", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=-1)
    ap.add_argument("--sampler", default="pingpong")
    ap.add_argument("--mask-start", type=float, default=0.0)
    ap.add_argument("--mask-end", type=float, default=None, help="default: full clip")
    ap.add_argument("--duration", type=float, default=None)
    args = ap.parse_args()

    device = "cpu"
    print(f"Loading model {args.model} on {device} ...")
    model = StableAudioModel.from_pretrained(args.model, device=device, model_half=False)

    waveform, sr = torchaudio.load(args.wav)
    clip_len = waveform.shape[-1] / sr
    duration = args.duration or clip_len
    mask_end = args.mask_end if args.mask_end is not None else clip_len
    print(f"  inpaint audio {args.wav}: {clip_len:.1f}s, sr={sr}")
    print(f"  mask {args.mask_start}-{mask_end:.1f}s, duration={duration}s")

    print(f"  steps={args.steps}, cfg={args.cfg}, sampler={args.sampler}, seed={args.seed}")
    audio = model.generate(
        prompt=args.prompt,
        duration=duration,
        steps=args.steps,
        cfg_scale=args.cfg,
        seed=args.seed,
        sampler_type=args.sampler,
        apg_scale=1.0,
        inpaint_audio=(sr, waveform),
        inpaint_mask_start_seconds=args.mask_start,
        inpaint_mask_end_seconds=mask_end,
    )

    out = audio.squeeze(0).cpu()
    torchaudio.save(args.out, out, 44100)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
