/**
 * @patterntalk/shared-types
 *
 * Domain types shared across web app, audio service, and pattern engine.
 * These mirror the Pydantic models in services/audio/ (hand-maintained
 * during the hackathon — codegen via JSON Schema is post-hackathon).
 *
 * Source of truth: docs/03-data-model.md
 */

// =============================================================================
// LIMB
// =============================================================================

/**
 * Drum limb / instrument. Maps to General MIDI drum map keys in
 * apps/web/lib/midi/generator.ts (see limbToGeneralMidi there).
 *
 * Order matters for keyboard navigation in the visual grid — keep stable.
 */
export type Limb =
  | "kick"
  | "snare"
  | "cross-stick"
  | "hihat"
  | "hihat-open"
  | "ride"
  | "ride-bell"
  | "crash"
  | "china"
  | "splash"
  | "tom-1"
  | "tom-2"
  | "tom-3";

export const LIMBS: readonly Limb[] = [
  "kick",
  "snare",
  "cross-stick",
  "hihat",
  "hihat-open",
  "ride",
  "ride-bell",
  "crash",
  "china",
  "splash",
  "tom-1",
  "tom-2",
  "tom-3",
] as const;

/**
 * General MIDI drum map. Source of truth for MIDI byte assignment.
 * Verified against the GM1 spec (kick=36, snare=38, etc.).
 */
export const LIMB_TO_GM: Readonly<Record<Limb, number>> = {
  kick: 36,
  snare: 38,
  "cross-stick": 37,
  hihat: 42,
  "hihat-open": 46,
  ride: 51,
  "ride-bell": 53,
  crash: 49,
  china: 52,
  splash: 55,
  "tom-1": 50,
  "tom-2": 47,
  "tom-3": 45,
};

// =============================================================================
// PATTERN TEMPLATE
// =============================================================================

/**
 * A single drum hit at a fractional position within one bar.
 * `position` is 0.0 (downbeat) to 1.0 (next downbeat), inclusive.
 *
 * The pattern engine expands `defaultBars` of these into the requested
 * number of bars; see docs/03-data-model.md §Pattern engine.
 */
export interface Hit {
  /** Fractional position within one bar, 0.0–1.0. */
  position: number;
  limb: Limb;
  /** MIDI velocity, 0–127. */
  velocity: number;
  /** Visual + audio emphasis. Boosts velocity by +20 in the engine. */
  accent?: boolean;
}

export type Genre =
  | "metal"
  | "rock"
  | "punk"
  | "pop"
  | "jazz"
  | "funk"
  | "latin"
  | "hiphop";

/**
 * Hand-authored drum pattern. The moat. Lives in apps/web/data/patterns/*.json.
 *
 * The `description` is the screenreader-friendly text — generated from the
 * template at runtime, not a static caption. Format:
 *   {Name}. {Genre} at {tempo} BPM. {Limb-by-limb}. {Notable characteristics}.
 * See docs/05-accessibility.md §Pattern description format.
 */
export interface PatternTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  genre: Genre;
  defaultTempo: number;
  defaultBars: number;
  /** 0.0 = straight, ~0.33 = shuffle. */
  swingRatio?: number;
  hits: Hit[];
}

// =============================================================================
// PARSED REQUEST (parser output)
// =============================================================================

/**
 * Cymbal/voice hint that overrides a pattern's default cymbal.
 * e.g. "ride the crash" → cymbal: { type: "crash", pattern: "8ths" }
 */
export interface CymbalHint {
  type: "crash" | "ride" | "china" | "hihat-open" | "hihat-closed" | "splash";
  pattern?: "8ths" | "quarters" | "bell" | "wash" | "upstrokes";
}

export type TempoSource = "prompt" | "reaper" | "audio" | "default";
export type Feel = "straight" | "swing" | "half-time" | "double-time";
export type Intensity = "soft" | "medium" | "brutal" | "brutal-max";

/**
 * Structured output of the prompt parser. The parser is responsible for
 * producing this from free-form voice/text input. See ParseResult below.
 */
