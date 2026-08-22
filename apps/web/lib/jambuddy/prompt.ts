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
  | "drums";

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

/** Instrument → prompt fragment (the "knob" options). */
export const INSTRUMENT_PROMPTS: Readonly<Record<BuddyInstrument, string>> = {
  bass: "solo bass guitar, a grooving bass line, tight and in the pocket",
  lead: "solo lead guitar, a soaring melodic lead guitar riff",
  rhythm: "solo rhythm guitar, tight palm-muted power chords",
  synth: "a single synth pad, atmospheric and sustained, drone",
  drums: "solo drum kit, a punchy drum groove, kick and snare locked in",
};

/** Genre → prompt fragment. */
export const GENRE_PROMPTS: Readonly<Record<BuddyGenre, string>> = {
  metal: "heavy metal",
  rock: "rock",
  punk: "punk",
  hiphop: "hip hop",
  edm: "electronic dance music",
  jazz: "jazz",
  pop: "pop",
  any: "",
};

/** Mood → prompt fragment. */
export const MOOD_PROMPTS: Readonly<Record<BuddyMood, string>> = {
  energetic: "energetic",
  chill: "chill and relaxed",
  dark: "dark and brooding",
  bright: "bright and uplifting",
  aggressive: "aggressive and driving",
  melodic: "melodic and expressive",
};

/** Negative prompt — steer the general model AWAY from full-mix production. */
export const DEFAULT_NEGATIVE_PROMPT =
  "other instruments, full band, mixed ensemble, vocals, singing, chords, crowd, noise, field recording";

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
};

export interface BuddyKnobs {
  instrument: BuddyInstrument;
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
 * Structure follows the guide: TrackType: Instrument, {instrument}, {genre},
 * {mood}, {BPM} BPM, studio recording.
 */
export function buildPrompt(knobs: BuddyKnobs): BuddyPrompt {
  const parts: string[] = ["TrackType: Instrument"];

  const instrument = INSTRUMENT_PROMPTS[knobs.instrument];
  parts.push(instrument);

  const genre = GENRE_PROMPTS[knobs.genre];
  if (genre) parts.push(genre);

  const mood = MOOD_PROMPTS[knobs.mood];
  parts.push(mood);

  const bpm = Math.max(40, Math.min(240, Math.round(knobs.bpm)));
  parts.push(`${bpm} BPM`);

  parts.push("studio recording", "isolated solo instrument, only this one instrument");

  return {
    prompt: parts.join(", "),
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  };
}

/** The knob options, for rendering dropdowns. */
export const INSTRUMENTS: readonly BuddyInstrument[] = [
  "bass",
  "lead",
  "rhythm",
  "synth",
  "drums",
];
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
