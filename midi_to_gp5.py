#!/usr/bin/env python3
"""
Convert a keyswitched MIDI file (output of gp5_to_keyswitched_mid.py) back
to a Guitar Pro 5/6 file.

This is the inverse of gp5_to_keyswitched_mid.py. The forward script reads
GP5 articulations from note.effect.* and emits keyswitch notes; this
script reads keyswitch notes and reconstructs note.effect.* on each
pitched note.

Supported keyswitches (Metal-GTX mapping):
    MIDI 9  (A-1)  -> Harmonic (natural)
    MIDI 17 (F0)   -> Sustain (default, no effect)
    MIDI 18 (F#0)  -> Sustain (default, no effect)
    MIDI 20 (G#0)  -> Palm Mute
    MIDI 23 (B0)   -> Slide Down
    MIDI 24 (C1)   -> Slide Up
    MIDI 26 (D1)   -> Hammer
    MIDI 27 (D#1)  -> Slide In (grace note)
    MIDI 91 (G6)   -> Bend

Limitations:
    - Bent note shape is not reconstructed (pitch wheel automation is
      rarely present in keyswitched MIDI; we use a default 1-semitone bend).
    - Slide direction is inferred from the next pitched note on the same
      channel.
    - Slide-in grace notes are placed at the same tick as the main note,
      with a 32nd-note duration.
    - String/fret selection picks the lowest playable fret on the
      appropriate string (heuristic).
"""
import argparse
import os
import sys
from dataclasses import dataclass, field

import guitarpro
import mido


# ---------------------------------------------------------------------------
# Constants — must match gp5_to_keyswitched_mid.py
# ---------------------------------------------------------------------------
DEFAULT_KEYSWITCH_MAP = {
    17: "sustain",
    18: "sustain",
    20: "palm_mute",
    9:  "harmonic",
    23: "slide_down",
    24: "slide_up",
    26: "hammer",
    27: "slide_in",
    91: "bend",
}

# Standard guitar tuning (low to high): E2 A2 D3 G3 B3 E4
# In MIDI notes: 40 45 50 55 59 64
DEFAULT_GUITAR_TUNING = (40, 45, 50, 55, 59, 64)

# Standard bass tuning (low to high): E1 A1 D2 G2
DEFAULT_BASS_TUNING = (28, 33, 38, 43)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------
@dataclass
class PitchedNote:
    """A pitched note (MIDI note > 30) reconstructed from the MIDI."""
    pitch: int
    start_tick: int
    duration_ticks: int
    velocity: int
    channel: int
    articulation: str = "sustain"  # default; overrides by keyswitch
    slide_target_pitch: int = None  # for slide_up / slide_down


# ---------------------------------------------------------------------------
# MIDI parsing
# ---------------------------------------------------------------------------
def _parse_midi(midi_path):
    """Read a MIDI file and return (track_name, channel, PitchedNote list).

    Keyswitch notes (< 30) are matched to the next pitched note on the
    same channel at the same tick (or within a few ticks). The keyswitch
    determines the articulation of that pitched note.
    """
    mid = mido.MidiFile(midi_path)
    if len(mid.tracks) < 2:
        raise ValueError(
            f"MIDI file has only {len(mid.tracks)} tracks; "
            "expected at least 2 (conductor + audio)."
        )

    audio_track = mid.tracks[1]
    name = audio_track.name or "Track"

    # Collect all (tick, event) pairs across the audio track.
    events = []
    abs_t = 0
    for msg in audio_track:
        abs_t += msg.time
        if hasattr(msg, "note"):
            events.append((abs_t, msg))

    # Sort by tick. Within a tick, keep original order (stable).
    events.sort(key=lambda e: e[0])

    # Walk events and pair on/off.
    # Track open notes per (channel, pitch).
    open_notes = {}
    pending_keyswitches = {}  # (channel, pitch) -> first tick it appeared

    pitched = []
    abs_t = 0
    for msg in audio_track:
        abs_t += msg.time
        if not hasattr(msg, "note"):
            continue
        if msg.type == "note_on" and msg.velocity > 0:
            if msg.note < 30:
                # Keyswitch note_on.
                pending_keyswitches[(msg.channel, msg.note)] = abs_t
            else:
                # Pitched note_on.
                pitch = msg.note
                key = (msg.channel, pitch)
                # Find the keyswitch that precedes this note on the same channel.
                # Prefer the most recent keyswitch on this channel.
                ks_pitch = None
                for ks_p_note, ks_tick in pending_keyswitches.items():
                    if ks_p_note[0] == msg.channel and ks_tick <= abs_t:
                        if ks_pitch is None or ks_tick > pending_keyswitches.get((msg.channel, ks_pitch), 0):
                            ks_pitch = ks_p_note[1]
                articulation = DEFAULT_KEYSWITCH_MAP.get(ks_pitch, "sustain")
                # Consume the keyswitch for this channel.
                if ks_pitch is not None:
                    pending_keyswitches.pop((msg.channel, ks_pitch), None)
                # Record as open note.
                open_notes[key] = PitchedNote(
                    pitch=pitch,
                    start_tick=abs_t,
                    duration_ticks=0,  # filled on note_off
                    velocity=msg.velocity,
                    channel=msg.channel,
                    articulation=articulation,
                )
        elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
            key = (msg.channel, msg.note)
            if key in open_notes:
                note = open_notes.pop(key)
                note.duration_ticks = abs_t - note.start_tick
                if note.duration_ticks < 1:
                    note.duration_ticks = 1
                pitched.append(note)

    # Resolve slide direction: for each slide_up / slide_down note, find
    # the next pitched note on the same channel and compare pitches.
    for i, note in enumerate(pitched):
        if note.articulation not in ("slide_up", "slide_down"):
            continue
        for later in pitched[i + 1:]:
            if later.channel == note.channel:
                if later.pitch > note.pitch:
                    note.slide_target_pitch = later.pitch
                    # Direction stays as inferred by keyswitch.
                elif later.pitch < note.pitch:
                    note.slide_target_pitch = later.pitch
                break

    return name, mid.tracks[0], pitched


