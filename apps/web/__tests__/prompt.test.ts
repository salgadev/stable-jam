import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  type BuddyKnobs,
} from "@/lib/jambuddy/prompt";

const base: BuddyKnobs = {
  instrument: "bass",
  inputInstrument: "drums",
  genre: "metal",
  mood: "energetic",
  bpm: 184,
};

describe("buildPrompt", () => {
  it("follows the AudioSparx tag structure: TrackType, Genre, Moods, Instruments, BPM, studio", () => {
    const { prompt } = buildPrompt(base);
    expect(prompt).toContain("TrackType: Music, VocalType: Instrumental");
    expect(prompt).toContain("Genre: Heavy Metal");
    expect(prompt).toContain("Moods: Energetic");
    expect(prompt).toContain("Instruments: Bass Guitar");
    expect(prompt).toContain("184 BPM");
    expect(prompt).toContain("studio recording");
  });

  it("omits the genre fragment when genre is 'any'", () => {
    const { prompt } = buildPrompt({ ...base, genre: "any" });
    expect(prompt).not.toContain("Genre:");
    expect(prompt).toContain("TrackType: Music, VocalType: Instrumental");
    expect(prompt).toContain("184 BPM");
  });

  it("clamps BPM to a sane range", () => {
    const low = buildPrompt({ ...base, bpm: 5 });
    expect(low.prompt).toContain("40 BPM");
    const high = buildPrompt({ ...base, bpm: 9999 });
    expect(high.prompt).toContain("240 BPM");
  });

  it("sets a negative prompt that steers away from a full mix", () => {
    const { negativePrompt } = buildPrompt(base);
    expect(negativePrompt).toContain("field recording");
    expect(negativePrompt).toContain("full band");
    expect(negativePrompt).toContain("vocals");
  });

  it("rounds fractional BPM", () => {
    const { prompt } = buildPrompt({ ...base, bpm: 184.6 });
    expect(prompt).toContain("185 BPM");
  });

  it("negates the user's input instrument in the negative prompt when it differs from the buddy", () => {
    const { negativePrompt } = buildPrompt({ ...base, inputInstrument: "drums" });
    expect(negativePrompt).toContain("drums");
  });

  it("does not negate the buddy's own instrument family in the negative prompt (lead guitar + input guitar)", () => {
    const { negativePrompt } = buildPrompt({
      ...base,
      instrument: "lead",
      inputInstrument: "guitar",
    });
    // buddy=lead is in the guitar family; adding "guitar" to the negative
    // would steer SA3 away from the buddy itself, so we must NOT add it.
    expect(negativePrompt).not.toContain("guitar");
  });

  it("drops 'percussion' from the negative when the buddy is drums", () => {
    const { negativePrompt } = buildPrompt({
      ...base,
      instrument: "drums",
      inputInstrument: "other",
    });
    expect(negativePrompt).not.toContain("percussion");
  });

  it("omits the complement clause when inputInstrument is 'other'", () => {
    const { prompt } = buildPrompt({ ...base, inputInstrument: "other" });
    expect(prompt).not.toContain("complement");
  });
});
