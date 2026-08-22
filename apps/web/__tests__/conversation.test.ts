/**
 * Voice conversation FSM tests.
 *
 * Pure transition tests — no DOM, no audio. Verify each state transition
 * produces the expected next state and side-effects.
 */

import { describe, it, expect } from "vitest";
import { transition } from "../lib/voice/conversation";
import type { ParseResult } from "@patterntalk/shared-types";

describe("voice FSM — happy path", () => {
  it("idle → listening → parsing → generating → ready on a clean prompt", () => {
    let s = transition("idle", {}, { type: "START_LISTENING" });
    expect(s.next).toBe("listening");
    expect(s.sideEffects.map((e) => e.type)).toContain("START_MIC");

    s = transition(s.next, s.context, { type: "TRANSCRIPT_FINAL", transcript: "d-beat at 180" });
    expect(s.next).toBe("parsing");

    const parseOk: ParseResult = {
      ok: true,
      confidence: 0.95,
      request: {
        patternId: "d-beat",
        patternName: "D-Beat",
        bars: 4,
        tempoSource: "prompt",
        tempoDefault: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        tempo: 180,
      },
    };
    s = transition(s.next, s.context, { type: "PARSE_OK", result: parseOk });
    expect(s.next).toBe("generating");

    s = transition(s.next, s.context, {
      type: "GENERATION_OK",
      sampleUrl: "http://localhost:8001/cache/abc.wav",
    });
    expect(s.next).toBe("ready");
    expect(s.context.parsed?.patternId).toBe("d-beat");
    expect(s.context.sampleUrl).toBe("http://localhost:8001/cache/abc.wav");
  });
});

describe("voice FSM — low confidence → confirmation", () => {
  it("parsing → awaiting-confirmation when PARSE_LOW_CONFIDENCE fires", () => {
    const lowConf: ParseResult = {
      ok: false,
      confidence: 0.4,
      heardAs: "tupatupa",
      candidates: [
        {
          request: {
            patternId: "skank",
            patternName: "Skank Beat",
            bars: 4,
            tempoSource: "default",
            tempoDefault: 120,
            timeSignature: { numerator: 4, denominator: 4 },
          },
          confidence: 0.4,
          reason: "phonetic match",
        },
      ],
    };
    const s = transition("parsing", {}, { type: "PARSE_LOW_CONFIDENCE", result: lowConf });
    expect(s.next).toBe("awaiting-confirmation");
    const speak = s.sideEffects.find((e) => e.type === "SPEAK");
    expect(speak).toBeDefined();
    if (speak && speak.type === "SPEAK") {
      expect(speak.text).toContain("Skank Beat");
    }
  });
});

describe("voice FSM — error states", () => {
  it("any state → error on ERROR event", () => {
    const s = transition("listening", {}, {
      type: "ERROR",
      kind: "mic-denied",
      message: "Microphone access denied. Enable it in browser settings.",
    });
    expect(s.next).toBe("error");
    expect(s.context.error?.kind).toBe("mic-denied");
  });

  it("GENERATION_FAIL routes to error state", () => {
    const s = transition("generating", {}, {
      type: "GENERATION_FAIL",
      message: "Sample generation timed out. MIDI is still ready.",
    });
    expect(s.next).toBe("error");
    expect(s.context.error?.message).toContain("timed out");
  });
});

describe("voice FSM — RESET", () => {
  it("RESET from any state returns to idle", () => {
    const s1 = transition("ready", { parsed: { patternId: "x", bars: 4, tempoSource: "default", tempoDefault: 120, timeSignature: { numerator: 4, denominator: 4 } } }, { type: "RESET" });
    expect(s1.next).toBe("idle");
    expect(s1.context).toEqual({});
  });
});

describe("voice FSM — ignores stray events", () => {
  it("TRANSCRIPT_FINAL while idle is ignored", () => {
    const s = transition("idle", {}, { type: "TRANSCRIPT_FINAL", transcript: "hi" });
    expect(s.next).toBe("idle");
    expect(s.sideEffects).toHaveLength(0);
  });

  it("PLAY_START while idle is ignored", () => {
    const s = transition("idle", {}, { type: "PLAY_START" });
    expect(s.next).toBe("idle");
  });
});
