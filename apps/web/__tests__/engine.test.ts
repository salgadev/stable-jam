/**
 * Pattern engine tests.
 *
 * These are the foundation's correctness contract. They run on every PR.
 * If they break, the demo breaks — fix the engine, not the test.
 */

import { describe, it, expect } from "vitest";
import {
  expandPattern,
  bpmToMicrosecondsPerQuarter,
  ticksPerBar,
  TICKS_PER_QUARTER,
} from "../lib/patterns/engine";
import dbeat from "../data/patterns/d-beat.json";
import skank from "../data/patterns/skank.json";
import type { PatternTemplate } from "@patterntalk/shared-types";

const DB = dbeat as PatternTemplate;
const SK = skank as PatternTemplate;

describe("engine math primitives", () => {
  it("computes ticks-per-bar correctly for 4/4", () => {
    expect(ticksPerBar({ numerator: 4, denominator: 4 })).toBe(1920);
  });

  it("converts BPM to microseconds-per-quarter-note", () => {
    expect(bpmToMicrosecondsPerQuarter(120)).toBe(500000);
    expect(bpmToMicrosecondsPerQuarter(180)).toBe(333333);
    expect(bpmToMicrosecondsPerQuarter(60)).toBe(1000000);
  });
});

describe("expandPattern — d-beat", () => {
  const events = expandPattern({ template: DB, bars: 1, bpm: 180 });

  it("preserves the template's hit count for 1 bar", () => {
    expect(events).toHaveLength(DB.hits.length);
  });

  it("produces 4x hits for 4 bars", () => {
    const fourBars = expandPattern({ template: DB, bars: 4, bpm: 180 });
    expect(fourBars).toHaveLength(DB.hits.length * 4);
  });

  it("starts at tick 0 and respects the 1920 ticks-per-bar window", () => {
    const tickValues = events.map((e) => e.tick);
    expect(tickValues[0]).toBe(0);
    expect(Math.max(...tickValues)).toBeLessThan(1920);
  });

  it("sorts events by tick ascending", () => {
    const sorted = [...events].sort((a, b) => a.tick - b.tick);
    expect(events.map((e) => e.tick)).toEqual(sorted.map((e) => e.tick));
  });

  it("keeps all velocities in 1–127 range (humanize clamp)", () => {
    for (const ev of events) {
      expect(ev.velocity).toBeGreaterThanOrEqual(1);
      expect(ev.velocity).toBeLessThanOrEqual(127);
    }
  });

  it("emits a mix of kick, snare, and ride-bell hits", () => {
    const limbs = new Set(events.map((e) => e.limb));
    expect(limbs.has("kick")).toBe(true);
    expect(limbs.has("snare")).toBe(true);
    expect(limbs.has("ride-bell")).toBe(true);
  });
});

describe("expandPattern — cymbal override", () => {
  it("replaces ride-bell hits with crash when cymbal override is { type: 'crash' }", () => {
    const events = expandPattern({
      template: DB,
      bars: 1,
      bpm: 180,
      overrides: { cymbal: { type: "crash", pattern: "8ths" } },
    });
    const rideBellCount = events.filter((e) => e.limb === "ride-bell").length;
    const crashCount = events.filter((e) => e.limb === "crash").length;
    expect(rideBellCount).toBe(0);
    expect(crashCount).toBeGreaterThan(0);
  });

  it("replaces hihat with hihat-open", () => {
    const events = expandPattern({
      template: SK,
      bars: 1,
      bpm: 120,
      overrides: { cymbal: { type: "hihat-open", pattern: "upstrokes" } },
    });
    expect(events.filter((e) => e.limb === "hihat-open").length).toBeGreaterThan(0);
    expect(events.filter((e) => e.limb === "hihat").length).toBe(0);
  });
});

describe("expandPattern — accents", () => {
  it("boosts velocity by +20 on beat 1", () => {
    const baseline = expandPattern({ template: DB, bars: 4, bpm: 180 });
    const accented = expandPattern({
      template: DB,
      bars: 4,
      bpm: 180,
      overrides: { accents: ["1"] },
    });

    // The first kick in each bar is at tick = barIndex * 1920.
    // Its velocity in DB.hits is 110; humanize can shift ±2.
    // With accents, raw velocity = 110 + 20 + humanize (range 128–132),
    // clamped to 127. So expected >= 127.
    const firstKickPerBar = [0, 1920, 3840, 5760].map(
      (tick) => accented.find((e) => e.tick === tick && e.limb === "kick")!,
    );
    for (const ev of firstKickPerBar) {
      expect(ev.velocity).toBeGreaterThanOrEqual(127);
      // Clamped to 127
      expect(ev.velocity).toBeLessThanOrEqual(127);
    }
    // Sanity: without accents, same hit should be lower.
    const firstUnaccented = baseline
      .filter((e) => e.limb === "kick" && [0, 1920, 3840, 5760].includes(e.tick))
      .map((e) => e.velocity);
    expect(firstUnaccented.every((v) => v < 127)).toBe(true);
  });

  it("regression: accents apply to ALL bars, not just bar 0", () => {
    // Catches the bug where barTicks was being miscomputed from
    // bars[1]?.tick (which is undefined for ExpandedBar), making
    // accents only match for bar 0.
    const accented = expandPattern({
      template: DB,
      bars: 4,
      bpm: 180,
      overrides: { accents: ["1"] },
    });
    const beatOneKicks = [0, 1920, 3840, 5760]
      .map((tick) => accented.find((e) => e.tick === tick && e.limb === "kick"))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);
    expect(beatOneKicks).toHaveLength(4);
    for (const ev of beatOneKicks) {
      expect(ev.velocity).toBe(127); // 110 + humanize(±2) + 20 → clamped
    }
  });
});

describe("expandPattern — integration sanity", () => {
  it("d-beat at 180 BPM for 4 bars produces a tick range equal to 4 × ticksPerBar", () => {
    const events = expandPattern({ template: DB, bars: 4, bpm: 180 });
    const maxTick = Math.max(...events.map((e) => e.tick));
    expect(maxTick).toBeLessThan(4 * ticksPerBar({ numerator: 4, denominator: 4 }));
  });

  it("skank at 120 BPM has 8 hits in 1 bar", () => {
    const events = expandPattern({ template: SK, bars: 1, bpm: 120 });
    expect(events).toHaveLength(SK.hits.length);
    // 2 kicks + 2 snares + 4 hihats
    expect(events.filter((e) => e.limb === "kick")).toHaveLength(2);
    expect(events.filter((e) => e.limb === "snare")).toHaveLength(2);
    expect(events.filter((e) => e.limb === "hihat")).toHaveLength(4);
  });

  it("respects TICKS_PER_QUARTER constant", () => {
    expect(TICKS_PER_QUARTER).toBe(480);
  });
});
