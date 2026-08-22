/**
 * Jam Buddy prompt builder.
 *
 * Builds the SA3 text prompt from the user's "knobs", following the official
 * Stable Audio 3 prompt guide (docs/guides/prompting.md → "Stem & Solo
 * Instrument Prompting"):
 *
 *   Key elements: TrackType: Instrument, Instrument/Stem, Genre, Mood & energy,
 *   BPM.
 *
 * The guide's recommended structure for an isolated instrument is:
 *   TrackType: Instrument, {instrument}, {genre}, {mood}, {BPM} BPM
 *
 * We also append "studio recording" (positive) and use "field recording" as the
 * negative prompt — the training data is Freesound/AudioSparx (full of field
 * recordings), so steering away from that improves quality.
 *
 * Pure function — no DOM, no I/O. Test this thoroughly.
 */

export type BuddyInstrument =
  | "bass"
  | "lead"
  | "rhythm"
  | "synth"
  | "drums"
  | "sax"
  | "cleanguitar"
  | "overdrivenguitar";

/**
 * What the user IS playing on their take. SA3 has no MIR — it cannot read the
 * input MIDI/audio to know what's already there. The user declares it, which
 * (a) gives the buddy context about what to complement, and (b) honestly
 * acknowledges the model limit. "other" = default, no specific declaration.
 */
export type InputInstrument =
  | "drums"
  | "bass"
  | "guitar"
  | "keys"
  | "vocals"
  | "other";

export type BuddyGenre =
  | "metal"
  | "rock"
  | "punk"
  | "hiphop"
  | "edm"
  | "jazz"
  | "pop"
  | "any";

export type BuddyMood =
  | "energetic"
  | "chill"
  | "dark"
  | "bright"
  | "aggressive"
  | "melodic";

/** Instrument → AudioSparx `Instruments:` tag fragment (the "knob" options). */
export const INSTRUMENT_PROMPTS: Readonly<Record<BuddyInstrument, string>> = {
  bass: "Bass Guitar, a grooving bass line, tight and in the pocket",
  lead: "Lead Guitar, a soaring melodic lead guitar riff",
  rhythm: "Rhythm Guitar, tight palm-muted power chords",
  synth: "Synth, a warm atmospheric pad",
  drums: "Drums, a punchy drum groove, kick and snare locked in",
  sax: "Saxophone, a warm breathy saxophone line with a rich tone",
  cleanguitar: "Clean Guitar, bright chimey clean electric guitar arpeggios",
  overdrivenguitar: "Overdriven Guitar, a gritty overdriven guitar riff with crunch",
};

/** Genre → AudioSparx `Genre:` tag. Matches the model's training vocab. */
export const GENRE_PROMPTS: Readonly<Record<BuddyGenre, string>> = {
  metal: "Heavy Metal",
  rock: "Rock",
  punk: "Punk",
  hiphop: "Hip Hop",
  edm: "Electronic Dance Music",
  jazz: "Jazz",
  pop: "Pop",
  any: "",
};

/** Mood → AudioSparx `Moods:` tag. */
export const MOOD_PROMPTS: Readonly<Record<BuddyMood, string>> = {
  energetic: "Energetic",
  chill: "Relaxed",
  dark: "Dark",
  bright: "Uplifting",
  aggressive: "Aggressive",
  melodic: "Melodic",
};

/** Negative-prompt tokens always applied (full-mix steer). */
const BASE_NEGATIVES: readonly string[] = [
  "other instruments", "full band", "mixed ensemble", "vocals",
  "singing", "chords", "crowd", "noise", "field recording",
];

/**
 * SA3 model per instrument. Drums force `small-sfx` — it yields clean isolated
 * drum hits, not full-mix texture (verified: sfx is sparse, ~1.2 hits/sec,
 * clean single hits vs music's dense smear). Everything else uses `small-music`
 * for musical phrases.
 */
export const MODEL_FOR_INSTRUMENT: Readonly<Record<BuddyInstrument, string>> = {
  bass: "small-music",
  lead: "small-music",
  rhythm: "small-music",
  synth: "small-music",
  drums: "small-sfx",
  sax: "small-music",
  cleanguitar: "small-music",
  overdrivenguitar: "small-music",
};

export interface BuddyKnobs {
  instrument: BuddyInstrument;
  /** What the user is playing on the take. Helps SA3 complement, not duplicate. */
  inputInstrument: InputInstrument;
  genre: BuddyGenre;
  mood: BuddyMood;
  bpm: number;
}

export interface BuddyPrompt {
  /** Positive prompt for SA3. */
  prompt: string;
  /** Negative prompt for SA3. */
  negativePrompt: string;
}

/**
 * Build the SA3 prompt from the knobs.
 *
 * Structure follows the official Stable Audio 3 prompt guide — the model is
 * trained on Freesound/AudioSparx metadata, so prompts that use the AudioSparx
 * tag vocabulary (`Genre:`, `Moods:`, `Instruments:`) adhere best:
 *
 *   TrackType: Music, VocalType: Instrumental, Genre: {genre},
 *   Moods: {mood}, Instruments: {instrument}, {BPM} BPM, studio recording
 *
 * `TrackType: Music, VocalType: Instrumental` is the documented prefix for
 * music generation (it's what the training metadata prepends) and materially
 * improves quality/adherence vs. the old `TrackType: Instrument`.
 */
