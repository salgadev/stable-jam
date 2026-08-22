/**
 * Pattern engine.
 *
 * Expands a PatternTemplate into MidiEvent[] given the user's request.
 * Pure function — no DOM, no audio, no I/O. Test this thoroughly.
 *
 * Process (per docs/03-data-model.md §Pattern engine):
 *   1. Load template
 *   2. Expand to requested bars (repeat template.defaultBars pattern N times)
 *   3. Apply cymbal override (replace ride/hihat hits with cymbal type)
 *   4. Apply accents (+20 velocity on matching positions)
 *   5. Apply feel modifier (swing / half-time / double-time)
 *   6. Convert fractional positions (0.0–1.0) to absolute ticks at tempoBpm
 */

import type {
  Hit,
  Limb,
  MidiEvent,
  ParsedRequest,
  PatternTemplate,
} from "@patterntalk/shared-types";

/** MIDI ticks per quarter note. The de facto standard (also SMTE/QT). */
export const TICKS_PER_QUARTER = 480;

/** Compute ticks-per-bar for a given time signature. */
export function ticksPerBar(
  timeSignature: { numerator: number; denominator: number },
): number {
  // A bar = numerator quarter notes, regardless of denominator.
  return TICKS_PER_QUARTER * timeSignature.numerator;
}

export interface EngineOverrides {
  cymbal?: ParsedRequest["cymbal"];
  accents?: string[];
  feel?: ParsedRequest["feel"];
}

export interface EngineInput {
  template: PatternTemplate;
  bars: number;
  bpm: number;
  timeSignature?: { numerator: number; denominator: number };
  overrides?: EngineOverrides;
}

/** Limb set considered "cymbal-shaped" — replaced by a cymbal override. */
const CYMBAL_LIMBS: ReadonlySet<Limb> = new Set([
  "hihat",
  "hihat-open",
  "ride",
  "ride-bell",
  "crash",
  "china",
  "splash",
]);

/** Map cymbal hint to a Limb. */
function cymbalToLimb(type: NonNullable<ParsedRequest["cymbal"]>["type"]): Limb {
  switch (type) {
    case "crash":
      return "crash";
    case "ride":
      return "ride-bell"; // default ride → ride-bell (8ths on the bell)
    case "china":
      return "china";
    case "hihat-open":
      return "hihat-open";
    case "hihat-closed":
      return "hihat";
    case "splash":
      return "splash";
  }
}

interface ExpandedBar {
  /** 0-based bar index. */
  barIndex: number;
  hits: Array<{ hit: Hit; tick: number }>;
}

/**
 * Expand a template to N bars. Repeats the template's `defaultBars` pattern
 * until N bars are filled. Velocity humanization: tiny per-bar nudge so
 * repeated bars don't sound robotic.
 */
function expandBars(input: EngineInput): ExpandedBar[] {
  const ts = input.timeSignature ?? { numerator: 4, denominator: 4 };
  const barTicks = ticksPerBar(ts);
  const template = input.template;
  const repeatLength = Math.max(1, template.defaultBars);
  const totalBars = Math.max(1, Math.floor(input.bars));

  const result: ExpandedBar[] = [];
  for (let barIndex = 0; barIndex < totalBars; barIndex++) {
    // Index into the template pattern (handles templates that cover > 1 bar)
    const templateBarIndex = barIndex % repeatLength;

    // Humanization: ±2 velocity, deterministic per bar index.
    const humanize = (barIndex * 17 + 11) % 5 - 2;

    const hits: Array<{ hit: Hit; tick: number }> = [];
    for (const hit of template.hits) {
      // Filter hits to only those in the current template bar.
      // Hits can have positions across multiple bars; we only want the ones
      // for the current templateBarIndex. Since positions are 0.0–1.0 within
      // a single bar, all hits in a single-bar template belong to bar 0;
      // for multi-bar templates the position encoding is per-bar.
      if (template.defaultBars === 1 || templateBarIndex === 0) {
        // Clamp position to [0, 1) — guards against authoring errors.
        const pos = Math.max(0, Math.min(0.999_999, hit.position));
        const tick = Math.round(barIndex * barTicks + pos * barTicks);
        const velocity = Math.max(
          1,
          Math.min(127, hit.velocity + humanize),
        );
        hits.push({ hit: { ...hit, velocity }, tick });
      }
    }
    result.push({ barIndex, hits });
  }
  return result;
}

/**
 * Apply a cymbal override. For each expanded hit whose limb is a cymbal,
 * replace the limb with the override's target.
 *
 * For multi-bar templates we only override cymbals in the bars that exist.
 */
function applyCymbalOverride(
  bars: ExpandedBar[],
  cymbal: NonNullable<ParsedRequest["cymbal"]>,
): ExpandedBar[] {
  const target: Limb = cymbalToLimb(cymbal.type);
  return bars.map((bar) => ({
    ...bar,
    hits: bar.hits.map(({ hit, tick }) =>
      CYMBAL_LIMBS.has(hit.limb)
        ? { hit: { ...hit, limb: target }, tick }
        : { hit, tick },
    ),
  }));
}

