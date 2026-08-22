#!/usr/bin/env python3
"""
Jam Buddy — Stable Audio 3 API adapter.

Like tools/jam_buddy.py but shells to the Stability SA3 REST API (Large model)
instead of running SA3 locally on CPU. The API is async (POST -> 202 + id,
poll GET /results/{id} until 200).

Usage mirrors jam_buddy.py:
  --midi take.mid --instrument bass --out buddy_bass.wav   (text-to-audio at detected BPM)
  --wav  take.wav --instrument bass --out out.wav            (audio-to-audio, strength controls groove cling)
  --bpm 120 --duration 30 --out out.wav                      (manual BPM)

Differences vs local:
  - No --negative-prompt (the SA3 API accepts NO negative prompt — confirmed
    from the API schema). The complement hint must ride in the positive prompt.
  - --steps and --cfg ARE accepted (4-8, 1-25).
  - API key read from env STABILITY_API_KEY or repo-root .env.
  - 26 credits per successful generation (stable-audio-3 model).

Usage:
  .venv/Scripts/python.exe tools/jam_buddy_api.py \
      --midi take.mid --instrument bass --out buddy_bass.wav
"""
import argparse
import os
import re
import sys
import time
import wave

import requests

API = "https://api.stability.ai"
MODEL = "stable-audio-3"
CREDITS_PER_GEN = 26

# Instrument -> AudioSparx `Instruments:` tag fragment (matches jam_buddy.py)
INSTRUMENTS = {
    "bass": "Bass Guitar, a grooving bass line, tight and in the pocket",
    "lead": "Lead Guitar, a soaring melodic lead guitar riff",
    "rhythm": "Rhythm Guitar, tight palm-muted power chords",
    "synth": "Synth, a warm atmospheric pad",
    "drums": "Drums, a punchy drum groove, kick and snare locked in",
    "sax": "Saxophone, a warm breathy saxophone line with a rich tone",
    "cleanguitar": "Clean Guitar, bright chimey clean electric guitar arpeggios",
    "overdrivenguitar": "Overdriven Guitar, a gritty overdriven guitar riff with crunch",
}
DEFAULT_GENRE = "any"
GENRE_TEMPO = {
    "metal": (150, 220), "rock": (100, 180), "punk": (140, 220),
    "hiphop": (70, 110), "edm": (110, 150), "jazz": (90, 180),
    "pop": (90, 130), "any": (60, 220),
}


def load_api_key():
    """Return the Stability API key from env or the repo-root .env file."""
    key = os.environ.get("STABILITY_API_KEY")
    if key:
        return key
    # .env lives at the repo ROOT, not in tools/. Check: script dir's parent
    # (tools/../), then script dir, then cwd.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    for root in (os.path.dirname(script_dir), script_dir, os.getcwd()):
        dotenv = os.path.join(root, ".env")
        if os.path.isfile(dotenv):
            with open(dotenv) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("STABILITY_API_KEY="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def detect_bpm_midi(path):
    import mido
    mid = mido.MidiFile(path)
    tpb = mid.ticks_per_beat or 480
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
    if tempo_us is not None:
        return round(60e6 / tempo_us)
    note_ticks.sort()
    import numpy as np
    intervals = np.diff(note_ticks) / tpb
    intervals = intervals[intervals > 0.05]
    bpm = 60.0 / float(np.median(intervals))
    while bpm < 60:
        bpm *= 2
    while bpm > 220:
        bpm /= 2
    return round(bpm)


def midi_duration(path):
    import mido
    mid = mido.MidiFile(path)
    tpb = mid.ticks_per_beat or 480
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
    if not last_tick:
        last_tick = max(note_ends.values()) if note_ends else 0
    if not tempo_pts:
        return last_tick / tpb * (running_us / 1e6)
    active_us = running_us
    for tick, us in sorted(tempo_pts.items()):
        if tick <= last_tick:
            active_us = us
    return last_tick / tpb * (active_us / 1e6)


def detect_bpm_audio(path, tempo_range=GENRE_TEMPO[DEFAULT_GENRE]):
    import librosa
    import scipy.stats
    import numpy as np
    y, sr = librosa.load(path, sr=22050, mono=True)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    lo, hi = tempo_range
    mid = (lo + hi) / 2.0
    prior = scipy.stats.norm(loc=mid, scale=(hi - lo) / 4.0)
    tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr,
                                       start_bpm=mid, prior=prior)
    if np.ndim(tempo):
        tempo = float(np.median(np.asarray(tempo)))
    return float(tempo), sr


