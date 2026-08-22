# 01 — Vision

## The problem

Music generators and practice tools don't act like a bandmate. You sit down,
start playing, and the software asks you to describe what you want in its terms
— or it produces a finished "song" you have no part in. There's no tool that
just **listens to what you're playing and joins in**.

AI music tools compound the problem:
- They generate full mixes at a fixed tempo, not parts that lock to *your* tempo.
- They're visual toy apps or opaque audio generators with no semantic structure,
  so blind and visually impaired producers can't use them at all.

## The product

**Jam Buddy** is a call-and-response practice companion. The interaction is the
product: *you start playing, it joins in at your tempo, in the instrument you
pick.*

1. You load a **MIDI take** (controller) or **audio take** (mic/interface).
2. The buddy detects your tempo (exact from MIDI note times; tempo-range prior
   on audio) and matches its response length to your take.
3. You pick the **instrument** the buddy should play (bass / lead / rhythm /
   synth / drums) plus a genre and mood.
4. SA3 generates the response — `small-music` for melodic parts, `small-sfx`
   for clean isolated drums — at your tempo.
5. **PLAY BOTH** plays your take and the buddy's response together, in tempo.
6. Every response is saved to `generations/` so you can keep and A/B it.

The UI is a hardware-sampler-styled rack, and it's **screenreader-compatible by
design**: labelled range-input knobs, accessible button names, `aria-live`
status. Voice-first *is* accessibility — we build the accessible version first,
not as an afterthought.

## Why this fits the Stability AI challenge

The brief asks for *"a publicly available and accessible tool for music
producers using the power of the Stable Audio 3 models, encouraging open
development and showing the strengths of local open models."*

- **SA3 powers the response** — generated locally from the open `small-music` /
  `small-sfx` weights, no black-box API.
- **Two real input modes**: MIDI (tempo + length lock) and audio
  (audio-to-audio — the buddy genuinely hears and responds to your groove).
- **Accessibility as load-bearing**, not bolted on.
- **Open + local**: the whole pipeline runs on consumer hardware.

## Who this is for

**Primary:**
- Musicians who want a practice partner that locks to *their* tempo.
- Producers exploring complementary parts without leaving their flow.
- Blind / visually impaired producers — the rack is fully keyboard + screenreader
  operable.

**Secondary:**
- Any jam context — one player's take, a generated counterpart in the room.

## What success looks like at the hackathon

**Demo (3–4 minutes):**
1. Elevator pitch: *"a practice partner that hears you start playing and joins
   in at your tempo, in your instrument."*
2. Load a MIDI take from a real controller.
3. Pick an instrument, hit JOIN IN — the buddy responds at your tempo.
4. PLAY BOTH — you + the buddy together, the co-play moment.
5. Toggle the keyboard/screenreader path to show accessibility.
6. Point at the `generations/` files — everything it produced is kept.

**Deliverables:**
- Working web app (`apps/web`) + the `tools/jam_buddy.py` SA3 pipeline.
- Open-source MIT repo.
- Screenreader-tested UI (NVDA + VoiceOver).

**Stretch / not claimed:**
- A LoRA fine-tune for "your style" is a real path (via `underfit` on a GPU)
  but is NOT shipped — we demo the open local model, honestly.

## What we explicitly are not

- Not a DAW. Reaper / the DAW does that.
- Not a full song generator. We produce one complementary part at your tempo.
- Not a VST first. The web rack is the primary surface; plugin wrap is stretch.

## North star

A musician plays a 20-second idea, picks "lead guitar," and within a minute the
buddy has responded with a lead part at the same tempo — and both play together.
That's the co-play moment we're building toward.
