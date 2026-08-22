# 10 — Team Pitch & Skills Needed

## The pitch (post this to Discord)

> Hey — I'm building **PatternTalk** for the Stability AI challenge at the Montreal Music Hackathon (Aug 22–23). The pitch: every existing DAW plugin is a black box to blind and visually impaired producers, and AI music tools completely lack genre expertise — try getting Stable Audio 3 to make a brutal china crash or a d-beat loop and you'll see what I mean. So I'm building two things in one product: (1) a voice-first, screenreader-native interface ("tupatupatupa on the hihat, 4 bars") that produces downloadable MIDI, generated samples via Stable Audio 3, and a screenreader-friendly description of what's being played; (2) a brutal-drum LoRA fine-tune of Stable Audio 3 so the model actually understands the genre. The whole thing is screenreader-native because I'm using a real screenreader throughout development — same approach I use at my day job running [Narwall.tech](https://narwall.tech), an accessibility testing tool. Looking for 1–2 teammates to make this a real demo, not a slideshow. DMs open.

## Skills we're looking for

### Priority 1: Frontend engineer (1 person, ideal)

**What they'd own:**
- The voice-first UI (Web Speech API, voice state machine)
- The visual grid component
- Pattern library page
- Accessibility implementation (ARIA, keyboard nav, screenreader testing)
- Deploy to Vercel

**Must-have:**
- Strong React/Next.js + TypeScript
- Comfortable with TailwindCSS or similar
- Cares about accessibility (ideally has shipped accessible UIs)
- Available for the full hackathon weekend (Aug 22–23 in Montreal)

**Nice-to-have:**
- Has used Web Speech API before
- Familiar with @tonejs/midi or Web Audio API
- Has worked with a screenreader (NVDA, VoiceOver, JAWS)
- Drummer or musician (genuine interest in the domain, not required)

**Time commitment:**
- 3 weeks of light prep (a few hours/week to align on architecture)
- Full weekend in Montreal, Aug 22–23

---

### Priority 2: ML / audio engineer (1 person, *this is the harder one to fill*)

**What they'd own:**
- Stable Audio 3 inference server (FastAPI + Python)
- LoRA fine-tuning pipeline
- Cloud GPU orchestration (RunPod / Vast.ai)
- Publishing the LoRA weights to HuggingFace

**Must-have:**
- Comfortable with PyTorch
- Has fine-tuned diffusion models before (audio models a strong plus)
- Can deploy Python services (FastAPI, Docker)
- Available for the full hackathon weekend

**Nice-to-have:**
- Has specifically worked with Stable Audio, AudioLDM, MusicGen, or Riffusion
- Has trained LoRAs before
- Familiar with ROCm or cloud GPU providers
- Has worked with audio data (sample rates, normalization, etc.)

**Time commitment:**
- 3 weeks of prep (more than frontend — needs to establish the SA3 pipeline)
- Full weekend in Montreal, Aug 22–23

---

### Priority 3: Musician / sound designer (optional but valuable)

**What they'd own:**
- Curate the brutal-drum training dataset
- Review generated samples for "does this actually sound brutal"
- Help write pattern templates if you want to delegate some
- Provide creative direction during the demo

**Must-have:**
- Plays drums (or has deep familiarity with drumming)
- Has strong taste in metal/rock/punk
- Available for the full hackathon weekend

