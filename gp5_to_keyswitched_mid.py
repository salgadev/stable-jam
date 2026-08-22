#!/usr/bin/env python3
"""
Guitar Pro 5 (.gp5) -> Sforzando Keyswitched MIDI Converter
============================================================

Reads a .gp5 file, detects common guitar articulations (palm mute, staccato,
harmonic, slide, bend) on every note of every guitar track, and emits a Type 1
MIDI file with the corresponding Sforzando keyswitch notes inserted exactly one
tick before each articulated note.

Bass tracks are skipped by default. Pass --include-bass to also process them.

All guitar tracks of the same instrument kind (e.g. two rhythm guitars) are
merged into a single MIDI track on a single channel, so Sforzando receives a
clean instrument-shaped stream.

INSTALL
-------
    pip install PyGuitarPro mido

USAGE
-----
    python gp5_to_keyswitched_mid.py path/to/song.gp5
    python gp5_to_keyswitched_mid.py path/to/song.gp5 output.mid
    python gp5_to_keyswitched_mid.py song.gp5 -b           # also process bass
    python gp5_to_keyswitched_mid.py song.gp5 -V 100 -r   # velocity 100, emit sustain reset

Edit the KEYSWITCH_MAP dictionary below to change the keyswitch note numbers
to match the keyswitches declared in your .sfz instrument.
"""

import argparse
import os
import re
import sys

import guitarpro
import mido


__all__ = [
    "KEYSWITCH_MAP",
    "INCLUDE_BASS",
    "MERGE_BY_INSTRUMENT",
    "EMIT_SUSTAIN_RESET",
    "SUSTAIN_KEYSWITCH",
    "DEFAULT_VELOCITY",
    "detect_techniques",
    "convert",
    "main",
]


# ---------------------------------------------------------------------------
# EDITABLE SETTINGS
# ---------------------------------------------------------------------------

# Map detected technique name -> Sforzando keyswitch MIDI note number.
# THIS IS A TEMPLATE. The actual keyswitch numbers depend on the SFZ
# instrument you load in Sforzando. Verify each value by:
#   1. Open the .sfz file in a text editor.
#   2. Search for the technique name (e.g. 'sustain', 'palm_mute').
#   3. Find the sw_lokey/sw_hikey range that selects it; the keyswitch
#      note is the value inside that range.
#   4. Or just play the note in Sforzando and listen.
# Below is one plausible mapping for Unreal Instruments METAL-GTX, based
# on the reabank metadata in the .sfz. Treat it as a starting point, not
# a guarantee. You can override at the CLI with --keyswitch-map FILE.
#   sustain   F1  / 17   — Sustain Down
#   palm_mute G#1 / 20   — Palm Mute Down
#   slide     C1  / 24   — Slide Up
#   harmonic  A0  /  9   — Natural Harmonics
#   bend      G6  / 91   — Bending semi
# Staccato is intentionally NOT mapped: on a real guitar it is a
# duration/timing property, not a separate articulation. The original
# note's envelope is preserved by NOT emitting a staccato key.
KEYSWITCH_MAP = {
    "sustain":        17,
    "palm_mute":      20,
    "harmonic":        9,
    "slide_up":       24,
    "slide_down":     23,
    "slide_in":       27,
    "hammer":         26,
    "bend":           91,
}

# The keyswitch note number used to (re)assert the sustain/clean state.
# SusUp (F#0 = 18) is the cleaner-sounding of the two sustain keys in
# METAL-GTX — SusDown (F0 = 17) has a noticeable palm-mute-like quality.
# When a note in the GP file has no articulation, the script emits this
# key at the same tick so the sampler always knows what to play.
SUSTAIN_KEYSWITCH = 18

# Length of a keyswitch note (in ticks, at 960 PPQ). 960 ticks = one quarter
# note, which is large enough to be visible in any DAW's piano roll and
# long enough that no host will drop it. The actual delivered duration is
# further clamped to the gap until the next event on the same channel so
# two consecutive keyswitches never overlap.
KEYSWITCH_DURATION_TICKS = 960

# MIDI note numbers used as keyswitches. Used to truncate each keyswitch
# note_off to the gap before the next event on the same channel.

# General MIDI drum programs. A track is treated as drums if it uses one of
# these programs on a non-channel-9 channel, OR if its name says "drum".
_GM_DRUM_PROGRAMS = set(range(8, 17))  # 8..16 (drums 8..15 + reverse cymbal 16)

# General MIDI guitar programs (24..31 cover acoustic/electric/clean/distortion/
# overdriven/lead/etc., plus the muted guitar 28 and overdriven 29).
_GM_GUITAR_PROGRAMS = set(range(24, 32))

# General MIDI bass programs (32..39).
_GM_BASS_PROGRAMS = set(range(32, 40))

_GUITAR_NAME_TOKENS = (
    "guitar", "rhythm", "lead", "clean", "harmony", "distort",
)
_BASS_NAME_TOKENS = (
    "bass", "fretless", "slap",
)
_DRUM_NAME_TOKENS = (
    "drum", "kit", "percussion",
)

# Program numbers that, when seen alone, are ambiguous (e.g. program 0 =
# "Acoustic Grand Piano" in GM, but GP5 also uses 0 for drums when the
# channel is 9). The classifier consults the track name in that case.

# Process bass tracks too. Override at the CLI with --include-bass.
INCLUDE_BASS = False

