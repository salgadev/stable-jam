# 05 — Accessibility Strategy

## Why this isn't an afterthought

PatternTalk's founder runs [Narwall.tech](https://narwall.tech), an accessibility testing tool that uses a real screenreader to find compliance gaps. The hackathon's Accessibility & Inclusion theme is listed as a first-class track. The target users include blind and visually impaired producers, a population currently locked out of almost every AI music tool.

So accessibility is **load-bearing**, not a checklist. The voice-first design (see [`04-ux-voice-first.md`](04-ux-voice-first.md)) was driven by accessibility, not the other way around.

## Principles

1. **Test with real assistive technology, not just linters.** axe-core catches ~30% of issues. NVDA and VoiceOver catch the rest.
2. **Voice-first is screenreader-first.** Building the voice layer well means the screenreader layer works for free.
3. **Every action has a keyboard equivalent.** No mouse-only paths.
4. **Every pattern has a textual description.** Not an afterthought caption — the description is the data.
5. **No information conveyed by color alone.** The visual grid uses size, position, and label too.
6. **Works at 200% zoom and at high contrast.** Tested with Windows High Contrast Mode.

## Standards we comply with

- **WCAG 2.2 AA** as the floor. AAA where feasible.
- **WAI-ARIA 1.2** for semantic structure.
- **Section 508** (US federal) — implicit via WCAG.
- **EN 301 549** (EU) — implicit via WCAG.
- **VPAT 2.4** — generated for the demo.

## Screenreader support

### Tested screenreaders

| Screenreader | OS | Browser | Status |
|---|---|---|---|
| NVDA 2024.x | Windows | Firefox + Chrome | Primary test target |
| VoiceOver | macOS | Safari | Primary test target |
| JAWS 2024 | Windows | Chrome | Stretch target |
| TalkBack | Android | Chrome | Post-hackathon |
| VoiceOver | iOS | Safari | Post-hackathon |

### Test cadence

- **Before each commit to `main`** that touches the UI: axe-core in CI blocks on AA violations
- **Once per day during the hackathon**: manual NVDA run-through of the full flow
- **Before demo**: NVDA + VoiceOver run-through, both screenshare-able

## Keyboard navigation

Every interactive element is reachable via Tab. Focus order matches visual order. Focus is always visible (high-contrast outline).

```css
:focus-visible {
  outline: 3px solid var(--focus-color, #FFD700);
  outline-offset: 2px;
}
```

Skip links for repeated UI:

```html
<a href="#main-content" class="skip-link">Skip to main content</a>
<a href="#pattern-grid" class="skip-link">Skip to pattern grid</a>
<a href="#controls" class="skip-link">Skip to controls</a>
```

### Roving tabindex for the visual grid

The grid is a 2D structure. Arrow keys navigate within it; Tab enters/exits.

```typescript
function onGridKeydown(e: KeyboardEvent, row: number, col: number) {
  switch (e.key) {
    case "ArrowRight": moveFocus(row, col + 1); break;
    case "ArrowLeft":  moveFocus(row, col - 1); break;
    case "ArrowDown":  moveFocus(row + 1, col); break;
    case "ArrowUp":    moveFocus(row - 1, col); break;
    case "Home":       moveFocus(row, 0); break;
    case "End":        moveFocus(row, lastCol); break;
    case "Enter":      announceCurrentCell(); break;
  }
}
```

## Voice interaction as accessibility

### How voice maps to screenreaders

When PatternTalk speaks via `SpeechSynthesis`:

- **No screenreader active:** audio plays through speakers, user hears it
- **NVDA active:** NVDA mutes the speech synthesis output and reads the same text via its own voice, using the live region's text content
- **VoiceOver active:** same behavior as NVDA

This is the magic: a single voice output layer works for everyone.

### How STT maps to screenreaders

Screenreaders don't expose their STT input to web pages. So:

- **Sighted users without screenreader:** use Web Speech API STT
- **Screenreader users:** type into a regular text input, or use their screenreader's voice control (e.g., Dragon, Voice Access on Android, Voice Control on macOS)

Both paths converge on the same prompt parser. The UI offers both visibly:

```
[🎤 Hold Space to talk]  or  [Type a prompt: ____________]
```

### ARIA live regions

When PatternTalk wants to announce something (a new pattern generated, an error, a status change), it uses ARIA live regions:

```html
<div aria-live="polite" aria-atomic="true" id="status">
  <!-- PatternTalk writes here when state changes -->
  Skank beat, 4 bars at 174 BPM. MIDI ready.
</div>

<div aria-live="assertive" role="alert" id="errors">
  <!-- Errors go here, interrupt speechreader -->
</div>
```

