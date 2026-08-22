# 02 — Architecture

## System overview

PatternTalk is two services plus a shared data layer.

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Next.js Web App (TypeScript)                        │   │
│  │  ├─ Voice UI (Web Speech API: STT + TTS)            │   │
│  │  ├─ Prompt parser                                   │   │
│  │  ├─ Pattern engine (loads templates)                │   │
│  │  ├─ MIDI generator (@tonejs/midi)                   │   │
│  │  ├─ Audio context analyzer (Meyda/Essentia.js)      │   │
│  │  ├─ Reaper Web Control client                       │   │
│  │  └─ Visual grid (optional, layered on top)          │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────┬──────────────────────────────────┬───────────────┘
           │ HTTP                              │ WebSocket
           ▼                                  ▼
┌──────────────────────┐          ┌────────────────────────────┐
│  Audio Service       │          │  Reaper (user's machine)   │
│  (Python, FastAPI)   │          │  Web Control surface       │
│  ├─ SA3 inference    │          │  + ReaScript bridge        │
│  ├─ LoRA loader      │          └────────────────────────────┘
│  └─ Sample generator │
└──────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  Stable Audio 3 weights (local FS)   │
│  + Brutal-drum LoRA adapter          │
└──────────────────────────────────────┘
```

## Services

### 1. Web app (`apps/web`)

**Stack:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, Radix UI primitives, @tonejs/midi, Meyda.

**Responsibilities:**
- Render the voice-first UI
- Capture microphone input → text via Web Speech API (`SpeechRecognition`)
- Speak responses via `SpeechSynthesis`
- Parse prompts → structured requests (see [`docs/03-data-model.md`](03-data-model.md))
- Load pattern templates, generate MIDI in-browser
- Optional: analyze uploaded audio for BPM (Meyda/Essentia.js)
- Talk to Reaper via Web Control (when available)
- Talk to audio service for sample generation

**State management:** Zustand or React state. Avoid Redux. State is small.

**Why Next.js:**
- Server components let us split render work from interactive shell
- Easy deploy to Vercel
- TS support is first-class
- Accessibility ecosystem (react-aria, Radix) is mature

### 2. Audio service (`services/audio`)

**Stack:** Python 3.10+, FastAPI, PyTorch 2.x, diffusers/transformers for SA3.

**Responsibilities:**
- Load Stable Audio 3 weights (base model)
- Load LoRA adapter (brutal-drums)
- Run inference on prompts → audio buffers
- Stream or return audio as WAV
- Cache generated samples (LRU + disk-backed)

**Why separate service:**
- Python ML ecosystem is non-negotiable for SA3
- Decoupling lets us run on different machines (Vega for dev, cloud GPU for demo)
- Browser can't run SA3 inference efficiently
- Service can be scaled or replaced without touching the web app

### 3. Reaper integration (in user's DAW)

**Stack:** Reaper Web Control surface (built-in HTTP server) + optional ReaScript.

**Responsibilities:**
- Expose project tempo (BPM), time signature, play state
- Accept MIDI files dropped onto tracks

**Why this is not a "service":**
- Reaper runs on the user's machine
- PatternTalk is a client to its Web Control API
- No persistent server-side integration needed

## Data flow

### Happy path: voice prompt → MIDI + sample

```
User voice: "tupatupatupa on the hihat, 4 bars"
    │
    ▼
[Web Speech API] ──text──▶ "tupatupatupa on the hihat, 4 bars"
    │
    ▼
[Onomatopoeia matcher] ──▶ { onomatopoeia: "tupatupatupa", mappedTo: "skank-beat" }
    │
    ▼
[Prompt parser] ──▶ {
    │                   pattern: "skank-beat",
    │                   bars: 4,
    │                   tempo: null,           // not specified
    │                   timeSignature: "4/4",  // default
    │                   cymbalHint: "hi-hat upstrokes"
    │                 }
    ▼
[Tempo resolver] ──▶ tempo: 174
    │  (priority: explicit in prompt > Reaper project BPM > uploaded audio BPM > 120 default)
    ▼
[Pattern engine] ──▶ MIDI events[]   (loaded from skank-beat template, expanded to 4 bars at 174 BPM)
    │
    ▼
[MIDI generator] ──▶ .mid file (Blob in browser)
    │
    ├─▶ [Download to user]
    │
    └─▶ [Audio service request]
        POST /generate-sample
        { prompt: "skank beat, hi-hat upstrokes, brutal drums", duration: 8 }
        │
        ▼
        [SA3 + LoRA inference] ──▶ audio buffer
        │
        ▼
        [Response] ──▶ .wav file (Blob in browser)
        │
        └─▶ [Download to user]
```

### Voice response flow

After generation, PatternTalk speaks back:

```
"Skank beat, hi-hat upstrokes on the upbeats, 4 bars at 174 BPM.
 MIDI ready. Sample ready. Say 'play' to preview, 'regenerate' to try again,
 or 'download' to save the MIDI."
```

### Reaper sync flow

```
Web app mounts → checks for Reaper Web Control at localhost:8080
    │
    ├─ present → fetch /_/project/tempo → use as tempo default
    │
    └─ absent → use uploaded audio BPM or 120 default
```

## Folder structure

```
patterntalk/
├── apps/
│   └── web/                       # Next.js app
│       ├── app/                   # App Router pages
│       │   ├── page.tsx           # Main voice UI
│       │   ├── library/           # Pattern library
│       │   └── layout.tsx
│       ├── components/
│       │   ├── voice/             # Voice UI primitives
│       │   ├── grid/              # Visual grid (optional)
│       │   └── ui/                # Radix wrappers
│       ├── lib/
│       │   ├── parser/            # Prompt + onomatopoeia parser
│       │   ├── patterns/          # Pattern engine + template loader
│       │   ├── midi/              # MIDI generation (@tonejs/midi)
│       │   ├── audio/             # Web Audio, Meyda analyzer
│       │   └── reaper/            # Reaper Web Control client
│       ├── data/
│       │   ├── patterns/          # JSON pattern templates
│       │   └── onomatopoeia.json  # Onomatopoeia mapping table
│       ├── public/
│       └── package.json
├── services/
│   └── audio/                     # FastAPI service
│       ├── sa3/                   # SA3 wrapper
│       │   ├── inference.py
│       │   ├── lora.py
│       │   └── server.py
│       ├── training/              # LoRA fine-tuning scripts
│       │   └── train_lora.py
│       ├── models/                # SA3 base weights (gitignored)
│       ├── loras/                 # Trained LoRA adapters
│       ├── cache/                 # Generated sample cache
│       └── requirements.txt
├── data/
│   └── training/                  # Brutal drum samples for LoRA
│       ├── oneshots/              # Kick, snare, china, etc.
│       ├── loops/                 # Short brutal loops
│       └── manifest.yaml          # Training data manifest
├── docs/                          # This directory
├── scripts/
│   ├── reaper/                    # ReaScript helpers
│   └── verify/                    # Accessibility + smoke tests
├── .github/
│   └── workflows/                 # CI (axe-core, lint, build)
├── package.json                   # Workspace root
└── README.md
```

## Why monorepo

- Single repo for web + audio service + training data
- Shared types between TS and Python (via JSON Schema + codegen, or just hand-written TS interfaces mirrored in Pydantic)
- Single CI pipeline
- Easier to ship as one artifact at the demo

**Tooling:** pnpm workspaces + a simple Python venv per service. Avoid Turborepo/Nx overhead for a 2-day project.

## Deployment

| Component | Target |
|---|---|
| Web app | Vercel (free tier) |
| Audio service | RunPod / Vast.ai during hackathon, optional Fly.io / Modal for inference |
| Models + LoRA weights | HuggingFace Hub (public, for the LoRA at least) |
| Training data | Small dataset, commit directly to repo or HuggingFace dataset |

## Key technical decisions

### Decision 1: Voice-first, not visual-first

The voice UI is the primary surface. The visual grid is optional and layered.

**Rationale:** Differentiates from every other drum plugin, hits the accessibility theme head-on, and matches how drummers actually think.

### Decision 2: Pattern engine decoupled from audio engine

The pattern (MIDI events) is hand-coded from templates. The audio (samples) is generated by SA3.

**Rationale:** Your domain expertise lives in the patterns. SA3's strength is sample quality. Don't conflate them. Each can be evaluated independently.

### Decision 3: Cloud GPU for inference during demo

Vega 56 can run SA3 small but slowly. Use cloud for demo-day inference to guarantee snappy response.

**Rationale:** Live inference during a 3-minute demo is high-risk if hardware is slow. A $20 cloud spend buys reliability.

### Decision 4: Open weights and open code

MIT code, public LoRA weights, public training manifest.

**Rationale:** Stability challenge explicitly rewards "open development." Showing the weights and training data is itself part of the demo.

### Decision 5: Reaper-first DAW integration

Web Control surface + MIDI export, not a full VST/CLAP.

**Rationale:** Web Control + drag-MIDI is 80% of the value at 20% of the work. CLAP wrap is stretch.

## What this architecture doesn't do

- No multi-user real-time collaboration (out of scope for 2 days)
- No pattern saving to cloud accounts (localStorage only for now)
- No mobile-first UI (desktop browser is the target)
- No offline mode (Vega inference can run offline, but the demo assumes network for cloud inference)
- No AU plugin format (Mac pain, not worth it for the demo)

## Open architectural questions

1. **Where does the pattern library live?** Browser-only (static JSON) vs. served from the audio service? *Lean: browser-only, simpler.*
2. **Should variations be pre-generated or on-demand?** Pre-generated is faster demo, on-demand is more impressive. *Lean: pre-generate for safety, on-demand as a "show your work" feature.*
3. **Real-time WebSocket for inference progress, or just polling?** WebSocket is nicer UX, polling is simpler. *Lean: WebSocket if time, polling if not.*
