import { describe, expect, it } from "vitest";
import { midiToFreq, parseMidi } from "@/lib/jambuddy/player";

describe("midiToFreq", () => {
  it("maps A4 (69) to 440 Hz", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 3);
  });
  it("maps C4 (60) to ~261.6 Hz", () => {
    expect(midiToFreq(60)).toBeCloseTo(261.63, 1);
  });
  it("is an octave up 12 semitones", () => {
    expect(midiToFreq(81)).toBeCloseTo(midiToFreq(69) * 2, 3);
  });
});

describe("parseMidi", () => {
  it("throws a readable error for non-MIDI bytes", () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3]).buffer)).toThrow();
  });
});