# ---------------------------------------------------------------------------
# GP5 construction
# ---------------------------------------------------------------------------
def _pick_string_fret(pitch, tuning):
    """Pick the lowest playable fret on the appropriate string.

    Handles notes below the lowest open string by using negative frets
    (Guitar Pro supports frets 0-24, but our tuning may not reach low
    enough notes for some songs). If the pitch is below the lowest open
    string, we drop-tune by transposing the string value down.
    """
    best = None
    for string_idx, open_note in enumerate(tuning):
        fret = pitch - open_note
        if fret < 0 or fret > 24:
            continue
        # Prefer the lowest fret (closest to nut).
        if best is None or fret < best[1]:
            best = (string_idx, fret)
    if best is not None:
        return best
    # Pitch is below all strings. Drop-tune: transpose the lowest string
    # down so the note is reachable. This is a hack for non-standard
    # tunings; ideally the user would pass the right tuning.
    lowest_open = tuning[0]
    fret = pitch - (lowest_open - 12)  # drop the lowest string by 12 semitones
    if fret < 0 or fret > 24:
        return None, None
    return (0, fret)


def _articulation_to_effect(note, gp_note):
    """Set gp_note.effect fields based on the articulation."""
    art = note.articulation
    if art == "palm_mute":
        gp_note.effect.palmMute = True
    elif art == "harmonic":
        gp_note.effect.harmonic = guitarpro.NaturalHarmonic()
    elif art in ("slide_up", "slide_down"):
        gp_note.effect.slides = [guitarpro.SlideType.shiftSlideTo]
    elif art == "hammer":
        gp_note.effect.hammer = True
    elif art == "slide_in":
        # Grace note with transition=slide at the target pitch.
        gp_note.effect.grace = guitarpro.GraceEffect(
            duration=32,
            fret=note.pitch % 12,
            isDead=False,
            isOnBeat=True,
            transition=guitarpro.GraceEffectTransition.slide,
            velocity=note.velocity,
        )
    elif art == "bend":
        # Default to a 1-semitone bend. (Pitch wheel automation is not
        # reconstructed from MIDI; this is a placeholder.)
        gp_note.effect.bend = guitarpro.BendEffect(
            type=guitarpro.BendType.bend,
            value=0,
            points=[
                guitarpro.BendPoint(0, 0, False),
                guitarpro.BendPoint(3, 4, False),
                guitarpro.BendPoint(12, 4, False),
            ],
        )


def _ticks_to_duration(ticks, ticks_per_beat, beats_to_grid):
    """Convert ticks to a GP5 Duration object.

    GP5 represents durations as discrete values (1=whole, 2=half, 4=quarter,
    8=eighth, 16=sixteenth, 32=thirty-second). We round to the nearest.
    """
    beats = ticks / ticks_per_beat
    value = round(4 / beats)  # 4/quarter = 4/1, 4/half = 2, etc.
    value = max(1, min(64, value))
    if value == 1:
        return guitarpro.Duration(value=1, isDotted=False, tuplet=guitarpro.Tuplet(1, 1))
    if value == 3:
        return guitarpro.Duration(value=2, isDotted=True, tuplet=guitarpro.Tuplet(1, 1))
    return guitarpro.Duration(value=value, isDotted=False, tuplet=guitarpro.Tuplet(1, 1))


