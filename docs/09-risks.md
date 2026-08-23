# 09 — Risks & Mitigations

Risks ranked by impact × likelihood. Each has an owner, a mitigation, and a contingency.

## Risk matrix

| # | Risk | Likelihood | Impact | Severity | Status |
|---|---|---|---|---|---|
| 1 | Cloud GPU unavailable during demo | Low | Critical | **HIGH** | Mitigated |
| 2 | SA3 inference too slow on Vega | High | High | **HIGH** | Mitigated |
| 3 | LoRA training fails / produces bad output | Medium | High | **HIGH** | Mitigated |
| 4 | Voice recognition unreliable in noisy venue | High | Medium | **MEDIUM** | Mitigated |
| 5 | Reaper Web Control API changes / doesn't work | Medium | Medium | **MEDIUM** | Mitigated |
| 6 | Pattern templates too few / too low quality | Medium | Medium | **MEDIUM** | Mitigated |
| 7 | Onomatopoeia parser doesn't understand users | Medium | Low | **MEDIUM** | Mitigated |
| 8 | Screenreader breaks during demo | Low | Medium | **MEDIUM** | Mitigated |
| 9 | Network drops during demo | Medium | High | **MEDIUM** | Mitigated |
| 10 | Solo bottleneck — running out of time | High | High | **HIGH** | Mitigated |
| 11 | Team conflict / teammate leaves | Medium | High | **MEDIUM** | Monitor |
| 12 | Licensing issues with training data | Low | High | **MEDIUM** | Mitigated |
| 13 | Browser doesn't support Web Speech API | Low | High | **MEDIUM** | Mitigated |
| 14 | MIDI export has bugs that only show in Reaper | Medium | Medium | **MEDIUM** | Mitigated |
| 15 | Audio sample quality is generic | Medium | Medium | **MEDIUM** | Mitigated |

---

## High-severity risks

### Risk 1: Cloud GPU unavailable during demo

**Scenario:** RunPod has an outage, you can't reach your instance, the venue WiFi blocks the connection, or your account gets suspended.

**Mitigation:**
- Pre-generate ALL demo samples before the event, store in `cache/` directory
- Have a backup account on a different provider (Vast.ai + RunPod)
- Test cloud GPU connection from the venue WiFi before the demo

**Contingency:**
- Run inference on Vega locally (slow but works)
- Use pre-generated samples only and label them as "preset variations"
- Record a video of the working demo as ultimate fallback

**Owner:** You. **Verified:** Test cloud GPU from venue network on day 1 morning.

---

### Risk 2: SA3 inference too slow on Vega

**Scenario:** A 30-second sample takes 15 minutes on your Vega. The demo times out.

**Mitigation:**
- Establish baseline performance in pre-hack week 1 (see C1 in [`08-build-plan.md`](08-build-plan.md))
- If > 5 min per sample on Vega, commit to cloud-only
- Pre-generate demo samples on cloud GPU
- Cache aggressively (LRU + disk)

**Contingency:**
- Demo with cached samples only, narrate "this was generated earlier by the model"
- Show inference happening live as a "by the way, look, it's running" secondary moment, not the main demo

**Owner:** You. **Verified:** Run `scripts/smoke_test.py` on Vega before the event.

---

### Risk 3: LoRA training fails / produces bad output

**Scenario:** Training crashes, or the resulting LoRA makes samples worse than the base model.

**Mitigation:**
- Run a small training (200 steps) first to verify the pipeline
- Train the real LoRA at least 3 days before the event, so you have time to iterate
- Keep the base model as a fallback (can disable LoRA at inference time)
- Document the training hyperparameters so you can reproduce if needed

**Contingency:**
- Ship with the base SA3 model only, label output "Stable Audio 3, no fine-tuning"
- Do a quick second training attempt during the hackathon if you have cloud GPU time
- Be honest with the jury: "we attempted fine-tuning but the base model worked better for the time we had"

**Owner:** You. **Verified:** Complete first training run before pre-hack week 3.

---

### Risk 10: Solo bottleneck — running out of time

**Scenario:** You try to do everything alone, run out of time, ship a half-finished product.