# When False (default), every included GP track becomes its own output MIDI
# track on its own channel, the channel the track had in the Guitar Pro file.
# This is the right mode for selecting a single track by name (--only) and
# for the common case of driving several Sforzando instances at once.
# Set to True to merge tracks of the same instrument kind into one MIDI
# track on a single deterministic channel.
MERGE_BY_INSTRUMENT = False

# When True (default), every non-articulated note in the GP file emits a
# sustain key (SUSTAIN_KEYSWITCH) at the same tick. This guarantees the
# sampler is always in a known state, regardless of what the previous
# sample held. Turn off with --no-sustain-reset on the CLI if you want
# explicit keyswitches only at articulated notes.
EMIT_SUSTAIN_RESET = True

# When True (default), trim leading silence so the first event lands at
# tick 0. Empty intro bars in the GP file are removed from the MIDI
# output. Useful when the GP arrangement has a long count-in or rests
# before the first note.
TRIM_SILENCE = True

# Velocity used when a note has no explicit velocity or its value is 0.
DEFAULT_VELOCITY = 100


# ---------------------------------------------------------------------------
# TRACK CLASSIFICATION
# ---------------------------------------------------------------------------
# PyGuitarPro does not always populate `track.instrument.kind`. The reliable
# signals are: (1) the GM program number on `track.channel` (mute-proof, this
# is what the .gp5 file actually stores), and (2) the track name. We use
# both so that contrived tracks ("Julien Bass") are recognised even when the
# program number happens to be 0.

def _channel_1based(gp_track):
    """Return the 1-based MIDI channel of a GP track, or None if unknown."""
    ch = getattr(gp_track, "channel", None)
    raw = getattr(ch, "channel", None) if ch is not None else None
    if raw is None:
        return None
    return int(raw) + 1  # GP is 0-based, but here we want 1-based for the
    # common "channel 9 = drums" convention.

def _program_number(gp_track):
    """Return the GM program number 0-127 for a GP track, or None if unknown."""
    ch = getattr(gp_track, "channel", None)
    return getattr(ch, "instrument", None) if ch is not None else None

def _track_name(gp_track):
    n = getattr(gp_track, "name", None) or ""
    return n.strip().lower()

def _classify_track(gp_track):
    """
    Return (category, kind_label) for a GP track.

    category is one of: 'guitar', 'bass', 'drums', 'other'.
    kind_label is a short string used for channel hashing (e.g.
    'electricGuitar', 'fretlessBass').
    """
    name = _track_name(gp_track)
    name_lower = name.lower()
    chan_1b = _channel_1based(gp_track)
    prog = _program_number(gp_track)

    # Channel 9 in GP5 is always drums in the files we care about.
    if chan_1b == 10:
        return ("drums", "drums")

    # Name-based overrides win early — GP5 files often use inconsistent
    # program numbers (e.g. program 0 for "Julien Bass") and the name is
    # the most reliable signal.
    if any(tok in name_lower for tok in _DRUM_NAME_TOKENS):
        return ("drums", "drums")
    if any(tok in name_lower for tok in _BASS_NAME_TOKENS):
        return ("bass", _classify_bass_label(name, prog))
    if any(tok in name_lower for tok in _GUITAR_NAME_TOKENS):
        return ("guitar", _classify_guitar_label(name, prog))

    # Fall back to program number.
    if prog is not None:
        if prog in _GM_DRUM_PROGRAMS:
            return ("drums", "drums")
        if prog in _GM_BASS_PROGRAMS:
            return ("bass", _classify_bass_label(name, prog))
        if prog in _GM_GUITAR_PROGRAMS:
            return ("guitar", _classify_guitar_label(name, prog))

    return ("other", "other")


_GUITAR_PROGRAM_LABEL = {
    24: "nylonGuitar", 25: "steelGuitar", 26: "jazzGuitar",
    27: "cleanGuitar", 28: "mutedGuitar", 29: "overdrivenGuitar",
    30: "distortionGuitar", 31: "harmonicsGuitar",
}
_BASS_PROGRAM_LABEL = {
    32: "acousticBass", 33: "fingeredBass", 34: "pickedBass",
    35: "fretlessBass", 36: "slapBass1", 37: "slapBass2",
    38: "synthBass1", 39: "synthBass2",
}


def _classify_guitar_label(name, prog):
    if prog is not None and prog in _GUITAR_PROGRAM_LABEL:
        return _GUITAR_PROGRAM_LABEL[prog]
    # Press fragile names: 'lead' / 'rhythm' / 'clean' / 'harmony' / 'distort'
    nl = name.lower()
    for tok in ("lead", "rhythm", "clean", "harmony", "distort", "acoustic"):
        if tok in nl:
            return f"{tok}Guitar"
    return "electricGuitar"


def _classify_bass_label(name, prog):
    if prog is not None and prog in _BASS_PROGRAM_LABEL:
        return _BASS_PROGRAM_LABEL[prog]
    return "bassGuitar"


# Reserve channel 9 (GM percussion) for drums. Sforzando expects the
# instrument on a pitched channel.
_RESERVED_CHANNELS = {9}


