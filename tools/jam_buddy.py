#!/usr/bin/env python3
"""
Jam Buddy MVP — "you start playing, it joins in."

UX: the user plays ~30s of music (via a MIDI controller, or an audio take).
The buddy detects the tempo, then responds with its own ~30s of a single
instrument of the user's choice (the "knob"), generated at the same BPM so
it feels like it's in the same groove.

Input:
  --midi  a MIDI recording from a controller (note-on times are exact, so
          tempo detection is trivial and has no octave-drop problem).
  --wav   an audio take (librosa + genre tempo-range prior to kill the
          octave-drop on dense material).

Pipeline:
  1. Detect BPM from the input.
  2. Generate ~30s of the chosen instrument at that BPM via SA3 (small-music,
     prompt = instrument + BPM + "studio recording", negative = "field
     recording", cfg=1.0, steps=8, pingpong sampler).
  3. Write the response WAV.

The response is a phrase, not a loop — no loop-seam or time-stretch needed.
The "joins in" feel = tempo match + complementary instrument.

Usage:
  # MIDI controller input (primary)
  .venv/Scripts/python.exe tools/jam_buddy.py \
      --midi take.mid --instrument bass --out buddy_bass.wav

  # Audio take input (fallback)
  .venv/Scripts/python.exe tools/jam_buddy.py \
      --wav take.wav --genre metal --instrument bass --out buddy_bass.wav
"""
import argparse

import numpy as np
import torchaudio

# stable_audio_3 is imported lazily inside main() so the BPM-detection half
# can run standalone without the SA3 venv / model load.

# Instrument -> prompt fragment (the "knob" options)
INSTRUMENTS = {
    "bass": "a grooving bass guitar line, tight and in the pocket",
    "lead": "a soaring lead guitar riff, melodic and expressive",
    "rhythm": "a chugging rhythm guitar, tight palm-muted power chords",
    "synth": "a warm synth pad, atmospheric and sustained",
    "drums": "a punchy drum groove, kick and snare locked in",
}

# Genre tempo-range prior (BPM) to disambiguate the octave-drop on AUDIO.
# The user picks a genre (a knob on the box); each maps to a plausible band.
# A wide band (60-220) lets beat_track fall to half-time on dense material,
# so a genre prior is the reliable fix. MIDI input ignores this (exact times).
GENRE_TEMPO = {
    "metal": (150, 220),
    "rock": (100, 180),
    "punk": (140, 220),
    "hiphop": (70, 110),
    "edm": (110, 150),
    "jazz": (90, 180),
    "pop": (90, 130),
    "any": (60, 220),
}
DEFAULT_GENRE = "any"


def detect_bpm_midi(path):
    """Return BPM from a MIDI recording's note-on times (exact, no octave-drop).

    Uses the file's tempo map if present; otherwise estimates from the median
    inter-onset interval of note-on events (accounting for 16th density by
    taking the strongest pulse in the 60-220 band).
    """
    import mido
    mid = mido.MidiFile(path)
    tpb = mid.ticks_per_beat or 480

    # Collect note-on times in absolute ticks, and any tempo metas.
    note_ticks = []
    tempo_us = None
    abs_tick = 0
    for track in mid.tracks:
        for msg in track:
            abs_tick += msg.time
            if msg.type == "set_tempo":
                tempo_us = msg.tempo
            elif msg.type == "note_on" and msg.velocity > 0:
                note_ticks.append(abs_tick)

    if not note_ticks:
        raise ValueError(f"No note-on events in {path}")

    # If the file carries an explicit tempo, trust it.
    if tempo_us is not None:
        return round(60e6 / tempo_us)

    # Otherwise estimate from inter-onset intervals (in beats).
    note_ticks.sort()
    intervals = np.diff(note_ticks) / tpb  # in beats
    intervals = intervals[intervals > 0.05]  # ignore sub-50ms jitter
    if len(intervals) == 0:
        raise ValueError("Could not estimate tempo from note density")
    # Median inter-onset in beats -> BPM. If the median is sub-beat (16ths),
    # the tempo lands in the 60-220 band naturally; pick the strongest pulse.
    median_beats = float(np.median(intervals))
    bpm = 60.0 / median_beats
    # Disambiguate octave: fold into 60-220 by doubling/halving.
    while bpm < 60:
        bpm *= 2
    while bpm > 220:
        bpm /= 2
    return round(bpm)


def midi_duration(path):
    """Return the total duration (seconds) of a MIDI file — the time of the
    last note end, using the file's tempo map. This is what the generated
    response must match so the take and the buddy stay in tempo together.
    """
    import mido
    mid = mido.MidiFile(path)
    tpb = mid.ticks_per_beat or 480

    # Walk the tracks accumulating absolute ticks and the tempo map. Track the
    # last note END (start + duration), not just its start, so the response is
    # long enough to contain the whole take.
    last_tick = 0
    note_ends = {}
    tempo_pts = {}  # abs_tick -> microseconds
    running_us = 500000
    abs_tick = 0
    for track in mid.tracks:
        t = 0
        for msg in track:
            t += msg.time
            if msg.type == "set_tempo":
                tempo_pts[t] = msg.tempo
            elif msg.type == "note_on" and msg.velocity > 0:
                note_ends.setdefault(msg.note, t)
            elif msg.type == "note_off" and msg.note in note_ends:
                last_tick = max(last_tick, t, note_ends[msg.note])
                # duration = t - start; keep the end tick
    if not last_tick:
        last_tick = max(note_ends.values()) if note_ends else 0
    # Convert last_tick to seconds using the tempo map.
    if not tempo_pts:
        return last_tick / tpb * (running_us / 1e6)
    # Find the tempo in effect at last_tick.
    active_us = running_us
    for tick, us in sorted(tempo_pts.items()):
        if tick <= last_tick:
            active_us = us
    return last_tick / tpb * (active_us / 1e6)