**Mitigation:**
- Aggressive scope cut (see [`08-build-plan.md`](08-build-plan.md#what-to-cut-if-time-runs-out))
- Pre-build as much as possible in the 3 weeks before
- Define the minimum viable demo path and protect it ruthlessly
- Daily checkpoint reviews to catch overruns early

**Contingency:**
- Ship a narrower demo: voice prompt → MIDI export only, no samples
- Have a video walkthrough of the missing features
- Focus the live demo on the 2–3 things that work perfectly

**Owner:** You. **Verified:** C6 (demo path works) at end of day 1.

---

## Medium-severity risks

### Risk 4: Voice recognition unreliable in noisy venue

**Scenario:** The hackathon venue is loud. Web Speech API gets garbage transcripts. Demo fails.

**Mitigation:**
- Use a headset mic / close-mic'd setup, not the laptop mic
- Test voice recognition in a noisy environment before the event
- Have a fallback path: type the prompt instead of speaking
- Push-to-talk (Spacebar to start/stop) avoids picking up ambient noise

**Contingency:**
- Switch to typed prompts for the demo if voice fails
- Use a quieter corner of the venue for the live demo
- Have a backup video of working voice mode recorded in a quiet space

**Owner:** You. **Verified:** Test voice in actual venue conditions.

---

### Risk 5: Reaper Web Control API changes / doesn't work

**Scenario:** Reaper updates, the WebSocket format changes, your client breaks.

**Mitigation:**
- Test against your installed Reaper version (currently 7.x) before the event
- Hard-pin the WebSocket protocol version in your client
- Have the fallback path: "type the BPM manually"

**Contingency:**
- Demo without Reaper integration, just type the BPM
- Show Reaper integration in a video if live fails

**Owner:** You. **Verified:** Test on your Reaper install before the event.

---

### Risk 6: Pattern templates too few / too low quality

**Scenario:** You write 5 patterns, all of them are slightly wrong. Jury asks for a beat you don't have.

**Mitigation:**
- Aim for 18–20 patterns before hackathon
- Write the 6 demo-critical ones first
- Each pattern tested in Reaper before the event
- Have a "blank bar" fallback that lets the user define their own

**Contingency:**
- Generate variations from existing patterns (different bars, different cymbals, half-time)
- Be honest: "we focused on metal first, here's what we have"

**Owner:** You. **Verified:** C3 (6 patterns authored) at end of week 2.

---

### Risk 7: Onomatopoeia parser doesn't understand users

**Scenario:** User says "tupatupatupa" but the parser doesn't recognize it. Falls back to genre vocabulary, picks the wrong pattern.

**Mitigation:**
- Curate the onomatopoeia table with multiple variants per pattern
- Phonetic matching with Levenshtein distance
- Confidence threshold (0.7) below which the parser asks for confirmation
- "I heard X, did you mean Y?" response

**Contingency:**
- The user can always type the pattern name explicitly
- "Try one of these patterns: [list]" response

**Owner:** You. **Verified:** Test the top 20 onomatopoeia phrases manually.

---

### Risk 8: Screenreader breaks during demo

**Scenario:** NVDA crashes, VoiceOver doesn't pick up the UI, the screenreader demo fails.

**Mitigation:**
- Test NVDA + Chrome on the demo machine before the event
- Have a backup screenreader (VoiceOver on Mac, JAWS if you have access)
- Record the screenreader demo as a backup video
- Rehearse the keyboard navigation by feel, not by sight

**Contingency:**
- Show the recorded video of the working screenreader demo
- Skip the live screenreader demo, focus on the voice mode
- Describe the accessibility features narratively

**Owner:** You. **Verified:** Test on the demo machine, not your dev machine.

---

### Risk 9: Network drops during demo

**Scenario:** Venue WiFi dies, you can't reach the cloud GPU for inference.

**Mitigation:**
- Pre-generate all demo samples, store locally
- Run a local copy of the audio service on the demo machine as backup
- Have a mobile hotspot as tertiary fallback

**Contingency:**
- Demo with cached samples only
- Acknowledge the network issue honestly if it comes up

**Owner:** You. **Verified:** Confirm cloud GPU + local backup both reachable from venue.

---

### Risk 11: Team conflict / teammate leaves

**Scenario:** A teammate you recruited flakes, or there's conflict about direction.

**Mitigation:**
- Have all critical code paths owned by you as backup
- Set clear expectations early (what's the demo, what's the deadline)
- Communicate scope cuts in real time

**Contingency:**
- Cut features the flaky teammate was working on
- Lean on the must-haves list

**Owner:** You. **Status:** Monitor.

---

### Risk 12: Licensing issues with training data

**Scenario:** A sample you used is actually copyrighted, you get called out, model card needs to be pulled.

**Mitigation:**
- Every sample has a documented source and license in the manifest
- Prefer CC0 / CC-BY / original recordings
- For Freesound samples, filter to CC0 or CC-BY only, document the user
- For your own recordings, document date and context

**Contingency:**
- If a license is questioned, replace that sample and retrain (time permitting)
- Be transparent in the model card about licensing discipline

**Owner:** You. **Verified:** Manifest reviewed before publishing.

---

### Risk 13: Browser doesn't support Web Speech API

**Scenario:** Demo machine has Firefox, Web Speech API doesn't work.

**Mitigation:**
- Test on the demo browser before the event
- Chrome is the assumption — install it on the demo machine

**Contingency:**
- Switch to typed prompts only
- Use a different laptop with Chrome

**Owner:** You. **Verified:** Test on demo browser.

---

### Risk 14: MIDI export has bugs that only show in Reaper

**Scenario:** MIDI plays wrong in Reaper, or doesn't import at all.

**Mitigation:**
- Test every pattern in Reaper before the event
- Use a known-good GM drum map
- Set tempo in the MIDI file header to match project tempo
- Test on the actual Reaper version you'll use at the event

**Contingency:**
- Fix the bug live (if quick)
- Show the MIDI in a different DAW if Reaper is broken
- Generate a Reaper project file (.rpp) that includes the MIDI in a known-good arrangement

**Owner:** You. **Verified:** Full end-to-end test in Reaper.

---

### Risk 15: Audio sample quality is generic

**Scenario:** Even with the LoRA, the samples sound like generic AI drums, not brutal.

**Mitigation:**
- Iterate on the training dataset (more samples, better curation)
- Iterate on prompt engineering (try different intensity descriptors)
- Generate multiple variations and pick the best

**Contingency:**
- Show the variations, frame as "exploring the space"
- Be honest: "SA3 with our LoRA is good but not perfect yet — here's what it produces"

**Owner:** You. **Verified:** Listen to samples before the event.

---

## Risk ownership summary

| Owner | Risks |
|---|---|
| You (all) | All risks by default |
| Future teammate (frontend) | R10 (solo bottleneck) — if recruited |
| Future teammate (ML) | R3 (LoRA), R2 (Vega speed) — if recruited |

## What we're explicitly NOT risking

- Building features that won't be demoed
- Custom DAW plugins (too risky for the timeframe)
- Mobile apps
- Cloud accounts / user authentication
- Anything that requires a third-party API key beyond SA3

---

## Current Jam Buddy bugs & findings (verified against Stability API docs)

> These are open/confirmed items tracked for the current work. Docs consulted:
> `platform.stability.ai/docs/api-reference` → `post /v2beta/audio/stable-audio/audio-to-audio`.

### 1. SA3 `strength` (noise/denoising) is NOT being sent — open bug (high priority)

The SA3 **audio-to-audio** request schema exposes a `strength` parameter (a.k.a.
*denoising*): **0 = output identical to input, 1 = as if no input was given.**
We do **not** send it, so it defaults to **1** = full diffusion. This explains:
- "generations render nothing new" (input take fully morphed / barely anchors output)
- "output contains more than one instrument" (the take's instrument doesn't anchor,
  model freely adds others)

Stability's guidance for audio-to-audio is `strength` ≈ **0.5–0.8** (diffuse the
take but keep it as the anchor). This is the pending **"Noise knob"** task —
wire `strength` into `tools/jam_buddy_api.py` and expose it in the UI. **UNSENT today.**

### 2. The audio API has NO `negative_prompt` — confirmed
SA3 audio-to-audio only accepts: `prompt`, `audio`, `model`, `duration`, `seed`,
`steps`, `cfg_scale`, `output_format`, `strength`. There is **no `negative_prompt`**.
(Negative prompts exist on Stable *Image*, not Stable Audio.) So we **cannot** steer
away from extra instruments via a negative prompt — the positive prompt + `cfg_scale`
+ `strength` are the only levers. The local CPU fallback (`small-music`) DOES accept
a negative prompt.

### 3. Demo examples can't be played — RESOLVED
The clickable demo chips (Gradio-style) load MIDI as a take, but preview playback
doesn't work — the MIDI examples need to render to audio to actually be audible
as a "playable example." Consider pre-rendering the demo MIDIs to audio (or
ensuring the Web-MIDI synth preview actually plays).

**Resolved:** demos now load their pre-rendered MP3 as an audio take (with the
BPM knob pinned to the source MIDI's tempo), and playback is a play/stop toggle
on the waveform. Single-select + instant highlight/knob update.

### 4. Stale `.next` cache corrupts the dev server (recurring) — OPEN
`next dev`'s incremental cache corrupts after heavy edits. Symptoms: API routes
500 (`MODULE_NOT_FOUND` in `webpack-runtime.js`) OR the page renders blank
(every `/_next/static/chunk` 404s while `GET /` still returns 200). Often a
leftover process squats on port 3000. Fix today: kill the port-3000 PID
(`netstat -ano | grep :3000`, `taskkill /F /PID`), `rm -rf apps/web/.next`,
restart `pnpm dev`, verify chunks load (not just `GET /`). **Address later** —
candidate: a `dev:clean` npm script that clears `.next` before starting, or a
more robust dev workflow.



