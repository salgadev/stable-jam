import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  type BuddyKnobs,
} from "@/lib/jambuddy/prompt";

const base: BuddyKnobs = {
  instrument: "bass",
  genre: "metal",
  mood: "energetic",
  bpm: 184,
};

describe("buildPrompt", () => {
  it("follows the SA3 guide structure: TrackType, instrument, genre, mood, BPM, studio", () => {
    const { prompt } = buildPrompt(base);
    expect(prompt).toContain("TrackType: Instrument");
    expect(prompt).toContain("solo bass guitar");
    expect(prompt).toContain("heavy metal");
    expect(prompt).toContain("energetic");
    expect(prompt).toContain("184 BPM");
    expect(prompt).toContain("studio recording");
    expect(prompt).toContain("isolated solo instrument, only this one instrument");
  });

  it("omits the genre fragment when genre is 'any'", () => {
    const { prompt } = buildPrompt({ ...base, genre: "any" });
    expect(prompt).not.toContain("heavy metal");
    expect(prompt).toContain("TrackType: Instrument");
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
});
