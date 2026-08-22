# 08 — Build Plan

## Timeline overview

```
NOW (3 weeks before)        Pre-hack prep
HACK DAY 1 (Sat Aug 22)     Build core features
HACK DAY 2 (Sun Aug 23)     Polish, integrate, demo
POST-HACK                   Publish, ship, follow up
```

## Pre-hackathon (you have ~3 weeks)

Goal: arrive at the event with a working skeleton, training data ready, and most patterns written. This compresses day 1 to "polish core, add stretch features" instead of "build from zero."

### Week 1: foundations

**By end of week 1:**

- [ ] Get Stable Audio 3 API access / model weights downloaded
  - [ ] HuggingFace account created
  - [ ] Request gated access to `stabilityai/stable-audio-3-small`
  - [ ] Get inference running locally on Vega (or document why cloud-only)
  - [ ] Time a generation, establish baseline performance
- [ ] Set up RunPod account (or chosen cloud GPU provider)
  - [ ] Test deploying a simple inference container
  - [ ] Verify you can ssh/exec into it
- [ ] Stand up the repo
  - [ ] Next.js + TypeScript + Tailwind initialized
  - [ ] Folder structure per [`02-architecture.md`](02-architecture.md#folder-structure)
  - [ ] CI with axe-core for accessibility (even on empty pages, it's a foundation)
  - [ ] Deploy "coming soon" placeholder to Vercel
- [ ] Set up audio service skeleton
  - [ ] FastAPI + SA3 inference wrapper
  - [ ] Single `/generate` endpoint, no LoRA yet
- [ ] Install NVDA on Windows, run through Reaper once to baseline familiarity
- [ ] Set up Reaper with a drum sampler VST for testing MIDI export

### Week 2: data and templates

**By end of week 2:**

- [ ] Curate training data for brutal-drum LoRA
  - [ ] 20–40 one-shots (recordings or sourced, all licensed)
  - [ ] 10–20 short loops
  - [ ] Manifest in `data/training/manifest.yaml`
  - [ ] All preprocessed to 44100 Hz mono
- [ ] Write the 6 demo-critical pattern templates
  - [ ] `d-beat.json`
  - [ ] `blast-traditional.json`
  - [ ] `skank.json`
  - [ ] `half-time-metal.json`
  - [ ] `djent-polyrhythm.json`
  - [ ] `punk-rock.json`
- [ ] Write the onomatopoeia mapping table with at least 10 entries
- [ ] Implement prompt parser MVP (handles the 6 patterns + 10 onomatopoeias)
- [ ] Implement pattern engine MVP (loads templates, expands to bars, applies tempo)
- [ ] Implement MIDI generation (downloads work, drags into Reaper)

### Week 3: integration and rehearsal

**By end of week 3:**

- [ ] Train brutal-drum LoRA on cloud GPU
  - [ ] First attempt: 500 steps, see how it shapes up
  - [ ] Iterate: adjust learning rate, dataset, prompt format
  - [ ] Final: ship-ready LoRA + publish to HuggingFace (draft, don't publish yet)
- [ ] Implement Reaper Web Control client
  - [ ] Connect, parse state, extract tempo
  - [ ] Tempo resolution priority implemented
- [ ] Implement Web Speech API integration
  - [ ] STT works in Chrome
  - [ ] TTS works
  - [ ] Voice state machine (idle → listening → parsing → generating → ready)
- [ ] Build basic UI shell
  - [ ] Voice button, transcript display, status panel
  - [ ] Action buttons (play, download, regenerate)
  - [ ] Visual grid component (basic version)
- [ ] Accessibility pass 1
  - [ ] Tab through every element
  - [ ] NVDA run-through of the voice flow
  - [ ] ARIA labels on every interactive element
  - [ ] Skip links
  - [ ] High contrast check
- [ ] End-to-end rehearsal
  - [ ] Generate a pattern in PatternTalk
  - [ ] Drag MIDI into Reaper
  - [ ] Play it
  - [ ] Generate sample
  - [ ] Play sample
  - [ ] Switch on NVDA, redo the flow
- [ ] Write the team-pitch and post to Music Hackspace Discord

## Hackathon Day 1 (Saturday Aug 22)

### Morning (9:00 AM – 12:30 PM): setup + team formation

- [ ] Arrive at PHI Centre, get settled
- [ ] Finalize team composition (if recruiting on-site)
- [ ] Confirm Reaper + PatternTalk working environment
- [ ] Connect to venue WiFi, verify cloud GPU access

### Early afternoon (12:30 PM – 3:00 PM): core demo path

**Goal:** End-to-end voice → pattern → MIDI → Reaper working.

- [ ] Finalize pattern engine: tempo, bars, time signature, cymbal overrides
- [ ] Finalize MIDI export, verify it sounds right in Reaper
- [ ] Wire up Web Speech API end-to-end
- [ ] Wire up sample generation from cloud GPU
- [ ] First smoke test: voice prompt → MIDI + sample → download → Reaper

### Late afternoon (3:00 PM – 6:00 PM): variations and audio context

- [ ] Implement 4-variation engine (humanize velocities, micro-timing, fill variants)
- [ ] Implement uploaded audio BPM detection (Meyda)
- [ ] Wire up Reaper tempo sync (Web Control client)
- [ ] Pre-generate demo variations for the showcase patterns

### Evening (6:00 PM – 9:00 PM): polish + accessibility

- [ ] Visual grid component (sighted users)
- [ ] Pattern library page (skeleton)
- [ ] Accessibility pass with NVDA
  - [ ] Tab through everything
  - [ ] Voice announcements work
  - [ ] Error states announced
- [ ] Demo rehearsal (round 1)
- [ ] Evening check-in / informal demos at the venue

**Day 1 deliverable:** A working PatternTalk that takes voice prompts, generates MIDI, downloads it, and plays in Reaper. Plus 4-variation picker. Plus screenreader-tested.

## Hackathon Day 2 (Sunday Aug 23)

### Morning (9:00 AM – 12:00 PM): stretch features

Priority order (cut from the bottom if time runs short):

1. [ ] **Sample preview player** with progress indicator
2. [ ] **Pattern library** with search/filter and shareable URLs
3. [ ] **User-defined onomatopoeias** (localStorage)
4. [ ] **CLAP plugin wrap** of the web UI (if a teammate can take it)
5. [ ] **Real-time audio captioning** (stretch, probably cut)

### Midday (12:00 PM – 2:00 PM): polish

- [ ] Final visual grid polish (animations, color tuning)
- [ ] Voice response tuning (speak rate, prompts)
- [ ] Pre-generate all demo cache samples
- [ ] Pre-stage the LoRA weights download for live demo
- [ ] Test with cloud GPU off (Vega-only path) as fallback

### Afternoon (2:00 PM – 4:00 PM): demo rehearsal

- [ ] Full demo run-through, timed (target: 3–4 minutes)
- [ ] NVDA demo run-through, timed
- [ ] VoiceOver demo run-through, timed
- [ ] Rehearse the pitch (3 sentences max)
- [ ] Backup plan: video recording of working demo, in case of network issues

### Late afternoon (4:00 PM – 6:00 PM): present

- [ ] Public demos
- [ ] Jury presentation
- [ ] Feedback session

### Evening (6:00 PM onwards): wind down

- [ ] Final cleanup
- [ ] Publish LoRA to HuggingFace (if not already)
- [ ] Push code to GitHub, write a proper README
- [ ] Write blog post / social announcement

## Checkpoints

Use these to catch problems early. If a checkpoint fails, stop and address it before moving on.

| Checkpoint | When | What "passing" means |
|---|---|---|
| **C1: Inference works** | Pre-hack week 1 | SA3 small generates a sample on Vega in < 10 min OR cloud GPU works |
| **C2: Training data ready** | Pre-hack week 2 | 30+ samples in `data/training/` with manifest, all licensed |
| **C3: 6 patterns authored** | Pre-hack week 2 | All 6 demo patterns load, expand, generate MIDI |
| **C4: End-to-end MIDI** | Pre-hack week 3 | Voice prompt → MIDI → Reaper plays correctly |
| **C5: NVDA reads the UI** | Pre-hack week 3 | Screenreader announces every state change |
| **C6: Demo path works** | Hack day 1 | Full voice → MIDI → sample → Reaper in < 60 seconds |
| **C7: LoRA published** | Hack day 1 evening | Weights on HuggingFace with model card |
| **C8: Variations work** | Hack day 2 morning | 4 variations show in UI, picker works |
| **C9: Demo polished** | Hack day 2 afternoon | Rehearsal runs in 3–4 minutes without mistakes |

## What to cut if time runs out

In priority order (drop from the bottom):

1. ❌ Real-time audio captioning
2. ❌ Haptic metronome PWA
3. ❌ Reduced-physical-load mode
4. ❌ CLAP plugin wrap
5. ❌ User-defined onomatopoeias
6. ❌ Pattern library page (if a minimal in-app picker works)
7. ❌ Audio context BPM detection (fall back to prompt/Reaper-only)
8. ❌ Visual grid polish (fall back to functional ugly grid)
9. ❌ Dark mode (fall back to light only)

The must-haves are: voice prompt, pattern generation, MIDI export, sample generation, Reaper tempo sync. If we have those five, we have a demo that lands.

## What to add if time is plentiful

In priority order:

1. ✅ CLAP plugin wrap
2. ✅ Audio context BPM detection
3. ✅ Pattern library page with shareable URLs
4. ✅ User-defined onomatopoeias
5. ✅ Visual grid polish with animations
6. ✅ Dark mode + theme support
7. ✅ Multiple LoRA adapters (one per genre: rock, jazz, funk)
8. ✅ Real-time audio captioning

## Communication cadence

- **Standup** (15 min) at start of each day
- **Mid-day check-in** (5 min, async) — what's blocked, what's next
- **End-of-day retro** (15 min) — what shipped, what's deferred
- **Demo** (3–4 min) at end of each day for informal feedback

## Post-hackathon

**Within 1 week:**
- [ ] Publish LoRA weights to HuggingFace
- [ ] Publish repo on GitHub with full README
- [ ] Blog post / dev.to article about the project
- [ ] Submit to Music Hackspace showcase if invited

**Within 1 month:**
- [ ] Add more pattern templates (target: 30+)
- [ ] Train LoRAs for additional genres
- [ ] Add CLAP plugin wrap (if not done at hackathon)
- [ ] Integrate with Narwall for continuous accessibility testing

**Within 3 months:**
- [ ] Public launch of the web app
- [ ] Community pattern library with moderation
- [ ] "Train your own LoRA" UI
- [ ] Mobile companion app for haptic metronome