def _midi_channel_for(kind_name):
    """
    Return a deterministic MIDI channel 0-15 for a given instrument kind.
    Channel 9 is skipped (GM percussion). Identical kind names always resolve
    to the same channel, so merging tracks of the same kind keeps the
    resulting overlapping notes on the same channel.
    """
    if not kind_name:
        return 0
    h = sum(ord(c) for c in kind_name)
    ch = h % 16
    if ch in _RESERVED_CHANNELS:
        ch = (ch + 1) % 16
    return ch


def _bucket_tracks_by_kind(guitar_tracks, bass_included):
    """
    Group included tracks into (kind_label, [gp_track, ...]) buckets.

    Guitars are split by their kind label (e.g. 'cleanGuitar' becomes its
    own bucket), so a file with rhythm + lead + clean guitars gets three
    separate MIDI tracks. Bass tracks, when included, land in a single
    'Bass' bucket.

    Returns a list of (bucket_label, kind_name, [gp_track...]) tuples in the
    order they should appear in the output MIDI.
    """
    guitar_buckets = {}
    for t in guitar_tracks:
        kind = _classify_track(t)[1]
        guitar_buckets.setdefault(kind, []).append(t)

    buckets = []
    for kind in sorted(guitar_buckets):
        n = len(guitar_buckets[kind])
        if len(guitar_buckets) == 1 and len(guitar_tracks) > 1:
            label = "Guitar"
        elif n == 1:
            label = f"Guitar: {kind}"
        else:
            label = f"Guitar: {kind}"
        buckets.append((label, kind, guitar_buckets[kind]))

    if bass_included:
        if len(bass_included) == 1:
            label = "Bass"
            kind = _classify_track(bass_included[0])[1]
        else:
            kind = _classify_track(bass_included[0])[1]
            label = f"Bass: {kind}"
        buckets.append((label, kind, bass_included))

    return buckets


# ---------------------------------------------------------------------------
# FILENAME HELPERS
# ---------------------------------------------------------------------------
_FILENAME_FORBIDDEN = re.compile(r"[\\/:\*\?\"<>\|]+")
_FILENAME_WHITESPACE = re.compile(r"\s+")
_FILENAME_EDGEPUNCT = "\u2024\u2025\u2026\ufeff. "


def _sanitize_filename(name, default="output"):
    """Make a track name safe for use as a filename on Windows / macOS / Linux."""
    cleaned = _FILENAME_FORBIDDEN.sub(" ", name or "")
    cleaned = _FILENAME_WHITESPACE.sub(" ", cleaned).strip()
    cleaned = cleaned.rstrip(". ")
    cleaned = cleaned.strip(_FILENAME_EDGEPUNCT)
    if not cleaned:
        cleaned = default
    return cleaned


def _song_subfolder(input_path):
    """
    Derive a subfolder name from the .gp5 input file. The folder holds
    per-track MIDI files so exports from different songs don't mix in
    the same directory.
    """
    head, tail = os.path.split(input_path)
    base, _ = os.path.splitext(tail)
    return _sanitize_filename(base, default="song")


def _auto_output_path(only_filters, input_path, only_index=None):
    """
    Build a default output path. Files are organized as
    <song_subfolder>/<track_name>_keyswitched.mid so exports from
    different songs don't collide in the same directory.

    Rules:
    - No --only filter: fall back to <song_subfolder>/output_keyswitched.mid.
    - --only matches exactly one track (or --only-index picks one):
        <song_subfolder>/<sanitized_track_name>_keyswitched.mid.
    - --only matches zero tracks: fall back to the default; the caller
        will report 'no tracks found' anyway.
    - --only matches multiple tracks and no --only-index: return None
        to signal the caller to require an explicit output path.
    """
    subfolder = _song_subfolder(input_path)
    if not only_filters:
        return os.path.join(subfolder, "output_keyswitched.mid")
    song = guitarpro.parse(input_path)
    matched = [t for t in song.tracks
               if any(f.lower() in _track_name(t) for f in only_filters)]
    n_matched = len(matched)
    if only_index is not None:
        if 1 <= only_index <= n_matched:
            matched = [matched[only_index - 1]]
        else:
            return None
    if len(matched) == 1:
        # When --only matched multiple tracks but --only-index picked one,
        # include the index in the filename so the file is uniquely named.
        suffix = f" ({only_index})" if only_index is not None and n_matched > 1 else ""
        return os.path.join(
            subfolder,
            f"{_sanitize_filename(matched[0].name)}{suffix}_keyswitched.mid",
        )
    if len(matched) == 0:
        return os.path.join(subfolder, "output_keyswitched.mid")
    return None  # ambiguous: caller must supply an output path


