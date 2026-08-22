/**
 * Voice conversation state machine.
 *
 * The single source of truth for "what state is the voice UI in."
 * Consumed by the React layer to decide which UI is shown and which
 * speech synthesis phrase to play.
 *
 * States (docs/04-ux-voice-first.md + two additions for error handling
 * and confirmation):
 *
 *   idle                      — nothing happening
 *   listening                 — mic active, capturing
 *   parsing                   — got final transcript, running the parser
 *   awaiting-confirmation     — parser confidence < 0.7, user must pick
 *   generating                — pattern engine + audio service running
 *   ready                     — MIDI + sample available, awaiting next command
 *   playing                   — audio preview playing
 *   error                     — recoverable failure (mic denied, parse error)
 *
 * Transitions are encoded as a pure function — given (state, event) return
 * (nextState, side-effects). The React layer (or a test) executes side-effects.
 */

import type {
  ConversationContext,
  ConversationState,
  ParseResult,
} from "@patterntalk/shared-types";

/** Events that drive state transitions. */
export type ConversationEvent =
  | { type: "START_LISTENING" }
  | { type: "STOP_LISTENING" }
  | { type: "TRANSCRIPT_FINAL"; transcript: string }
  | { type: "PARSE_OK"; result: Extract<ParseResult, { ok: true }> }
  | { type: "PARSE_LOW_CONFIDENCE"; result: Extract<ParseResult, { ok: false }> }
  | { type: "CONFIRM_CANDIDATE"; index: number }
  | { type: "GENERATION_OK"; sampleUrl?: string; variations?: number }
  | { type: "GENERATION_FAIL"; message: string }
  | { type: "PLAY_START" }
  | { type: "PLAY_STOP" }
  | { type: "RESET" }
  | { type: "ERROR"; kind: NonNullable<ConversationContext["error"]>["kind"]; message: string };

export interface Transition {
  next: ConversationState;
  context: ConversationContext;
  /** Side effects the host should run (TTS, API calls, etc.). */
  sideEffects: ConversationSideEffect[];
}

export type ConversationSideEffect =
  | { type: "SPEAK"; text: string; interrupt: boolean }
  | { type: "START_MIC" }
  | { type: "STOP_MIC" }
  | { type: "TRIGGER_GENERATION" }
  | { type: "TRIGGER_PLAYBACK" }
  | { type: "TRIGGER_STOP" };

/**
 * Pure transition function. Given a state + event, returns the next state,
 * updated context, and side-effects to run.
 *
 * Unknown events for the current state are ignored (returns same state).
 * This is intentional — voice UIs receive many stray events; the FSM
 * should be quiet when not in the right state.
 */
export function transition(
  state: ConversationState,
  context: ConversationContext,
  event: ConversationEvent,
): Transition {
  switch (event.type) {
    case "RESET":
      return {
        next: "idle",
        context: {},
        sideEffects: [{ type: "SPEAK", text: "Starting over.", interrupt: true }],
      };

    case "START_LISTENING": {
      if (state !== "idle" && state !== "ready" && state !== "error") {
        return { next: state, context, sideEffects: [] };
      }
      return {
        next: "listening",
        context: {},
        sideEffects: [{ type: "START_MIC" }],
      };
    }

    case "STOP_LISTENING": {
      if (state !== "listening") {
        return { next: state, context, sideEffects: [] };
      }
      return {
        next: state,
        context,
        sideEffects: [{ type: "STOP_MIC" }],
      };
    }

    case "TRANSCRIPT_FINAL": {
      if (state !== "listening") {
        return { next: state, context, sideEffects: [] };
      }
      return {
        next: "parsing",
        context: {},
        sideEffects: [
          { type: "STOP_MIC" },
          { type: "SPEAK", text: "Parsing.", interrupt: false },
        ],
      };
    }

    case "PARSE_OK": {
      if (state !== "parsing") return { next: state, context, sideEffects: [] };
      return {
        next: "generating",
        context: { parsed: event.result.request },
        sideEffects: [
          {
            type: "SPEAK",
            text: `Generating ${event.result.request.patternName ?? event.result.request.patternId ?? "pattern"}, ${event.result.request.bars} bars at ${event.result.request.tempo ?? event.result.request.tempoDefault} BPM.`,
            interrupt: true,
          },
          { type: "TRIGGER_GENERATION" },
        ],
      };
    }

    case "PARSE_LOW_CONFIDENCE": {
      if (state !== "parsing") return { next: state, context, sideEffects: [] };
      const top = event.result.candidates[0];
      const message = top
        ? `I heard ${event.result.heardAs}. Did you mean ${top.request.patternName ?? top.request.patternId}?`
        : `I heard ${event.result.heardAs}, but I'm not sure.`;
      return {
        next: "awaiting-confirmation",
        context: {},
        sideEffects: [{ type: "SPEAK", text: message, interrupt: true }],
      };
    }

    case "CONFIRM_CANDIDATE": {
      if (state !== "awaiting-confirmation") {
        return { next: state, context, sideEffects: [] };
      }
      // The host should have stored the candidates in context.candidates.
      // We can't store ParseResult directly because it lives in shared-types;
      // for now, callers pass the index and the host resolves it externally.
      // This is intentional — keeps the FSM serializable.
      return {
        next: "generating",
        context,
        sideEffects: [{ type: "TRIGGER_GENERATION" }],
      };
    }

    case "GENERATION_OK": {
      if (state !== "generating") {
        return { next: state, context, sideEffects: [] };
      }
      return {
        next: "ready",
        context: {
          ...context,
          sampleUrl: event.sampleUrl,
          variations: context.variations ?? [],
        },
        sideEffects: [
          {
            type: "SPEAK",
            text: "Ready. Say play to preview, regenerate, download MIDI, or new pattern.",
            interrupt: true,
          },
        ],
      };
    }

    case "GENERATION_FAIL": {
      return {
        next: "error",
        context: {
          ...context,
          error: { kind: "audio-error", message: event.message },
        },
        sideEffects: [{ type: "SPEAK", text: event.message, interrupt: true }],
      };
    }

    case "PLAY_START": {
      if (state !== "ready") return { next: state, context, sideEffects: [] };
      return {
        next: "playing",
        context,
        sideEffects: [{ type: "TRIGGER_PLAYBACK" }],
      };
    }

    case "PLAY_STOP": {
      if (state !== "playing") return { next: state, context, sideEffects: [] };
      return {
        next: "ready",
        context,
        sideEffects: [{ type: "TRIGGER_STOP" }],
      };
    }

    case "ERROR": {
      return {
        next: "error",
        context: { ...context, error: { kind: event.kind, message: event.message } },
        sideEffects: [{ type: "SPEAK", text: event.message, interrupt: true }],
      };
    }
  }
}