**Nice-to-have:**
- Produces records or has production experience
- Has sample library curation experience
- Has experience with AI music tools (knows what works and what doesn't)

**Time commitment:**
- Light prep (curate some samples, share references)
- Full weekend in Montreal, Aug 22–23
- *Could be remote for prep, in-person for the hackathon*

---

### Priority 4: Designer (optional)

**What they'd own:**
- Visual grid polish (animations, color tuning)
- Logo, demo assets, brand if there's time
- Possibly the marketing visuals for the post-hack blog post

**Must-have:**
- Visual design sense, especially for accessibility-conscious design
- Available for at least hackathon day 2

**Nice-to-have:**
- Has designed for music applications before
- Has designed with WCAG AA+ compliance in mind

**Time commitment:**
- Hackathon weekend only is fine
- Lower priority than engineers

---

## What you (the founder) bring

To attract good teammates, you need to offer something back. Here's what you bring:

**Credibility:**
- Active startup ([Narwall.tech](https://narwall.tech)) — this isn't a fantasy project
- Real screenreader testing practice — unique in the music-tech space
- Drummer + producer with metal bands — domain expertise, no faking needed
- Working Stable Audio 3 setup planned (or in progress)

**Preparation:**
- Complete design docs before the event (this directory!)
- Working code skeleton before the event
- Pre-curated training dataset
- Pre-trained LoRA (or first attempt done)

**Project clarity:**
- A real plan with checkpoints (see [`08-build-plan.md`](08-build-plan.md))
- A real architecture (see [`02-architecture.md`](02-architecture.md))
- Honest risk assessment (see [`09-risks.md`](09-risks.md))
- Scope discipline (clear must-haves vs stretch)

**The pitch itself** — voice-first AI drummer for metal that works with a screenreader — is distinctive enough that good engineers will be interested.

---

## Where to find teammates

### Music Hackspace channels (primary)

1. **Music Hackspace Discord** — main hub, post the pitch there
   - Invite link on musichackspace.org
   - Active community of music tech builders
2. **Prep calls** (Wed evenings, July 29 – Aug 19)
   - Show up to all of them
   - Mention you're looking for teammates
   - This is literally what the prep calls are for
3. **Montreal music tech community**
   - If you can attend any in person before the event, do it

### Other channels (secondary)

4. **MUTEK Discord / community** — overlap with hackathon attendees
5. **Reddit:**
   - r/WeAreTheMusicMakers
   - r/musicproduction
   - r/Drumming
   - r/musictech
6. **HuggingFace Discord** — for the ML engineer specifically
7. **Reaper forums** — for Reaper integration expertise
8. **Local university CS / music tech programs** (McGill, Concordia in Montreal)

### What to avoid

- Cold-DM-ing strangers without context
- Promising ownership or revenue (this is a hackathon, set expectations clearly)
- Recruiting people who don't have the full weekend available
- Recruiting people who can't be in Montreal in person (remote-only is hard for a hackathon)

---

## How to evaluate candidates

When someone responds to the pitch, ask:

1. **"Can you be in Montreal August 22–23?"** (eliminates 50% of replies)
2. **"What's the most interesting thing you've built recently?"** (gauge depth)
3. **"Have you worked with screenreaders before?"** (for frontend; "have you fine-tuned audio models?" for ML)
4. **"How do you feel about working from a detailed plan rather than improvising?"** (sets expectations)
5. **"What would you want to own in this project?"** (alignment check)

If they pass those, share the docs (this directory), give them 24 hours to read, then have a 30-minute call to align.

---

## Team formation timeline

| Date | Action |
|---|---|
| Now (3 weeks out) | Post pitch to Discord + Reddit |
| July 29 | Attend prep call #1, mention looking for teammates |
| Aug 1 | Follow up with interested candidates |
| Aug 5 | Attend prep call #2, share progress, recruit more |
| Aug 8 | Finalize team composition |
| Aug 12 | Attend prep call #3 (with team if formed) |
| Aug 19 | Attend prep call #4 (final pre-hack alignment) |
| Aug 22 | Hackathon day 1 |

---

## What if you can't find teammates

Solo is a valid path. The plan is designed to be solo-shippable, with cuts clearly defined.

**If solo:**
- Focus ruthlessly on the must-haves (voice prompt, MIDI export, sample generation, Reaper sync)
- Pre-build as much as possible in the 3 weeks
- Use pre-generated samples and pre-cached variations for the demo
- Be honest with the jury about the scope

**If you find one teammate (frontend):**
- You own audio service + training data + LoRA + Reaper integration
- They own web app + voice UI + visual grid + accessibility
- This is the ideal 2-person team

**If you find two teammates (frontend + ML):**
- You own: prompt parser, pattern engine, training data curation, demo, project lead
- Frontend: web app, voice UI, accessibility
- ML: audio service, LoRA training, cloud GPU
- This is the dream team — you have time for stretch features

**If you find a musician-only team:**
- Less ideal — you'd be doing all the code
- But the musician adds value on the training data curation and the demo

---

## Post-hackathon: what happens to the team?

This is a hackathon, not a startup. After Aug 23, the team disbands by default. If people want to keep building:

- **You** (the founder) own the IP per the hackathon rules
- Contributors retain credit in the README and commit history
- Open-source repo means anyone can fork and continue
- If the project gains traction, consider:
  - Adding collaborators as maintainers
  - Forming a small LLC or collective if commercializing
  - Or just letting it be an open-source project

Set these expectations at the start: "we own what we build, you get credit, and we can decide post-event whether to continue together."

The Music Hackspace IP rules are explicit: *"Your team keeps 100% ownership of what you create during the hackathon."*