# ---------------------------------------------------------------------------
# ARTICULATION DETECTION
# ---------------------------------------------------------------------------
def detect_techniques(note):
    """
    Return a list of (technique_name, params_dict) tuples found on a note.

    The technique name is the key into KEYSWITCH_MAP. A technique that
    doesn't need to be split (e.g. palm_mute, harmonic) returns an empty
    params dict. Slides return a 'direction' parameter ('up' or 'down')
    based on the source pitch versus the next note on the same string.
    """
    techniques = []
    effect = getattr(note, "effect", None)
    if effect is None:
        return techniques

    # Palm mute: boolean flag.
    if getattr(effect, "palmMute", False):
        techniques.append(("palm_mute", {}))

    # Staccato: boolean flag.
    if getattr(effect, "staccato", False):
        techniques.append(("staccato", {}))

    # Harmonic: HarmonicEffect object when present (natural, artificial,
    # pinch, tap, semi, feedback). We collapse all harmonic flavors to one
    # 'harmonic' keyswitch; split by effect.harmonic.type if your SFZ needs
    # finer resolution.
    if getattr(effect, "harmonic", None) is not None:
        techniques.append(("harmonic", {}))

    # Hammer-on / pull-off: boolean flag. The METAL-GTX SFZ has a
    # dedicated Hammer-On patch triggered by keyswitch D1 (MIDI 26).
    if getattr(effect, "hammer", False):
        techniques.append(("hammer", {}))

    # Grace notes: stored as a GraceEffect on the note's effect. The
    # transition field tells us whether the grace slides, hammers, or
    # bends into the main note. In METAL-GTX, slide-in graces map to
    # D#1 (MIDI 27) and bend-in graces map to the bend keyswitch.
    grace = getattr(effect, "grace", None)
    if grace is not None:
        transition = getattr(grace, "transition", None)
        if transition is not None:
            t_name = getattr(transition, "name", str(transition))
            if t_name == "slide":
                techniques.append(("slide_in", {}))
            elif t_name == "hammer":
                techniques.append(("hammer", {}))
            elif t_name == "bend":
                techniques.append(("bend", {}))

    # Slides: iterable of slide types. Direction is determined by the
    # caller (see _resolve_slide_direction, which compares the slide
    # note's pitch to the next note on the same string). If direction
    # can't be determined, the slide defaults to 'slide_up'.
    slides = getattr(effect, "slides", None)
    if slides is not None:
        try:
            if len(slides) > 0:
                techniques.append(("slide", {}))
        except TypeError:
            techniques.append(("slide", {}))

    # Bend: BendEffect with a `points` list when present.
    if getattr(effect, "bend", None) is not None:
        techniques.append(("bend", {}))

    return techniques


def _resolve_slide_direction(note, track_notes, note_index):
    """
    Determine whether a slide note goes up or down.

    The PYGuitarPro note carries a slide flag but not the target pitch.
    The target is the next note (in time) on the same string. The caller
    passes a flat list of all notes in the track and the current note's
    index in that list.

    Returns 'up', 'down', or None (when direction cannot be determined).
    """
    if note.string is None:
        return None
    src_pitch = note.realValue
    # Look ahead for the next note on the same string.
    for later in track_notes[note_index + 1:]:
        if getattr(later, "string", None) == note.string:
            if later.realValue > src_pitch:
                return "up"
            if later.realValue < src_pitch:
                return "down"
            return None  # same pitch: ambiguous
    return None


def _expand_slide(tech, params, direction):
    """
    Resolve a 'slide' technique into 'slide_up' or 'slide_down' based on
    the pre-computed direction. For other techniques, return the name
    unchanged so the keyswitch-map lookup works.
    """
    if tech != "slide":
        return tech
    if direction == "down":
        return "slide_down"
    return "slide_up"  # default + 'up'


def _build_tie_chain_map(track):
    """
    Walk every note in the track and compute the absolute end-tick of
    each note's envelope. Tied notes share the same attack as their
    progenitor, so the progenitor's note_off is set to the end of the
    last tied continuation. The map is keyed by id(note).

    Returns a dict {id(note): end_tick} where end_tick is the absolute
    tick at which the note's note_off should fire.
    """
    note_end = {}
    # Walk beats in time order, tracking the most recent non-tied note
    # on each (string, pitch) pair.
    active = {}  # (string, pitch) -> id(note)
    for measure in track.measures:
        for voice in measure.voices:
            if voice.isEmpty:
                continue
            for beat in voice.beats:
                beat_start = int(beat.start)
                beat_dur = int(beat.duration.time)
                for note in beat.notes:
                    if note.type == guitarpro.NoteType.dead:
                        continue
                    key = (note.string, note.realValue)
                    note_dur = int(round(beat_dur * float(note.durationPercent)))
                    if note.type == guitarpro.NoteType.tie:
                        # Continuation of the active note on this key.
                        progenitor = active.get(key)
                        if progenitor is not None:
                            # Extend the progenitor's end tick.
                            note_end[progenitor] = beat_start + note_dur
                        # Note: tied notes themselves don't get their own
                        # note_on/note_off — they share the attack.
                    else:
                        # New attack. Register it as the active note on
                        # this key, and finalize its end tick (for now).
                        note_end[id(note)] = beat_start + note_dur
                        active[key] = id(note)
    return note_end


# ---------------------------------------------------------------------------
# CONVERSION
# ---------------------------------------------------------------------------
def _clamp(value, lo, hi):
    """Clamp an int-castable value to [lo, hi]."""
    return max(lo, min(hi, int(value)))