export function buildPrompt(knobs: BuddyKnobs): BuddyPrompt {
  const parts: string[] = ["TrackType: Music, VocalType: Instrumental"];

  const genre = GENRE_PROMPTS[knobs.genre];
  if (genre) parts.push(`Genre: ${genre}`);

  const mood = MOOD_PROMPTS[knobs.mood];
  parts.push(`Moods: ${mood}`);

  const instrument = INSTRUMENT_PROMPTS[knobs.instrument];
  parts.push(`Instruments: ${instrument}`);

  const bpm = Math.max(40, Math.min(240, Math.round(knobs.bpm)));
  parts.push(`${bpm} BPM`, "studio recording");

  // Build the negative prompt only — DO NOT add "avoid ..." to the positive
  // prompt. SA3 is trained on AudioSparx tag vocab; free-form "avoid drums"
  // would be out-of-vocab noise that dilutes the metadata header. The
  // negative prompt is the correct place to steer away from the user's input
  // instrument, and SA3 reads it as a hard constraint.
  const negatives = [...BASE_NEGATIVES];
  if (knobs.instrument !== "drums") negatives.push("percussion");
  if (knobs.inputInstrument && knobs.inputInstrument !== "other") {
    const ctx = INPUT_INSTRUMENT_PROMPTS[knobs.inputInstrument];
    // Only negate the user's instrument when it's a DIFFERENT family from
    // the buddy. e.g. buddy=lead (lead guitar) + input=guitar would steer
    // SA3 away from ALL guitars including the buddy's. Compare nouns, not
    // strings: drop the negation when the input noun overlaps the buddy's
    // noun family.
    if (ctx && !buddyInstrumentFamilyMatches(knobs.instrument, ctx)) {
      negatives.push(ctx);
    }
  }
  const negativePrompt = negatives.join(", ");

  return {
    prompt: parts.join(", "),
    negativePrompt,
  };
}

/**
 * Does the buddy instrument's noun family overlap with the user's input
 * noun? Used to avoid negating an instrument family the buddy is part of.
 *
 * e.g. buddy=lead ("lead guitar"), input=guitar ("guitar") — overlap, so we
 * do NOT add "guitar" to the negative, since it would steer SA3 away from
 * the buddy itself.
 */
function buddyInstrumentFamilyMatches(
  instrument: BuddyInstrument,
  inputNoun: string,
): boolean {
  const family: Readonly<Record<BuddyInstrument, string>> = {
    bass: "bass",
    lead: "guitar",
    rhythm: "guitar",
    synth: "synth",
    drums: "drums",
    sax: "sax",
    cleanguitar: "guitar",
    overdrivenguitar: "guitar",
  };
  return family[instrument] === inputNoun;
}

/** The knob options, for rendering dropdowns. */
export const INSTRUMENTS: readonly BuddyInstrument[] = [
  "bass",
  "lead",
  "rhythm",
  "synth",
  "drums",
  "sax",
  "cleanguitar",
  "overdrivenguitar",
];
/** Input-instrument vocab (what the user is playing on the take). */
export const INPUT_INSTRUMENTS: readonly InputInstrument[] = [
  "drums",
  "bass",
  "guitar",
  "keys",
  "vocals",
  "other",
];
/** Display labels for the input-instrument knob (AudioSparx vocab where possible). */
export const INPUT_INSTRUMENT_LABELS: Readonly<Record<InputInstrument, string>> = {
  drums: "Drums",
  bass: "Bass",
  guitar: "Guitar",
  keys: "Keys / Synth",
  vocals: "Vocals",
  other: "Other / mixed",
};
/** Input-instrument → short AudioSparx-style noun for the prompt. */
export const INPUT_INSTRUMENT_PROMPTS: Readonly<Record<InputInstrument, string>> = {
  drums: "drums",
  bass: "bass",
  guitar: "guitar",
  keys: "keys",
  vocals: "vocals",
  other: "",
};
export const GENRES: readonly BuddyGenre[] = [
  "metal",
  "rock",
  "punk",
  "hiphop",
  "edm",
  "jazz",
  "pop",
  "any",
];
export const MOODS: readonly BuddyMood[] = [
  "energetic",
  "chill",
  "dark",
  "bright",
  "aggressive",
  "melodic",
];
/** Human-friendly knob labels. The enum stays lowercase for wire-format
 * stability; the UI reads these for display. AudioSparx vocab where possible. */
export const GENRE_LABELS: Readonly<Record<BuddyGenre, string>> = {
  metal: "Heavy Metal", rock: "Rock", punk: "Punk Rock", hiphop: "Hip Hop",
  edm: "Electronic", jazz: "Jazz", pop: "Pop", any: "Any",
};
export const MOOD_LABELS: Readonly<Record<BuddyMood, string>> = {
  energetic: "Energetic", chill: "Chill", dark: "Dark", bright: "Bright",
  aggressive: "Aggressive", melodic: "Melodic",
};
/** Human-friendly labels for the buddy-instrument pads. */
export const INSTRUMENT_LABELS: Readonly<Record<BuddyInstrument, string>> = {
  bass: "Bass", lead: "Lead Guitar", rhythm: "Rhythm Guitar", synth: "Synth",
  drums: "Drums", sax: "Sax", cleanguitar: "Clean Guitar",
  overdrivenguitar: "Overdriven Guitar",
};
