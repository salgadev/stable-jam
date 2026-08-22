# 03 — Data Model

## Overview

PatternTalk's core data is small and human-editable. Most of it lives in JSON files under `apps/web/data/` and `data/training/`.

```
Prompt (user voice/text)
  │
  ▼
ParsedRequest  ◄── onomatopoeia.json + prompt grammar
  │
  ▼
Pattern (loaded from patterns/*.json, expanded to bars + tempo)
  │
  ▼
MIDI events
  │
  ▼
.mid file
```

## Prompt grammar

User input is freeform text, but parses into a structured `ParsedRequest`.

```typescript
interface ParsedRequest {
  // Source pattern
  onomatopoeia?: string;          // e.g. "tupatupatupa"
  patternId?: string;             // e.g. "d-beat", "blast-traditional"
  patternName?: string;           // e.g. "D-Beat", user-friendly

  // Length
  bars: number;                   // default 4
  beats?: number;                 // override pattern beats per bar

  // Tempo
  tempo?: number;                 // explicit BPM
  tempoSource: "prompt" | "reaper" | "audio" | "default";
  tempoDefault: number;           // 120 if nothing else

  // Time signature
  timeSignature: {
    numerator: number;            // default 4
    denominator: number;          // default 4
  };

  // Cymbal/voice hints
  cymbal?: {
    type: "crash" | "ride" | "china" | "hihat-open" | "hihat-closed" | "splash";
    pattern?: "8ths" | "quarters" | "bell" | "wash" | "upstrokes";
  };

  // Accent overrides
  accents?: ("1" | "and-of-2" | "3" | "and-of-4" | string)[];

  // Style modifiers
  feel?: "straight" | "swing" | "half-time" | "double-time";
  intensity?: "soft" | "medium" | "brutal" | "brutal-max";
}
```

## Onomatopoeia mapping

`apps/web/data/onomatopoeia.json` is the lookup table the parser checks first.

```json
{
  "version": 1,
  "entries": [
    {
      "id": "skank-beat",
      "patterns": ["tupatupatupa", "tupa-tupa-tupa", "chka-chka-chka"],
      "patternId": "skank",
      "defaultCymbal": { "type": "hihat-open", "pattern": "upstrokes" },
      "confidence": 0.9,
      "notes": "Ska-style offbeat hi-hat upstrokes."
    },
    {
      "id": "blast-beat",
      "patterns": ["krrk-krrk-krrk", "BLAM-BLAM-BLAM", "krkrkrkrk"],
      "patternId": "blast-traditional",
      "defaultIntensity": "brutal",
      "confidence": 0.85,
      "notes": "Traditional blast beat. Kick-snare alternation."
    },
    {
      "id": "boom-bap",
      "patterns": ["boom-bap", "boom-bap-boom-bap"],
      "patternId": "hiphop-basic",
      "confidence": 0.95
    },
    {
      "id": "china-accent",
      "patterns": ["tss", "chka", "BLAM"],
      "patternId": "china-accent",
      "defaultCymbal": { "type": "china", "pattern": "wash" }
    },
    {
      "id": "ride-bell",
      "patterns": ["ding-ding-ding", "ding-ding-ding-ding"],
      "patternId": "ride-bell-8ths",
      "defaultCymbal": { "type": "ride", "pattern": "bell" }
    }
  ]
}
```

### Matching logic

1. Normalize input: lowercase, strip punctuation, collapse whitespace
2. Phonetic match: Soundex or simple Levenshtein against entries
3. Syllable count: "tupatupatupa" = 4 syllables → likely 8th-note hi-hat
4. Confidence threshold: 0.7 to auto-map, lower to ask user

### User-defined onomatopoeias

Users can add their own mappings via the UI. Stored in `localStorage` per device.

```typescript
interface UserOnomatopoeia {
  phrase: string;
  patternId: string;
  cymbal?: CymbalHint;
  createdAt: number;
}
```

## Pattern templates

`apps/web/data/patterns/*.json` — one file per pattern. Hand-authored. **This is your moat.**