**Polite** for routine status (don't interrupt). **Assertive** for errors (interrupt).

## Pattern description format

Every pattern has a screenreader-friendly text description. The format:

```
{Pattern name}. {Genre} at {tempo} BPM.
{Limb-by-limb description}.
{Notable characteristics}.
{Tags/context}.
```

Examples:

**D-Beat:**
```
D-Beat. Metal at 180 BPM. Kick plays on every beat with
8th-note doubles. Snare hits on 2 and 4. Ride bell plays
steady 8th notes throughout. Common in Discharge, Entombed,
and Scandinavian crust punk.
```

**Skank Beat:**
```
Skank Beat. Ska at 120 BPM. Kick on 1 and 3. Snare on
2 and 4. Hi-hat plays on every upbeat — the "and" of each
beat. Ska upstroke feel.
```

**Blast Traditional:**
```
Traditional Blast Beat. Metal at 200 BPM. Kick and snare
alternate in 8th notes throughout. Hi-hat plays continuous
8th notes. High intensity.
```

**Djent Polyrhythm:**
```
Djent Polyrhythm. Metal at 140 BPM. Kick plays a 4-over-3
polyrhythm against the 4/4 pulse. Snare on 2 and 4.
Ride cymbal plays 8th notes. Polyphonic, Meshuggah-style.
```

The description is generated from the template at runtime. Sighted users see it in a panel; screenreaders read it on demand.

## High contrast and theming

```css
:root {
  --bg: #ffffff;
  --fg: #1a1a1a;
  --accent: #0066cc;
  --focus: #ffd700;
  --limb-kick: #d62828;
  --limb-snare: #1d3557;
  --limb-hihat: #f4a261;
  --limb-ride: #2a9d8f;
  --limb-crash: #e76f51;
  --limb-china: #8338ec;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1a1a;
    --fg: #f0f0f0;
    --accent: #66b2ff;
  }
}

@media (prefers-contrast: more) {
  :root {
    --fg: #000000;
    --bg: #ffffff;
    --accent: #0000ee;
    --focus: #ff00ff;
  }
}
```

## Reduced motion

Some users get sick from animation. Respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

The visual grid has subtle "pulse" animations when patterns play back. With reduced motion, those are disabled — only color changes indicate playback position.

## Captions and transcripts

Every audio sample generated by SA3 gets a textual caption (derived from the prompt + pattern context):

```
Sample: brutal china crash, 18-inch, trashy.
Duration: 3.0 seconds. Intensity: brutal-max.
```

Captions are:
- Visible by default in the UI
- Read by screenreaders when focus moves to the sample player
- Exportable as a sidecar text file with the .wav download

## CI accessibility checks

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - run: npm run test:a11y   # axe-core via @axe-core/playwright
```

`npm run test:a11y` runs Playwright with axe-core against every page. Fails on any WCAG AA violation.

## Manual screenreader test protocol

Before each demo:

1. **Cold start:** Close browser, open PatternTalk, immediately start NVDA
2. **Full flow via keyboard only:** Generate a pattern, audition it, download MIDI, generate variations, pick one, start over
3. **Verify announcements:** Every state change should be announced within 1 second
4. **Verify focus:** Focus should never get stuck or disappear
5. **Verify grid:** Tab to grid, arrow-navigate, every cell announces its limb and velocity
6. **Verify download:** Download MIDI and sample, verify file names announced
7. **Verify errors:** Trigger an error path (e.g., Reaper not running), verify error is announced politely
8. **VoiceOver pass:** Repeat steps 1–7 with VoiceOver on macOS

A short screen recording of this is part of the demo deliverables.

## Reduced-physical-load mode (stretch)

For drummers with RSI, chronic pain, or temporary injury. The plugin generates the physically demanding parts (blast beats, double bass) and the drummer plays the parts they can play.

Implementation: split each pattern into "AI plays" vs "you play" subsets. Export two MIDI tracks. Drummer mutes the AI track they want to play themselves.

Not in scope for the 2-day hackathon, but the data model supports it (each `Hit` has a `playableBy: "ai" | "human"` flag).

## Haptic metronome (stretch)

A paired PWA on the drummer's phone vibrates on the beat. Different vibration patterns for downbeat, backbeat, fills.

Out of scope for the 2-day hackathon. Post-hackathon product.

## Real-time audio captioning (stretch)

Capture audio from the interface, run lightweight audio classification, output live captions: "kick, snare, kick-snare fill, china crash."

Out of scope for the 2-day hackathon. This is what would make the tool usable for deaf producers collaborating with hearing producers.

## Why this matters for the hackathon

Jury includes Andrew Huang, who has explicitly designed for accessibility in past work. Zack Zukowski (Stability AI) is known for caring about inclusive design. The "Accessibility & Inclusion" theme is a first-class track. The MUTEK Festival, where winners present, has an audience that includes accessibility advocates.

A demo that opens with "let me show you the screenreader view" is memorable. A demo that says "and we tested this with NVDA daily" is credible.

## Narwall integration (post-hackathon)

Long-term, PatternTalk could be tested *by* Narwall as part of its workflow — using Narwall's real-screenreader-based testing to continuously verify that no UI regression breaks the screenreader experience. That's a natural fit for the founder's other product and would make PatternTalk the only music tool with continuous accessibility testing baked in.

For the hackathon: mention this as the long-term plan in the demo, don't build the integration.
