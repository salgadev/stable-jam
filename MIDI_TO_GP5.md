# MIDI → GP5/6 converter — design

## Goal
Convert a keyswitched MIDI file (one track at a time) back to a Guitar Pro 5/6 file.

## Direction
Mirror of `gp5_to_keyswitched_mid.py`. Where the forward script uses
`detect_techniques` to read articulations from `note.effect.*`, the reverse
script needs to infer articulations from the keyswitch note that
precedes each pitched note.

## Architecture

```
midi_to_gp5.py
├── parse MIDI → flat list of (track_name, channel, notes, keyswitches)
├── classify tracks (guitar / bass / drums)
├── for each pitched note, look at the preceding keyswitch note and
│   in the same tick → infer the technique
├── build a Song with one Track per MIDI track
└── write via guitarpro.write()
```

## Inference rules (keyswitch → technique)

Same dictionary as the forward script, inverted. Driven by `KEYSWITCH_NOTES`
which maps MIDI note number → technique name:

| Note | Technique | GP5 effect |
|------|-----------|------------|
| 17 / 18 | sustain | (no effect — sustain is the default) |
| 20 | palm_mute | `effect.palmMute = True` |
| 9 | harmonic | `effect.harmonic = HarmonicEffect(type=Natural)` |
| 23 | slide_down | `effect.slides = [SlideType.shiftSlideTo]` (with next-note direction) |
| 24 | slide_up | same |
| 26 | hammer | `effect.hammer = True` |
| 27 | slide_in | `effect.grace = GraceEffect(transition=slide)` |
| 91 | bend | `effect.bend = BendEffect(points=[...])` |

Drum notes use standard GM mappings (MIDI 36 = kick, 38 = snare, 42 = hi-hat closed).

## Open questions

1. **Tie detection**: notes whose `note_on` happens before the previous
   `note_off` for the same pitch → ties. Inferred from MIDI timing.
2. **Bend reconstruction**: reading pitch wheel events from MIDI is
   possible but fragile. Most keyswitch-instrumented MIDIs don't include
   pitch bend. Initially: skip bend (write straight notes).
3. **Slide direction (up/down)**: target pitch is the next note on the
   same channel. We don't know the target string, so we use the pitch
   comparison and let the bar position fill in.
4. **String/fret selection**: pick the lowest playable fret on the
   appropriate string. Not unique; heuristic only.
5. **Tuning**: read from existing GP5 file or default to standard EADGBE.
6. **Track routing**: user passes `--track-name "Distortion Guitar"` and
   `--instrument guitar|bass|drums` to control the new GP track.

## File layout

```
midi_to_gp5.py    # the converter
tests/
  test_midi_to_gp5.py    # round-trip tests
  expected/
    *.mid    # input fixtures (committed)
    *.gp5    # expected outputs (committed)
```

## Status

- [x] Design above
- [ ] MIDI parser
- [ ] Track classifier
- [ ] Articulation inferer
- [ ] Song builder
- [ ] Tests