export interface ParsedRequest {
  /** Detected onomatopoeia, if any (e.g. "tupatupatupa"). */
  onomatopoeia?: string;
  /** Pattern template id (e.g. "d-beat", "skank"). */
  patternId?: string;
  /** User-friendly pattern name (e.g. "D-Beat"). */
  patternName?: string;
  bars: number;
  beats?: number;
  tempo?: number;
  tempoSource: TempoSource;
  tempoDefault: number;
  timeSignature: {
    numerator: number;
    denominator: number;
  };
  cymbal?: CymbalHint;
  /** Position descriptors, e.g. ["1", "and-of-2", "3"]. */
  accents?: string[];
  feel?: Feel;
  intensity?: Intensity;
}

/**
 * Parser return type. The union forces every call site to handle the
 * low-confidence case explicitly. Without this, the parser would need
 * to throw and the UI would need try/catch around every parse.
 *
 * - `ok: true` — confidence ≥ 0.7, request is ready to use.
 * - `ok: false` — parser has a guess but wants confirmation.
 */
export type ParseResult =
  | {
      ok: true;
      confidence: number;
      request: ParsedRequest;
    }
  | {
      ok: false;
      confidence: number;
      /** The parser's best guess and N alternates, sorted by confidence. */
      candidates: Array<{
        request: ParsedRequest;
        confidence: number;
        reason: string;
      }>;
      /** What the user actually said, normalized. */
      heardAs: string;
    };

// =============================================================================
// PATTERN ENGINE OUTPUT (MIDI events)
// =============================================================================

export interface MidiEvent {
  /** Absolute tick position from start of bar 1. */
  tick: number;
  limb: Limb;
  /** 0–127. */
  velocity: number;
  /** Ticks. Drums are short — typically 1–10. */
  duration: number;
}

// =============================================================================
// VOICE CONVERSATION FSM
// =============================================================================

/**
 * Voice conversation states. Defined in docs/04-ux-voice-first.md with two
 * additions for error handling and confirmation:
 *
 *   - `awaiting-confirmation` — parser confidence < 0.7, user must pick
 *   - `error`                  — recoverable failure (mic denied, parse error, etc.)
 *
 * State machine lives in apps/web/lib/voice/conversation.ts (separate concern).
 */
export type ConversationState =
  | "idle"
  | "listening"
  | "parsing"
  | "generating"
  | "ready"
  | "playing"
  | "awaiting-confirmation"
  | "error";

export interface ConversationContext {
  /** Current parsed request (set after entering 'parsing'). */
  parsed?: ParsedRequest;
  /** Last generated MIDI events (set after entering 'ready'). */
  midi?: MidiEvent[];
  /** Audio sample URL from the audio service, if generated. */
  sampleUrl?: string;
  /** Generated variations, 0–4. */
  variations?: MidiEvent[][];
  /** Currently selected variation, 1-based. */
  selectedVariation?: number;
  /** Last error, if state is 'error'. */
  error?: {
    kind:
      | "mic-denied"
      | "no-speech"
      | "parse-low-confidence"
      | "pattern-not-found"
      | "audio-timeout"
      | "audio-error"
      | "reaper-unavailable"
      | "unknown";
    message: string;
  };
}

// =============================================================================
// REAPER INTEGRATION
// =============================================================================

export interface ReaperState {
  connected: boolean;
  tempo: number | null;
  timeSignature: [number, number] | null;
  playState: number | null;
}

// =============================================================================
// ONOMATOPOEIA MAPPING
// =============================================================================

/**
 * Entry in apps/web/data/onomatopoeia.json. See docs/03-data-model.md
 * §Onomatopoeia mapping.
 */
export interface OnomatopoeiaEntry {
  id: string;
  /** Phonetic variants. Normalized (lowercase, no punctuation) at match time. */
  patterns: string[];
  patternId: string;
  defaultCymbal?: CymbalHint;
  defaultIntensity?: Intensity;
  /** 0.0–1.0. Below 0.7 the parser asks for confirmation. */
  confidence: number;
  notes?: string;
}

export interface OnomatopoeiaTable {
  version: number;
  entries: OnomatopoeiaEntry[];
}
