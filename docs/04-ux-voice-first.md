# 04 — UX: Voice-First Design

## Core principle

**Voice is the primary surface. The visual grid is optional and layered.**

A drummer with their hands full should be able to use PatternTalk without putting down sticks. A blind drummer using NVDA should be able to use it without sighted help. Sighted users get a parallel visual experience, but it never blocks the voice flow.

## Voice technology

### Speech-to-Text (STT)

**Web Speech API: `SpeechRecognition`**

```typescript
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = "en-US";

recognition.onresult = (event) => {
  const last = event.results[event.results.length - 1];
  if (last.isFinal) {
    onFinalTranscript(last[0].transcript.trim());
  } else {
    onInterimTranscript(last[0].transcript);
  }
};
```

**Compatibility:** Chrome, Edge, Safari. Firefox has it but disabled by default. For the hackathon demo, Chrome is the assumption.

**Accessibility note:** Screenreaders (NVDA, VoiceOver) do NOT consume Web Speech API STT output — they have their own voice input path. So STT is for users *without* a screenreader or for users who want hands-free. Screenreader users will type or use their screenreader's voice control. Both paths converge on the same prompt parser.

### Text-to-Speech (TTS)

**Web Speech API: `SpeechSynthesis`**

```typescript
function speak(text: string, opts: { interrupt?: boolean } = {}) {
  if (opts.interrupt) speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;  // slightly faster than default for snappy feel
  utterance.pitch = 1.0;
  speechSynthesis.speak(utterance);
}
```

**Voice selection:** Use the system default voice. No fancy custom voices — keeps the demo reliable across machines.