```typescript
interface PatternTemplate {
  id: string;                      // unique slug
  name: string;                    // "D-Beat"
  description: string;             // screenreader-friendly text
  tags: string[];                  // searchable
  genre: "metal" | "rock" | "punk" | "pop" | "jazz" | "funk" | "latin" | "hiphop";
  defaultTempo: number;            // BPM
  defaultBars: number;             // how many bars this template covers
  swingRatio?: number;             // 0.0 = straight, 0.33 = shuffle
  hits: Hit[];
}

interface Hit {
  position: number;                // 0.0 to 1.0, fraction of one bar
  limb: Limb;
  velocity: number;                // 0-127 MIDI velocity
  accent?: boolean;                // visual + audio emphasis
}

type Limb =
  | "kick"           // right foot
  | "snare"          // left hand (default) or right hand (cross-handed)
  | "hihat"          // right hand (default) or left hand (cross-handed)
  | "hihat-open"     // same as hihat but with open hi-hat sample
  | "ride"
  | "ride-bell"
  | "crash"
  | "china"
  | "splash"
  | "tom-1"          // highest
  | "tom-2"
  | "tom-3"          // lowest floor tom
  | "cross-stick";   // rim click
```

### Example: D-Beat

`apps/web/data/patterns/d-beat.json`:

```json
{
  "id": "d-beat",
  "name": "D-Beat",
  "description": "D-beat pattern at 180 BPM. Kick plays on every beat with 8th-note doubles, snare hits on 2 and 4, ride bell plays steady 8ths throughout. Common in Discharge, Entombed, and Scandinavian crust punk.",
  "tags": ["metal", "punk", "discharge", "entombed", "crust", "fast"],
  "genre": "metal",
  "defaultTempo": 180,
  "defaultBars": 1,
  "swingRatio": 0,
  "hits": [
    { "position": 0.0,   "limb": "kick", "velocity": 110 },
    { "position": 0.125, "limb": "kick", "velocity": 80 },
    { "position": 0.25,  "limb": "snare", "velocity": 100 },
    { "position": 0.375, "limb": "kick", "velocity": 80 },
    { "position": 0.5,   "limb": "kick", "velocity": 110 },
    { "position": 0.625, "limb": "kick", "velocity": 80 },
    { "position": 0.75,  "limb": "snare", "velocity": 100 },
    { "position": 0.875, "limb": "kick", "velocity": 80 },
    { "position": 0.0,   "limb": "ride-bell", "velocity": 70 },
    { "position": 0.125, "limb": "ride-bell", "velocity": 70 },
    { "position": 0.25,  "limb": "ride-bell", "velocity": 70 },
    { "position": 0.375, "limb": "ride-bell", "velocity": 70 },
    { "position": 0.5,   "limb": "ride-bell", "velocity": 70 },
    { "position": 0.625, "limb": "ride-bell", "velocity": 70 },
    { "position": 0.75,  "limb": "ride-bell", "velocity": 70 },
    { "position": 0.875, "limb": "ride-bell", "velocity": 70 }
  ]
}
```

### Pattern library — starting list

**Metal (priority, 8 patterns):**
- `d-beat.json` — D-beat
- `blast-traditional.json` — traditional blast (kick-snare)
- `blast-hammer.json` — hammer-and-tongs blast
- `blast-hyper.json` — hyperblast (double kick 16ths)
- `half-time-metal.json` — Mastodon/Baroness half-time
- `djent-polyrhythm.json` — Meshuggah-style 4-over-3 kick
- `doom-slow.json` — Sleep/Electric Wizard doom
- `groove-metal.json` — mid-tempo groove metal

**Punk/Hardcore (4 patterns):**
- `punk-rock.json` — Ramones/Misfits 4-on-floor
- `hardcore.json` — Black Flag/Converge
- `skank.json` — ska skank beat (hi-hat upstrokes)
- `reggae-one-drop.json` — reggae

**Rock/Pop (4 patterns):**
- `rock-basic.json` — AC/DC/Beatles standard rock
- `rock-half-time.json` — half-time shuffle
- `pop-groove.json` — modern pop
- `country-train.json` — train beat

**Other genres (4 patterns):**
- `bossa-nova.json` — bossa nova
- `jazz-swing.json` — jazz ride swing
- `funk-new-orleans.json` — NOLA funk
- `hiphop-basic.json` — boom-bap

**Target: 18–20 patterns before hackathon, more as time permits.**

## Pattern engine

Lives in `apps/web/lib/patterns/engine.ts`.

### Inputs
- `PatternTemplate`
- `bars: number`
- `tempoBpm: number`
- `timeSignature: { numerator, denominator }`
- Optional `cymbal` override (replaces the default cymbal)
- Optional `accents` (boosts velocity on specified positions)
- Optional `feel` modifier

### Process