/**
 * Apply accent boosts. For each accent descriptor, find hits whose position
 * matches and boost velocity by +20.
 *
 * GOTCHA: `barTicks` must come from `ticksPerBar(timeSignature)`, NOT from
 * any property of `bars[N]`. `ExpandedBar` has `{ barIndex, hits }` — no
 * `.tick` field. Reading `bars[1]?.tick` returns undefined, which silently
 * collapses `barTicks` to 1, and accents then only match bar 0. Regression
 * test: "__tests__/engine.test.ts > regression: accents apply to ALL bars".
 *
 * Supported descriptors (start of v1):
 *   "1", "2", "3", "4"        — beats within a 4/4 bar
 *   "and-of-2", "and-of-4"    — classic backbeat accents
 */
function applyAccents(
  bars: ExpandedBar[],
  accents: string[],
  timeSignature: { numerator: number; denominator: number } = { numerator: 4, denominator: 4 },
): ExpandedBar[] {
  const barTicks = ticksPerBar(timeSignature);
  const quarter = TICKS_PER_QUARTER;

  return bars.map((bar) => {
    const hits = bar.hits.map(({ hit, tick }) => {
      const localTick = tick - bar.barIndex * barTicks;
      // Position within the bar in quarter notes
      const localQuarter = localTick / quarter;
      const beat = Math.floor(localQuarter) + 1; // 1-based
      const isAnd = (localQuarter - Math.floor(localQuarter)) > 0.4;
      const localPos = `${beat}${isAnd ? "-and" : ""}`;

      const matched = accents.some((a) => {
        if (a === localPos) return true;
        if (a === "1" && beat === 1 && !isAnd) return true;
        if (a === "3" && beat === 3 && !isAnd) return true;
        if (a === "and-of-2" && beat === 2 && isAnd) return true;
        if (a === "and-of-4" && beat === 4 && isAnd) return true;
        return false;
      });

      return matched
        ? {
            hit: { ...hit, velocity: Math.min(127, hit.velocity + 20), accent: true },
            tick,
          }
        : { hit, tick };
    });
    return { ...bar, hits };
  });
}

/**
 * Apply feel modifier. v1 supports swing (delays offbeat 8ths by swingRatio).
 * Half-time and double-time are recognized but not yet implemented —
 * TODO for the engine-extension PR.
 */
function applyFeel(
  bars: ExpandedBar[],
  feel: NonNullable<ParsedRequest["feel"]>,
  swingRatio: number,
  timeSignature: { numerator: number; denominator: number } = { numerator: 4, denominator: 4 },
): ExpandedBar[] {
  if (feel !== "swing") return bars; // half-time / double-time deferred

  const barTicks = ticksPerBar(timeSignature);
  const quarter = TICKS_PER_QUARTER;
  const swingOffset = Math.round(swingRatio * quarter);

  return bars.map((bar) => ({
    ...bar,
    hits: bar.hits.map(({ hit, tick }) => {
      const localTick = tick - bar.barIndex * barTicks;
      const localQuarter = localTick / quarter;
      const isAnd = (localQuarter - Math.floor(localQuarter)) > 0.4;
      return isAnd
        ? { hit, tick: tick + swingOffset }
        : { hit, tick };
    }),
  }));
}

/**
 * Expand a PatternTemplate into MidiEvent[] for the requested bars and tempo.
 *
 * This is the single entry point used by the MIDI generator and by tests.
 */
export function expandPattern(input: EngineInput): MidiEvent[] {
  const ts = input.timeSignature ?? { numerator: 4, denominator: 4 };
  const overrides = input.overrides ?? {};

  let bars = expandBars(input);

  if (overrides.cymbal) {
    bars = applyCymbalOverride(bars, overrides.cymbal);
  }
  if (overrides.accents && overrides.accents.length > 0) {
    bars = applyAccents(bars, overrides.accents, ts);
  }
  if (overrides.feel) {
    bars = applyFeel(bars, overrides.feel, input.template.swingRatio ?? 0, ts);
  }

  const events: MidiEvent[] = [];
  for (const bar of bars) {
    for (const { hit, tick } of bar.hits) {
      events.push({
        tick,
        limb: hit.limb,
        velocity: hit.velocity,
        duration: 8, // ~8 ticks — short drum hit
      });
    }
  }

  // Sort by tick for clean MIDI output.
  events.sort((a, b) => a.tick - b.tick);
  return events;
}

/**
 * Compute the bar-tempo in microseconds-per-quarter-note for the MIDI header.
 * Standard MIDI tempo meta-event.
 */
export function bpmToMicrosecondsPerQuarter(bpm: number): number {
  return Math.round(60_000_000 / bpm);
}