def convert(gp5_path, output_path="output_keyswitched.mid",
            keyswitch_map=None, include_bass=None,
            emit_sustain_reset=None, trim_silence=None,
            fallback_velocity=None, only=None, only_index=None, verbose=True):
    """
    Parse a Guitar Pro 5 file and write a keyswitched MIDI file.

    Parameters
    ----------
    gp5_path : str
        Path to the .gp5 input file.
    output_path : str
        Path for the generated MIDI file. Default: 'output_keyswitched.mid'.
    keyswitch_map : dict, optional
        Override the default technique -> keyswitch note mapping.
    include_bass : bool, optional
        If True, also process bass tracks. Defaults to INCLUDE_BASS.
    emit_sustain_reset : bool, optional
        If True, emit a sustain keyswitch (SUSTAIN_KEYSWITCH) at tick 0 of
        every processed track. Defaults to EMIT_SUSTAIN_RESET.
    fallback_velocity : int, optional
        Velocity used when a note has no explicit velocity. Defaults to
        DEFAULT_VELOCITY.
    only : str | iterable[str] | None, optional
        If given, only GP tracks whose name contains the supplied substring
        (case-insensitive) are considered. Pass a list for multiple filters.
    verbose : bool
        If True, print a summary of which tracks were processed / skipped.
    """
    if keyswitch_map is None:
        keyswitch_map = dict(KEYSWITCH_MAP)
    if include_bass is None:
        include_bass = INCLUDE_BASS
    if emit_sustain_reset is None:
        emit_sustain_reset = EMIT_SUSTAIN_RESET
    if trim_silence is None:
        trim_silence = TRIM_SILENCE
    if fallback_velocity is None:
        fallback_velocity = DEFAULT_VELOCITY
    if only is None:
        only_filters = None
    elif isinstance(only, str):
        only_filters = [only]
    else:
        only_filters = list(only)
    if only_index is None:
        only_index = None  # explicit
    # When only_index is used, switch to exact-match filtering so the
    # picked track is unique (substring match would still match the
    # other same-named tracks).
    only_exact = False
    only_track = None  # pinned track object when only_index is set

    song = guitarpro.parse(gp5_path)

    if only_filters is not None and only_index is not None:
        matched = [t for t in song.tracks
                   if any(f.lower() in _track_name(t).lower() for f in only_filters)]
        if 1 <= only_index <= len(matched):
            # Pin to a specific track by id() so the partition loop
            # can match exactly one track (since name-based filters would
            # still match both same-named tracks).
            only_filters = None  # disable name filter
            only_track = matched[only_index - 1]
        else:
            print(f"ERROR: --only-index {only_index} out of range "
                  f"(only {len(matched)} matches found)", file=sys.stderr)
            return None  # let caller handle ambiguous / out-of-range

    # PyGuitarPro stores timing on the parent beat:
    #     beat.start        -> absolute tick of the beat
    #     beat.duration.time -> duration in ticks at 960 PPQ (already
    #                           accounts for dotted/tuplet)
    #     note.durationPercent -> how much of the beat the note occupies
    # The MIDI file uses 960 ticks per beat to match that domain exactly,
    # so the 1-tick keyswitch offset is preserved precisely.
    mid = mido.MidiFile(type=1, ticks_per_beat=960)

    # ---- Track 0: conductor (tempo + time signature) --------------------
    conductor = mid.add_track("Conductor")
    # mido's set_tempo takes microseconds per quarter note, not BPM.
    # Guitar Pro stores the song tempo as BPM, so we convert.
    bpm = int(song.tempo) if getattr(song, "tempo", None) else 120
    tempo = int(60_000_000 / bpm)
    conductor.append(mido.MetaMessage("set_tempo", tempo=tempo, time=0))

    if song.tracks and song.tracks[0].measures:
        first_ts = song.tracks[0].measures[0].timeSignature
        if first_ts is not None:
            # `denominator` is a Duration struct whose `.value` is the
            # actual denominator (4 for quarter, 8 for eighth, 16 for
            # sixteenth). It is NOT a 2** enum like in some older GP
            # versions. The MIDI `time_signature` meta uses the same
            # denominator number directly.
            actual_denom = int(first_ts.denominator.value)
            conductor.append(mido.MetaMessage(
                "time_signature",
                numerator=int(first_ts.numerator),
                denominator=actual_denom,
                time=0,
            ))

    # ---- Partition tracks: included (guitar / bass) vs. skipped --------
    included_guitar = []
    included_bass   = []
    skipped_tracks  = []
    for gp_track in song.tracks:
        name = _track_name(gp_track)
        raw_name = getattr(gp_track, "name", None) or ""
        if only_track is not None:
            # Only the pinned track passes.
            if gp_track is not only_track:
                skipped_tracks.append(gp_track)
                continue
        elif only_filters is not None:
            if only_exact:
                # Match against the raw (case-preserving) track name.
                if raw_name not in only_filters:
                    skipped_tracks.append(gp_track)
                    continue
            else:
                if not any(f.lower() in name for f in only_filters):
                    skipped_tracks.append(gp_track)
                    continue
        category, _kind = _classify_track(gp_track)
        if category == "guitar":
            included_guitar.append(gp_track)
        elif category == "bass" and include_bass:
            included_bass.append(gp_track)
        else:
            skipped_tracks.append(gp_track)

    if MERGE_BY_INSTRUMENT:
        buckets = _bucket_tracks_by_kind(included_guitar, included_bass)
    else:
        # One output MIDI track per GP track. The channel the track had
        # in the .gp5 file is preserved on the message events; the MIDI
        # track itself is named after the GP track.
        buckets = []
        for t in included_guitar + included_bass:
            ch_obj = getattr(t, "channel", None)
            raw_ch = getattr(ch_obj, "channel", None)
            channel = int(raw_ch) if raw_ch is not None else 0
            if channel == 9:  # never reuse GM percussion
                channel = 0
            label = t.name or "Guitar"
            buckets.append((label, f"track:{label}", [t]))

    if not buckets:
        if verbose:
            print("No guitar"
                  + ("/bass" if include_bass else "")
                  + " tracks found in this file.")
        parent = os.path.dirname(output_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        mid.save(output_path)
        return output_path

    # ---- Per-bucket processing ----------------------------------------
    # Each bucket produces exactly one MIDI track on a single channel.
    # Notes from multiple GP tracks within a bucket are merged in absolute
    # tick space, then sorted, so the 1-tick-before keyswitch relationship
    # is preserved across tracks.
    written_buckets = []
    for bucket_idx, (label, kind_name, tracks) in enumerate(buckets, start=1):
        if MERGE_BY_INSTRUMENT:
            channel = _midi_channel_for(kind_name)
        else:
            # When unmerged, the channel is the GP track's own channel so
            # the output matches how the track was originally authored.
            ch_obj = getattr(tracks[0], "channel", None)
            raw_ch = getattr(ch_obj, "channel", None)
            channel = int(raw_ch) if raw_ch is not None else 0
            if channel == 9:
                channel = 0

        # Collect (absolute_tick, mido.Message) pairs for this bucket.
        events = []
        # Set of (tick, channel) where a default sustain key has already
        # been queued for this bucket. Prevents one sustain key per
        # note in a chord (e.g. notes 50, 45, 38 at one tick emit a
        # single sustain key, not three).
        pending_default_sustain = set()

        for gp_track in tracks:
            # Pre-collect every note in the track in time order. After
            # the full list is built, compute slide direction for each
            # note that has a slide — direction is determined by comparing
            # the slide note's pitch to the next note on the same string
            # (the slide target).
            track_notes = []
            for measure in gp_track.measures:
                for voice in measure.voices:
                    if voice.isEmpty:
                        continue
                    for beat in voice.beats:
                        for note in beat.notes:
                            track_notes.append(note)
            slide_direction = {}
            for idx, note in enumerate(track_notes):
                if getattr(note.effect, "slides", None):
                    slide_direction[id(note)] = _resolve_slide_direction(
                        note, track_notes, idx)
            # Pre-compute the end-tick of every note's envelope, taking
            # tied continuations into account. Without this, a note with
            # tied continuations gets its note_off at the end of the
            # first beat, cutting the tail short.
            note_end = _build_tie_chain_map(gp_track)

            for measure in gp_track.measures:
                for voice in measure.voices:
                    if voice.isEmpty:
                        continue
                    for beat in voice.beats:
                        for note in beat.notes:
                            # Tied continuations do not replay a pitched
                            # note (they share the previous attack's
                            # envelope), but they CAN carry new
                            # articulations — e.g. a tied note with a
                            # bend means the bend starts on the tied
                            # side, not the original attack. Emit
                            # keyswitches for tied notes with techniques,
                            # but skip the pitched note_on/note_off.
                            if note.type == guitarpro.NoteType.dead:
                                continue
                            tied_loud = (note.type == guitarpro.NoteType.tie)
                            techniques_early = []
                            if tied_loud:
                                techniques_early = [
                                    (t, p) for (t, p) in detect_techniques(note)
                                    if keyswitch_map.get(_expand_slide(t, p, slide_direction.get(id(note)))) is not None
                                ]
                                if not techniques_early:
                                    continue
                                # Fall through: emit keyswitches only.

                            # Timing lives on the beat; the note can only
                            # shorten its slot (durationPercent). When the
                            # note has a tied continuation, the note_end
                            # map gives the absolute end-tick of the
                            # entire tie chain (the note's envelope
                            # extends through all tied continuations).
                            start    = int(beat.start)
                            note_end_tick = note_end.get(id(note))
                            if note_end_tick is not None:
                                duration = note_end_tick - start
                            else:
                                duration = int(round(beat.duration.time
                                                     * float(note.durationPercent)))
                            if duration < 1:
                                duration = 1
                            pitch    = _clamp(note.realValue, 0, 127)

                            velocity = int(getattr(note, "velocity", 0) or 0)
                            if velocity < 1:
                                velocity = fallback_velocity
                            velocity = _clamp(velocity, 1, 127)

                            # ---- Emit explicit keyswitches per note ----
                            # Every note gets an explicit keyswitch(es)
                            # at `start` (the SAME tick as the pitched
                            # note's note_on). The keyswitch is appended
                            # to the event list BEFORE the pitched note_on,
                            # so within the same tick it arrives first in
                            # the MIDI stream — Sforzando accepts this
                            # and behaves identically to a 1-tick-before
                            # trigger. The natural off time is start +
                            # KEYSWITCH_DURATION_TICKS (a quarter note so
                            # it shows up in the DAW piano roll), then a
                            # later post-process pass clamps it to the
                            # next event on the same channel so two
                            # consecutive keyswitches never overlap.
                            #
                            # If the note has no articulation (e.g. a
                            # clean chord) AND the user has enabled
                            # EMIT_SUSTAIN_RESET, tag this note as
                            # 'default-sustain-candidate'. Per-tick, we
                            # emit a single default sustain key on the
                            # first such note — this guarantees the sampler
                            # is always in a known state, regardless of
                            # what the previous sample held (which fixes
                            # the common case where a palm-mute figure
                            # ends and the next clean chord is played in
                            # the wrong still-palm-muted state), and
                            # avoids duplicate sustain keys on chords.
                            techniques = detect_techniques(note)
                            if any(ks_notes_emitted for _ in []):  # placeholder
                                pass
                            ks_notes_emitted = []
                            has_articulation = False
                            for tech, params in techniques:
                                if tech == "slide":
                                    direction = slide_direction.get(id(note))
                                    tech = "slide_down" if direction == "down" else "slide_up"
                                ks_note = keyswitch_map.get(tech)
                                if ks_note is None:
                                    continue
                                if ks_note == 26:
                                    import sys as _sys
                                ks_note = _clamp(ks_note, 0, 127)
                                ks_notes_emitted.append(ks_note)
                                has_articulation = True

                            if not has_articulation and emit_sustain_reset:
                                # Defer: emit one default sustain per
                                # (tick, channel) below, after the loop.
                                if (start, channel) not in pending_default_sustain:
                                    pending_default_sustain.add((start, channel))
                                    ks_notes_emitted.append(_clamp(SUSTAIN_KEYSWITCH, 0, 127))

                            for ks_note in ks_notes_emitted:
                                ks_on   = start
                                ks_off  = ks_on + KEYSWITCH_DURATION_TICKS
                                events.append((
                                    ks_on,
                                    mido.Message("note_on",  channel=channel,
                                                 note=ks_note, velocity=velocity,
                                                 time=0),
                                ))
                                events.append((
                                    ks_off,
                                    ("keyswitch_off", ks_note, channel),
                                ))

                            # ---- The actual pitched note --------------
                            # Skip note_on/note_off for tied notes (the
                            # pitch is already sounding from the
                            # original attack).
                            if not tied_loud:
                                events.append((
                                    start,
                                    mido.Message("note_on",  channel=channel,
                                                 note=pitch, velocity=velocity,
                                                 time=0),
                                ))
                                events.append((
                                    start + duration,
                                    mido.Message("note_off", channel=channel,
                                                 note=pitch, velocity=0,
                                                 time=0),
                                ))
        if not events:
            if verbose:
                print(f"  [{bucket_idx}] {label}: no notes, skipping")
            continue

        # ---- Resolve keyswitch_off placeholders into real note_off ----
        # ---- messages with clamped ticks. Three constraints:         ----
        # ---- 1. keyswitch note_off must arrive at or before           ----
        # ----    key_on_tick + KEYSWITCH_DURATION_TICKS               ----
        # ---- 2. successive keyswitch note_on on the same channel/note-
        # ----    is treated as a re-trigger: the previous key closes   ----
        # ----    *at the tick of the next note_on* and a new key opens. -
        # ---- 3. Any non-sentinel note_on / note_off on the same       ----
        # ----    channel/note also closes the open key (same as 2).    ----
        keyswitch_notes = {v for v in KEYSWITCH_MAP.values() if v is not None}
        keyswitch_notes.add(SUSTAIN_KEYSWITCH)
        import sys as _sys
        n26_post_loop = sum(1 for t, p in events
                            if hasattr(p, 'note') and p.note == 26
                            and p.type == 'note_on' and getattr(p, 'velocity', 0) > 0)
        events.sort(key=lambda e: e[0])

        # DEBUG: count 26 in events
        n26 = sum(1 for t, p in events
                  if hasattr(p, 'note') and p.note == 26
                  and p.type == 'note_on' and getattr(p, 'velocity', 0) > 0)
        n26_tup = sum(1 for t, p in events
                      if isinstance(p, tuple) and p[0] == 'keyswitch_off' and p[1] == 26)
        if n26 > 0:
            pass
        def _close_oldest_open(ch, note, at_tick, out):
            stack = open_keyswitch_stacks.get((ch, note))
            if not stack:
                return
            ks_on = stack.pop(0)
            if not open_keyswitch_stacks[(ch, note)]:
                del open_keyswitch_stacks[(ch, note)]
            cap = ks_on + KEYSWITCH_DURATION_TICKS
            clamped = min(at_tick, cap)
            if clamped < ks_on:
                clamped = ks_on
            out.append((clamped, mido.Message(
                "note_off", channel=ch, note=note, velocity=0, time=0)))

        resolved = []
        open_keyswitch_stacks = {}
        for tick, payload in events:
            if isinstance(payload, tuple) and payload and payload[0] == "keyswitch_off":
                _, ks_note, ch = payload
                _close_oldest_open(ch, ks_note, tick, resolved)
            elif isinstance(payload, mido.Message) and payload.type == "note_on" \
                    and payload.note in keyswitch_notes:
                # Close any still-open key on the same channel/note at
                # this tick (re-trigger semantics).
                _close_oldest_open(payload.channel, payload.note, tick, resolved)
                resolved.append((tick, payload))
                open_keyswitch_stacks.setdefault(
                    (payload.channel, payload.note), []).append(tick)
            elif isinstance(payload, mido.Message) and payload.type == "note_off" \
                    and payload.note in keyswitch_notes:
                # An explicit note_off from the emitter (e.g. the user
                # inserted one) closes the open key.
                _close_oldest_open(payload.channel, payload.note, tick, resolved)
            else:
                resolved.append((tick, payload))
        events = resolved

        midi_track = mid.add_track(label)
        last_tick  = 0
        for abs_tick, msg in events:
            msg.time  = max(0, abs_tick - last_tick)
            last_tick = abs_tick
            midi_track.append(msg)

        written_buckets.append((label, kind_name, len(tracks), channel))

    # ---- Trim leading silence -------------------------------------------
    # If the user asked for trim_silence, find the earliest absolute tick
    # across all tracks and shift every event so the first one lands at
    # tick 0. This removes empty intro bars.
    if trim_silence:
        earliest = None
        for tr in mid.tracks:
            abs_t = 0
            for msg in tr:
                abs_t += msg.time
                if isinstance(msg, mido.MetaMessage) and msg.type == "time_signature":
                    if abs_t > 0 and (earliest is None or abs_t < earliest):
                        earliest = abs_t
                if isinstance(msg, mido.Message) and msg.type in (
                        "note_on", "note_off"):
                    if earliest is None or abs_t < earliest:
                        earliest = abs_t
        if earliest is not None and earliest > 0:
            for tr in mid.tracks:
                # Walk events, accumulate times, rewrite each with the
                # shift. Events that fall before the earliest tick are
                # dropped or kept at time 0 (meta only).
                rebuilt = []
                abs_t = 0
                first_real_done = False
                for msg in tr:
                    new_abs = abs_t - earliest
                    abs_t += msg.time
                    if new_abs < 0:
                        # Drop note events; keep meta (set_tempo, track_name,
                        # time_signature, end_of_track) at time 0. Use
                        # copy(time=0) to preserve the original meta values.
                        if isinstance(msg, mido.MetaMessage):
                            rebuilt.append(msg.copy(time=0))
                        continue
                    # Update the delta time so the event lands at new_abs.
                    if not first_real_done:
                        msg.time = new_abs
                        first_real_done = True
                    rebuilt.append(msg)
                tr.clear()
                for m in rebuilt:
                    tr.append(m)
    parent = os.path.dirname(output_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    mid.save(output_path)

    # ---- Summary --------------------------------------------------------
    if verbose:
        for label, kind_name, n_gp, channel in written_buckets:
            if n_gp == 1:
                print(f"  {label}  [{kind_name}]  channel {channel}")
            else:
                print(f"  {label}  [{kind_name}]  channel {channel}  "
                      f"(merged {n_gp} GP tracks)")
        if skipped_tracks:
            print(f"Skipped {len(skipped_tracks)} other track(s):")
            for t in skipped_tracks:
                category, kind = _classify_track(t)
                print(f"      - {t.name or '(unnamed)'}  "
                      f"[{kind} -> {category}]")

    return output_path


# ---------------------------------------------------------------------------
# CLI ENTRY POINT
# ---------------------------------------------------------------------------
def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="gp5_to_keyswitched_mid",
        description=(
            "Convert a Guitar Pro 5 file to a Sforzando keyswitched MIDI. "
            "Only guitar tracks are processed by default; pass --include-bass "
            "to also process bass tracks."
        ),
    )
    parser.add_argument("input",
                        help="Path to the input .gp5 file")
    parser.add_argument("output",
                        nargs="?",
                        default=None,
                        help="Path for the output MIDI file. If omitted, the "
                             "tool derives a name from the GP track name "
                             "when --only matches one track; otherwise it "
                             "uses 'output_keyswitched.mid'.")
    parser.add_argument("-b", "--include-bass",
                        action="store_true",
                        help="Also process bass tracks (skipped by default).")
    parser.add_argument("-V", "--velocity",
                        type=int,
                        default=DEFAULT_VELOCITY,
                        help="Fallback velocity 1-127 for notes missing one "
                             "(default: %(default)s).")
    parser.add_argument("-R", "--no-sustain-reset",
                        action="store_true",
                        help="Do NOT emit a sustain key on every non-"
                             "articulated note. By default, every note "
                             "without an articulation carries a sustain "
                             "key so the sampler is always in a known "
                             "state (no stale palm-mute bleeding into "
                             "clean chords).")
    parser.add_argument("-q", "--quiet",
                        action="store_true",
                        help="Suppress the per-track summary.")
    parser.add_argument("-o", "--only",
                        action="append",
                        default=None,
                        help="Only process GP tracks whose name contains this "
                             "substring (case-insensitive). Repeat for "
                             "multiple names, e.g. -o Roberto -o DANY.")
    parser.add_argument("-T", "--no-trim-silence",
                        action="store_true",
                        help="Do NOT trim leading silence. By default the "
                             "first event lands at tick 0, so empty intro "
                             "bars from the GP file are removed from the "
                             "MIDI output.")
    parser.add_argument("--only-index", type=int, default=None,
                        help="When --only matches multiple tracks, pick "
                             "the Nth (1-based) match. Useful when several "
                             "tracks share a name.")
    args = parser.parse_args(argv)

    # Resolve output path: explicit > auto-derived from --only > default.
    if args.output is None:
        args.output = _auto_output_path(args.only, args.input, only_index=args.only_index)
        if args.output is None:
            print("ERROR: --only matched multiple tracks; please supply an "
                  "explicit output path or use --only-index to disambiguate.",
                  file=sys.stderr)
            return 4

    try:
        result = convert(
            args.input,
            args.output,
            include_bass=args.include_bass,
            emit_sustain_reset=not args.no_sustain_reset,
            trim_silence=not args.no_trim_silence,
            fallback_velocity=args.velocity,
            only=args.only,
            only_index=args.only_index,
            verbose=not args.quiet,
        )
    except FileNotFoundError:
        print(f"ERROR: input file not found: {args.input}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 3

    if result is None:
        # convert() couldn't resolve the track selection.
        return 4

    print(f"OK: wrote {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