```
1. Load template
2. Expand to requested bars:
   - If template.defaultBars === requested bars: use as-is
   - Else: repeat the pattern N times, optionally vary velocity (humanize)
3. Apply cymbal override:
   - If cymbal specified: replace ride/hihat hits with cymbal type
   - Velocity scaled: cymbal typically quieter than snare
4. Apply accents:
   - Find positions matching accent specs
   - Boost velocity by +20
5. Apply feel modifier:
   - "swing": delay 8th notes on the "and" by swingRatio
   - "half-time": halve the effective tempo of snare/hihat
   - "double-time": double it
6. Convert positions (0.0-1.0) to absolute ticks at tempoBpm
7. Return array of MIDI events
```

### Output

```typescript
interface MidiEvent {
  tick: number;                    // absolute tick position
  limb: Limb;
  velocity: number;                // 0-127
  duration: number;                // ticks (typically 1-10 for drums)
}
```

## MIDI generation

`apps/web/lib/midi/generator.ts` uses `@tonejs/midi`.

```typescript
import { Midi } from "@tonejs/midi";

function eventsToMidi(events: MidiEvent[]): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(events.bpm);   // bpm on master track
  midi.header.timeSignature = [4, 4];

  const drums = midi.addTrack();
  drums.name = "PatternTalk Drums";

  for (const ev of events) {
    drums.addNote({
      midi: limbToGeneralMidi(ev.limb),
      ticks: ev.tick,
      durationTicks: ev.duration,
      velocity: ev.velocity / 127,
    });
  }

  return midi.toArray();
}

function limbToGeneralMidi(limb: Limb): number {
  // GM Drum Map
  const map: Record<Limb, number> = {
    "kick": 36,
    "snare": 38,
    "cross-stick": 37,
    "hihat": 42,
    "hihat-open": 46,
    "ride": 51,
    "ride-bell": 53,
    "crash": 49,
    "china": 52,
    "splash": 55,
    "tom-1": 50,
    "tom-2": 47,
    "tom-3": 45,
  };
  return map[limb];
}
```

## Audio sample prompts

When PatternTalk calls the audio service, the prompt includes both the pattern context and a style hint:

```typescript
interface AudioPrompt {
  pattern: string;                // pattern name
  limb?: Limb;                    // specific sample to generate
  styleHints: string[];           // ["brutal drums", "18-inch china", "trashy"]
  durationSeconds: number;        // 1-5 for one-shots, 5-15 for loops
  intensity: "soft" | "medium" | "brutal" | "brutal-max";
  loraAdapter?: string;           // "brutal-drums" by default
}
```

Examples:
- Limb-specific one-shot: `{ pattern: "D-Beat", limb: "china", styleHints: ["trashy", "18-inch", "panic-attack"], durationSeconds: 3, intensity: "brutal-max" }`
- Loop preview: `{ pattern: "D-Beat", styleHints: ["brutal drums", "tight snare"], durationSeconds: 8, intensity: "brutal" }`

## Training data manifest

`data/training/manifest.yaml` describes every audio file used to train the brutal-drum LoRA.

```yaml
version: 1
lora:
  name: patterntalk-brutal-drums
  base_model: stable-audio-3-small
  training_steps: 1500
  learning_rate: 1e-4
  rank: 32

samples:
  - id: kick-001
    path: oneshots/kick-tight.wav
    category: kick
    tags: [tight, clicky, triggered]
    source: original-recording
    license: CC-BY
    duration_seconds: 1.2

  - id: snare-discharge-001
    path: oneshots/snare-trashy.wav
    category: snare
    tags: [trashy, snappy, crust]
    source: freesound.org/user-x
    license: CC-BY
    duration_seconds: 0.8

  - id: loop-dbeat-discharge-style
    path: loops/dbeat-180.wav
    category: loop
    tags: [d-beat, 180bpm, discharge-style]
    source: original-recording
    license: CC-BY
    duration_seconds: 4.0
    bpm: 180
```

**License discipline:** All samples must be CC0, CC-BY, or original recordings. No unlicensed material. Documented in the manifest, surfaced in the model card.

## What we're explicitly not modeling (yet)

- User accounts (out of scope)
- Cloud-saved pattern libraries (localStorage only)
- Pattern remixing/chaining
- Time-signature patterns other than 4/4 (the parser supports it but templates are 4/4)
- Polymeter / metric modulation
- Genre mixing (one pattern per request, not hybrids)

These are all reasonable post-hackathon extensions.