def detect_bpm_audio(path, tempo_range=GENRE_TEMPO[DEFAULT_GENRE]):
    """Return (bpm, sr) for an audio take, using a tempo-range prior."""
    import librosa
    import scipy.stats
    y, sr = librosa.load(path, sr=22050, mono=True)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    lo, hi = tempo_range
    mid = (lo + hi) / 2.0
    # A Gaussian prior centered in the range disambiguates the octave-drop:
    # beat_track picks the tempo nearest the prior, so dense 16th material
    # resolves to the notated octave instead of half-time.
    prior = scipy.stats.norm(loc=mid, scale=(hi - lo) / 4.0)
    tempo, _ = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr,
        start_bpm=mid, prior=prior,
    )
    if np.ndim(tempo):
        tempo = float(np.median(np.asarray(tempo)))
    return float(tempo), sr


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--midi", help="MIDI recording from a controller")
    src.add_argument("--wav", help="audio take (fallback)")
    ap.add_argument("--instrument", default="bass",
                    choices=sorted(INSTRUMENTS), help="the knob")
    ap.add_argument("--out", default="buddy_response.wav")
    ap.add_argument("--duration", type=float, default=30.0,
                    help="response length in seconds")
    ap.add_argument("--model", default="small-music")
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--cfg", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=-1)
    ap.add_argument("--sampler", default="pingpong")
    ap.add_argument("--genre", default=DEFAULT_GENRE,
                    choices=sorted(GENRE_TEMPO), help="tempo-range prior (audio only)")
    ap.add_argument("--tempo-min", type=float, default=None)
    ap.add_argument("--tempo-max", type=float, default=None)
    ap.add_argument("--bpm", type=float, default=None,
                    help="explicit BPM override (skip detection)")
    ap.add_argument("--noise", type=float, default=0.4,
                    help="init_noise_level for audio-to-audio (lower = closer to input timing)")
    args = ap.parse_args()

    # 1. Detect BPM (or use explicit override)
    init_audio = None
    if args.bpm is not None:
        bpm = args.bpm
        print(f"Using explicit BPM: {bpm}")
    elif args.midi:
        bpm = detect_bpm_midi(args.midi)
        print(f"Detected BPM (MIDI): {bpm} from {args.midi}")
        # The response must match the take's length so both stay in tempo
        # together. The server-side mido reading is authoritative.
        args.duration = midi_duration(args.midi)
        print(f"  MIDI duration -> response {args.duration:.1f}s")
    elif args.wav:
        bpm, sr = detect_bpm_audio(args.wav, GENRE_TEMPO[args.genre])
        print(f"Detected BPM (audio): {bpm:.1f} (genre={args.genre})")
        # Audio-to-audio: feed the take to SA3 via init_audio so the buddy
        # actually HEARS the groove and responds rhythmically, not just at the
        # tempo. Duration matches the take.
        waveform, sr = torchaudio.load(args.wav)
        args.duration = waveform.shape[-1] / sr
        init_audio = (sr, waveform)
        print(f"  audio-to-audio: passing {args.wav} ({args.duration:.1f}s) as init_audio")
    else:
        ap.error("one of --midi, --wav, or --bpm is required")

    # 2. Generate the response at that BPM
    prompt = (f"{INSTRUMENTS[args.instrument]}, "
              f"{int(round(bpm))} BPM, studio recording")
    negative = "field recording"
    print(f"  instrument={args.instrument} | prompt: {prompt!r}")
    print(f"  negative: {negative!r}")

    device = "cpu"
    print(f"Loading model {args.model} on {device} ...")
    from stable_audio_3 import StableAudioModel
    model = StableAudioModel.from_pretrained(args.model, device=device,
                                             model_half=False)

    print(f"  steps={args.steps}, cfg={args.cfg}, sampler={args.sampler}, "
          f"seed={args.seed}, duration={args.duration}s"
          + (f", init_audio={init_audio is not None}, noise={args.noise}" if init_audio else ""))
    if init_audio is not None:
        print("  NOTE: audio-to-audio on CPU-only hardware can degrade to noise;"
              " a GPU gives cleaner results.")
    audio = model.generate(
        prompt=prompt,
        negative_prompt=negative,
        duration=args.duration,
        steps=args.steps,
        cfg_scale=args.cfg,
        seed=args.seed,
        sampler_type=args.sampler,
        apg_scale=1.0,
        init_audio=init_audio,
        init_noise_level=args.noise if init_audio is not None else None,
    )

    out = audio.squeeze(0).cpu()
    torchaudio.save(args.out, out, 44100)
    print(f"Wrote {args.out}: {out.shape[-1]/44100:.1f}s @ {bpm} BPM")


if __name__ == "__main__":
    main()