def submit_and_poll(payload, files):
    """POST audio generation, poll to completion, return raw bytes."""
    api_key = load_api_key()
    headers = {"authorization": f"Bearer {api_key}", "accept": "audio/*"}
    resp = requests.post(f"{API}/v2beta/audio/{payload.pop('endpoint')}",
                         headers=headers, files=files, data=payload, timeout=120)
    if resp.status_code == 403:
        raise RuntimeError(f"content moderation flagged the request: {resp.text[:300]}")
    if resp.status_code != 202:
        raise RuntimeError(f"generation failed {resp.status_code}: {resp.text[:300]}")
    gen_id = resp.json()["id"]
    print(f"  queued generation {gen_id} (credits: {CREDITS_PER_GEN})")
    # Poll every 10s up to ~5 min. Endpoint is /v2beta/audio/results/{id}.
    for _ in range(30):
        res = requests.get(f"{API}/v2beta/audio/results/{gen_id}",
                           headers={"authorization": f"Bearer {api_key}",
                                    "accept": "audio/*"}, timeout=60)
        if res.status_code == 200:
            return res.content
        if res.status_code not in (202,):
            raise RuntimeError(f"poll error {res.status_code}: {res.text[:300]}")
        time.sleep(10)
    raise TimeoutError("generation did not complete in time")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--midi", help="MIDI recording from a controller")
    src.add_argument("--wav", help="audio take (audio-to-audio)")
    ap.add_argument("--instrument", default="bass", choices=sorted(INSTRUMENTS))
    ap.add_argument("--out", default="buddy_response.mp3")
    ap.add_argument("--duration", type=float, default=30.0)
    ap.add_argument("--bpm", type=float, default=None)
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--cfg", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--prompt", type=str, default=None)
    ap.add_argument("--genre", default=DEFAULT_GENRE, choices=sorted(GENRE_TEMPO))
    ap.add_argument("--strength", type=float, default=1.0,
                    help="audio-to-audio strength (0=identical input, 1=ignore input)")
    ap.add_argument("--negative-prompt", type=str, default=None,
                    help="NOT SUPPORTED by the SA3 API; ignored with a warning")
    args = ap.parse_args()

    key = load_api_key()
    if not key:
        ap.error("STABILITY_API_KEY not found (env or .env)")

    if args.negative_prompt:
        print("  WARNING: --negative-prompt is NOT supported by the SA3 API; "
              "ignored. Fold complement hints into --prompt instead.")

    # 1. Resolve BPM + duration + input audio.
    init_audio = None
    if args.bpm is not None:
        bpm = args.bpm
        print(f"Using explicit BPM: {bpm}")
    elif args.midi:
        bpm = detect_bpm_midi(args.midi)
        args.duration = max(6.0, midi_duration(args.midi))
        print(f"Detected BPM (MIDI): {bpm} | duration {args.duration:.1f}s")
    elif args.wav:
        bpm, sr = detect_bpm_audio(args.wav, GENRE_TEMPO[args.genre])
        print(f"Detected BPM (audio): {bpm:.1f}")
        init_audio = open(args.wav, "rb")
    else:
        ap.error("one of --midi, --wav, or --bpm is required")

    # 2. Prompt (AudioSparx vocab, same as the CLI/route).
    if args.prompt:
        prompt = args.prompt
    else:
        prompt = (f"TrackType: Music, VocalType: Instrumental, "
                  f"Instruments: {INSTRUMENTS[args.instrument]}, "
                  f"{int(round(bpm))} BPM, studio recording")
    print(f"  prompt: {prompt!r}")

    # 3. Build multipart payload.
    payload = {
        "prompt": prompt,
        "model": MODEL,
        "duration": int(round(args.duration)),
        "seed": str(args.seed),
        "steps": str(args.steps),
        "cfg_scale": str(args.cfg),
        "output_format": "mp3" if args.out.endswith(".mp3") else "wav",
    }
    files = {}
    if init_audio is not None:
        payload["strength"] = str(args.strength)
        files["audio"] = ("take." + ("mp3" if args.wav.lower().endswith((".mp3",)) else "wav"),
                          init_audio, "audio/wav")
        payload["endpoint"] = "stable-audio/audio-to-audio"
        print(f"  audio-to-audio: strength={args.strength}")
    else:
        # The API requires multipart/form-data even without a file; the
        # reference sample passes an empty 'none' part to force that.
        files["none"] = ""
        payload["endpoint"] = "stable-audio/text-to-audio"

    raw = submit_and_poll(payload, files)
    with open(args.out, "wb") as f:
        f.write(raw)
    print(f"Wrote {args.out}: {len(raw)} bytes (expected credits used: {CREDITS_PER_GEN})")


if __name__ == "__main__":
    main()
