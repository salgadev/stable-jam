#!/usr/bin/env python3
"""
SA3 audio-to-audio spike, mirroring the official HF Space's default settings.

The Space (stabilityai/stable-audio-3) uses:
  steps=8, cfg_scale=1.0, sampler=pingpong, sigma_max=1.0,
  apg_scale=1.0, duration_padding_sec=6.0, seed=-1,
  init_noise_level=0.9 (Advanced -> Init audio)

High cfg_scale (e.g. 4.0) over-processes noisy input into garbage; the Space
defaults to cfg_scale=1.0 which is far gentler.
"""
import argparse

import torchaudio

from stable_audio_3 import StableAudioModel


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--wav", help="init audio (beatbox) WAV; omit for pure text-to-audio")
    ap.add_argument("--prompt", default="brutal metal blast beat drums, aggressive double bass, punchy triggered kick and snare")
    ap.add_argument("--out", default="out.wav")
    ap.add_argument("--model", default="small-sfx")
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--cfg", type=float, default=1.0)
    ap.add_argument("--noise", type=float, default=0.9)
    ap.add_argument("--seed", type=int, default=-1)
    ap.add_argument("--sampler", default="pingpong")
    ap.add_argument("--duration", type=float, default=None)
    args = ap.parse_args()

    device = "cpu"
    print(f"Loading model {args.model} on {device} ...")
    model = StableAudioModel.from_pretrained(args.model, device=device, model_half=False)

    init_audio = None
    if args.wav:
        waveform, sr = torchaudio.load(args.wav)
        clip_len = waveform.shape[-1] / sr
        init_audio = (sr, waveform)
        duration = args.duration or clip_len
        print(f"  init audio {args.wav}: {clip_len:.1f}s, sr={sr}")
    else:
        duration = args.duration or 7.0
        print("  pure text-to-audio (no init audio)")

    print(f"  steps={args.steps}, cfg={args.cfg}, sampler={args.sampler}, "
          f"noise={args.noise}, seed={args.seed}, duration={duration}s")
    audio = model.generate(
        prompt=args.prompt,
        duration=duration,
        steps=args.steps,
        cfg_scale=args.cfg,
        seed=args.seed,
        sampler_type=args.sampler,
        apg_scale=1.0,
        init_audio=init_audio,
        init_noise_level=args.noise,
    )

    out = audio.squeeze(0).cpu()
    torchaudio.save(args.out, out, 44100)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