def _build_track(name, pitched, tuning, channel, ticks_per_beat):
    """Build a GP5 Track from a list of PitchedNotes."""
    song = guitarpro.Song()
    track = guitarpro.Track(song=song)
    track.name = name
    track.channel = guitarpro.MidiChannel(channel=channel, instrument=25)
    track.strings = [guitarpro.GuitarString(number=i + 1, value=t) for i, t in enumerate(tuning)]
    track.isPercussionTrack = False
    track.fretCount = 24

    # Determine measure count from the latest note.
    if not pitched:
        return track
    max_tick = max(n.start_tick + n.duration_ticks for n in pitched)
    ticks_per_measure = ticks_per_beat * 4  # assume 4/4
    num_measures = max(1, (max_tick + ticks_per_measure - 1) // ticks_per_measure)

    # Build one Measure per row.
    measures = []
    for measure_idx in range(int(num_measures)):
        measure_start = measure_idx * ticks_per_measure
        measure_end = measure_start + ticks_per_measure
        h = guitarpro.MeasureHeader(
            timeSignature=guitarpro.TimeSignature(
                numerator=4,
                denominator=guitarpro.Duration(value=4, isDotted=False, tuplet=guitarpro.Tuplet(1, 1)),
            ),
        )
        m = guitarpro.Measure(track=track, header=h)
        m.voices[0].beats = []
        # Group notes that start in this measure's beat slots.
        # Create one beat per beat (quarter note). Multiple notes can
        # share a beat (chord).
        beats_in_measure = 4  # 4/4
        beat_positions = []
        for b in range(beats_in_measure):
            beat_start = measure_start + b * ticks_per_beat
            beat_end = beat_start + ticks_per_beat
            # Find notes that start in this beat slot.
            beat_notes = [n for n in pitched
                          if beat_start <= n.start_tick < beat_end]
            beat_positions.append((beat_start, beat_notes))

        for beat_start, beat_notes in beat_positions:
            if not beat_notes:
                # Empty beat: skip (no note, no beat).
                continue
            # Use the first note's duration as the beat duration.
            first = beat_notes[0]
            beat_dur = _ticks_to_duration(first.duration_ticks, ticks_per_beat, 4)
            beat = guitarpro.Beat(
                voice=m.voices[0],
                notes=[],
                duration=beat_dur,
                start=beat_start,
            )
            for note in beat_notes:
                string, fret = _pick_string_fret(note.pitch, tuning)
                if string is None:
                    continue
                gp_note = guitarpro.Note(
                    beat=beat,
                    string=string + 1,
                    value=fret,
                    velocity=note.velocity,
                    type=guitarpro.NoteType.normal,
                )
                _articulation_to_effect(note, gp_note)
                beat.notes.append(gp_note)
            if beat.notes:
                m.voices[0].beats.append(beat)

        measures.append(m)

    track.measures = measures
    return track


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Convert a keyswitched MIDI back to a Guitar Pro 5/6 file.",
    )
    parser.add_argument("midi", help="Path to the input MIDI file.")
    parser.add_argument("output", help="Path to the output .gp5/.gp file.")
    parser.add_argument("--instrument", choices=["guitar", "bass", "drums"],
                        default="guitar")
    args = parser.parse_args()

    midi_path = os.path.abspath(args.midi)
    output_path = os.path.abspath(args.output)

    if not os.path.exists(midi_path):
        print(f"ERROR: MIDI file not found: {midi_path}", file=sys.stderr)
        return 1

    print(f"Reading {midi_path}...")
    name, conductor_track, pitched = _parse_midi(midi_path)
    print(f"  Track name: {name!r}")
    print(f"  Pitched notes: {len(pitched)}")
    # Count by articulation.
    from collections import Counter
    arts = Counter(n.articulation for n in pitched)
    for art, count in arts.most_common():
        print(f"    {art:12s} {count}")

    if not pitched:
        print("ERROR: no pitched notes found in MIDI", file=sys.stderr)
        return 1

    # Get ticks_per_beat from MIDI.
    mid = mido.MidiFile(midi_path)
    ticks_per_beat = mid.ticks_per_beat

    # Choose tuning.
    if args.instrument == "guitar":
        tuning = DEFAULT_GUITAR_TUNING
    elif args.instrument == "bass":
        tuning = DEFAULT_BASS_TUNING
    else:
        tuning = DEFAULT_GUITAR_TUNING  # ignored for drums

    # Determine channel from the first note.
    channel = pitched[0].channel

    # Build the song.
    song = guitarpro.Song()
    song.tempo = 120  # overwritten below
    # Extract tempo from conductor.
    for msg in conductor_track:
        if msg.type == "set_tempo":
            song.tempo = int(60_000_000 / msg.tempo)
            break

    # Song starts with a default Track 1; replace it with our built track.
    track = _build_track(
        name=name, pitched=pitched, tuning=tuning,
        channel=channel, ticks_per_beat=ticks_per_beat,
    )
    # The Track already has a MidiChannel from the build helper; ensure
    # it points at the source file's channel.
    track.channel = guitarpro.MidiChannel(channel=channel, instrument=25)
    song.tracks[0] = track

    print(f"Writing {output_path}...")
    parent = os.path.dirname(output_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    guitarpro.write(song, output_path)
    print(f"OK: wrote {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