**Accessibility note:** When a screenreader is active, `SpeechSynthesis` is muted by the screenreader (it doesn't double-speak). The text is read by the screenreader using the same DOM. This is exactly what we want.

## The conversation loop

PatternTalk maintains a state machine for voice interactions:

```
states: idle → listening → parsing → generating → ready → (next action)
```

### State diagram

```
[IDLE]
  │ user clicks "Start" or presses Space
  ▼
[LISTENING]
  │ mic captures audio
  │ interim transcripts shown
  │ user pauses or says a wake word
  ▼
[PARSING]
  │ onomatopoeia matcher → pattern
  │ prompt parser → ParsedRequest
  │ tempo resolver → final tempo
  ▼
[GENERATING]
  │ pattern engine → MIDI events
  │ audio service → sample (async)
  │ speak: "Generating skank beat, 4 bars..."
  ▼
[READY]
  │ speak: "Skank beat ready. MIDI and sample generated.
  │        Say 'play' to preview, 'regenerate' to try again,
  │        'download MIDI', 'download sample',
  │        or 'new pattern' to start over."
  │
  ├─ user: "play" → [PLAYING]
  ├─ user: "regenerate" → [GENERATING] (4 variations possible)
  ├─ user: "download MIDI" → trigger download
  ├─ user: "download sample" → trigger download
  └─ user: "new pattern" → [LISTENING]
```

### Wake word

A simple wake word avoids the "always listening" creep:

- **Wake word:** "PatternTalk" (or user-configurable)
- After wake word, the system listens for one command
- Optional: continuous listening mode for power users

For the demo, "always listening with a push-to-talk toggle" is simpler. Use Spacebar or click to start/stop listening.

## Voice commands

### Generation commands

| User says | System does |
|---|---|
| "Tupatupatupa on the hihat, 4 bars" | Generates skank beat (4 bars) |
| "4 bars of d-beat riding the crash at 180" | Generates d-beat (4 bars, 180 BPM, ride-bell → crash override) |
| "8 bars of skank beat" | Generates skank (8 bars, default tempo) |
| "Triplet-driven double bass with accents on the one and the three" | Generates djent-polyrhythm (4 bars, default tempo, accents on 1 and 3) |
| "Match my project tempo" | Sets `tempoSource = "reaper"` |
| "Set tempo to 160" | Overrides tempo |
| "Half-time feel" | Applies half-time modifier |
| "Swing it" | Applies swing feel |

### Action commands

| User says | System does |
|---|---|
| "Play" / "Preview" | Plays the generated sample |
| "Stop" | Stops playback |
| "Regenerate" / "Try again" | Generates new variation |
| "Variations" | Generates 4 variations |
| "Pick number 2" | Selects variation 2 |
| "Download MIDI" | Downloads .mid |
| "Download sample" | Downloads .wav |
| "New pattern" / "Start over" | Resets to listening |
| "Help" | Reads command list |
| "Repeat" | Re-speaks the last response |

### Sample-generation commands

| User says | System does |
|---|---|
| "Give me a trashy china" | Generates china one-shot |
| "Snare sample, brutal" | Generates snare one-shot (intensity=brutal) |
| "Loop preview" | Generates 8-second loop of current pattern |
| "Tighter snare" | Generates snare variant |

## Visual language — hardware / metallic reference

The rack is styled as a hardware sampler. Source-of-truth visual reference:

- **`toggle-switch.webp`** (repo root) — the metallic toggle-switch aesthetic to
  match. Classic industrial 2-position toggle:
  - **Chrome ball knob** on a **hexagonal metal housing** (reads as a polished
    steel nut), seated in a **brushed-aluminum plate**.
  - **Blue ON / red OFF** labels (colored inserts in the metal plate).
  - Depth cues that sell it: specular highlight on the knob, drop shadow of the
    knob onto the housing, inner shading on the hex recess, soft outer shadow on
    the plate, clean bold sans-serif labels.
- The existing engine rocker (`apps/web/app/globals.css` `.engine-toggle`) is the
  in-app analog — brushed-steel two-position rocker. Keep any new toggle/switch
  in the same metallic language (ball-on-hex for a literal toggle, brushed steel
  for a rocker), not flat web styling.

## Screen layout (visual fallback)

When the user is sighted, the visual layout has these regions:

```
┌─────────────────────────────────────────────────────┐
│ PatternTalk                            [help] [×]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  🎤 [Listening...]                                  │
│                                                     │
│  You said: "tupatupatupa on the hihat, 4 bars"     │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ Pattern: Skank Beat                           │ │
│  │ Tempo: 120 BPM (say "match project")          │ │
│  │ Bars: 4                                       │ │
│  │ Status: Ready                                 │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ [Visual grid — bars of colored dots]          │ │
│  │ ●K ●K ●S ●K ●K ●K ●S ●K                        │ │
│  │ ●H ●H ●H ●H ●H ●H ●H ●H                        │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  [Play]  [Download MIDI]  [Download Sample]         │
│  [Regenerate]  [Variations (4)]  [New Pattern]     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**The visual grid is hidden by default** in voice-first mode. Sighted users can toggle it on. It's also hidden when a screenreader is detected (to reduce clutter, since the screenreader will read the description anyway).

## Visual grid component

For each bar in the pattern, render a row of dots:

```
Bar 1 of 4 — Skank Beat at 120 BPM
● · ● · ● · ● ·     ← kick (red, larger)
· ● · ● · ● · ●     ← snare (blue, smaller)
● ● ● ● ● ● ● ●     ← hi-hat (yellow, medium)
```

Each limb has:
- A color (configurable)
- A size (kick = large, snare = medium, hi-hat = small)
- A label tooltip on hover

**Accessibility:** The grid has an `aria-label` summarizing the pattern:

```html
<div role="img" aria-label="Skank beat, 4 bars at 120 BPM. Kick on every beat with 8th note doubles. Snare on 2 and 4. Hi-hat on every 8th note.">
  <!-- visual dots -->
</div>
```

## Keyboard navigation

Every action has a keyboard equivalent. No mouse required.

| Key | Action |
|---|---|
| `Space` | Start/stop listening |
| `Enter` | Confirm current selection / play preview |
| `Tab` | Move focus through controls |
| `1`-`4` | Pick variation N |
| `M` | Download MIDI |
| `S` | Download sample |
| `R` | Regenerate |
| `V` | Show variations |
| `N` | New pattern |
| `?` | Help (read command list) |
| `Esc` | Cancel current action |

Focus is always visible (high-contrast outline). When the screen announces something, focus moves to it so the screenreader reads it.

## Pattern library page (`/library`)

A separate page listing all patterns, with search and filter:

- Search by name, tag, or genre
- Filter by genre, tempo range
- Click to load into the main UI
- Share URL for any pattern (`/library?pattern=d-beat`)
- "Fork" button: duplicate a pattern into the user's localStorage library

**Accessibility:** Search is keyboard-driven. Results announced via `aria-live="polite"`. Filter chips have visible labels and ARIA states.

## Variations UI

When user asks for variations, show 4 mini-grids side by side:

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Var 1    │ │ Var 2    │ │ Var 3    │ │ Var 4    │  [press 1-4]
│ ●K ●K ●S │ │ ●K ●K ●K │ │ ●K ●K ●S │ │ ●K ●K ●S │
│ ·  ·S ·  │ │ ·S ·  ·S │ │ ·  ·S ·  │ │ ·  ·S ·  │
│ ●H ●H ●H │ │ ●H ●H ●H │ │ ●H ●H ●H │ │ ●H ●H ●H │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

Each variation has:
- A different velocity humanization
- A different micro-timing variation
- Sometimes a different fill at the end of the bar
- The patternId is the same; the variations are deterministic seeds of `engine.humanize()`

For the demo, pre-generate 4 variations and store them so the picker is instant.

## Sample preview player

Audio playback uses the Web Audio API:

```typescript
async function playPreview(audioBuffer: ArrayBuffer) {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(audioBuffer);
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.connect(ctx.destination);
  source.start(0);
}
```

The preview loops until the user says "stop" or presses Esc.

## Error handling

Voice systems fail. The UX must handle it gracefully.

| Failure | UX response |
|---|---|
| Mic permission denied | Show "Enable microphone in browser settings" + manual text input |
| SpeechRecognition unavailable | Fall back to text input, show banner |
| No onomatopoeia match | "I heard 'xyz', but I'm not sure what you mean. Try saying it differently, or pick from the list." |
| Pattern not found | "Pattern 'xyz' not found. Did you mean 'd-beat'?" |
| Audio service timeout | "Sample generation is taking longer than expected. Using cached sample. Say 'regenerate' to retry." |
| Audio service error | "Couldn't generate a sample. MIDI is still ready. Say 'download MIDI' to save." |
| Reaper not detected | "I don't see Reaper running. Say 'set tempo' to specify BPM manually." |

In all cases, the user is told what's happening. No silent failures.

## Performance budget

| Metric | Target |
|---|---|
| First meaningful paint | < 1.5s |
| Time to interactive (voice ready) | < 3s |
| Prompt → MIDI generation | < 500ms (in-browser, no I/O) |
| Prompt → sample ready | < 30s (cloud inference), < 5min acceptable (Vega inference) |
| Voice transcript latency | < 500ms |
| MIDI file download | < 200ms |

## Demo flow (3–4 minutes)

This is the rehearsal script:

```
[Open PatternTalk inside Reaper, mic icon visible]

DRUMMER: "PatternTalk, tupatupatupa on the hihat, 4 bars"

APP: "Skank beat, hi-hat upstrokes on the upbeats, 4 bars at 120 BPM.
      MIDI ready. Sample ready."

[Sighted users see grid + buttons. Blind drummer presses Tab to navigate.]

DRUMMER: "Match my project tempo"

APP: "Tempo set to 174 from Reaper project. Regenerating."

APP: "Done. 4 bars at 174 BPM. Say 'play' to preview."

DRUMMER: "Play"

[Audio plays through speakers]

DRUMMER: "Download MIDI"

APP: "MIDI downloaded."

[Drummer drags MIDI from browser downloads into Reaper track]

DRUMMER: "Regenerate, brutal"

APP: "Brutal mode engaged. Generating 4 variations."

[4 mini-grids appear]

DRUMMER: "Pick number 3"

APP: "Variation 3 selected. Preview playing."

DRUMMER: "New pattern. 4 bars of d-beat riding the crash at 180."

APP: "D-beat with crash ride, 4 bars at 180. Generating."

[Generation completes]

DRUMMER: "Show me the grid."

[Visual grid appears]

[Switch on NVDA. Demo screenreader navigation.]

DRUMMER: "Tab."

NVDA: "Generate button. Tab. Regenerate button. Tab. Variations button..."

DRUMMER: "Read the pattern."

NVDA: "D-beat pattern. Kick plays on every beat with 8th-note doubles.
       Snare hits on 2 and 4. Ride bell — no, crash — plays steady 8ths
       throughout. 4 bars at 180 BPM."

DRUMMER: "Download MIDI."

[Done]
```

## What this UX is not

- Not a chat interface. No typing back-and-forth. Voice is push-to-talk with clear states.
- Not a visual-first app with voice features. Voice IS the app.
- Not accessible as a feature. Accessibility is the design constraint that shaped voice-first.
- Not a music theory tutor. We don't explain what a blast beat *means*, we just play it.
