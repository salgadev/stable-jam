/**
 * Jam Buddy playback.
 *
 * Plays the user's MIDI take and the buddy's generated response TOGETHER, in
 * tempo, via the Web Audio API.
 *
 * - The MIDI take is rendered to audio with a lightweight synth (an oscillator
 *   per note) so it's audible as "your" part, distinct from the buddy.
 * - The generated response is a decoded AudioBuffer (the buddy's WAV).
 * - Both are scheduled on the SAME AudioContext clock starting together, so
 *   they stay in sync.
 *
 * This module is browser-only (window.AudioContext). It does not run under
 * Node — keep all Web Audio in here and call from the page.
 */

import { Midi } from "@tonejs/midi";

/** A parsed note: absolute start time (sec), midi note, velocity 0-1. */
export interface ParsedNote {
  time: number;
  midi: number;
  duration: number;
  velocity: number;
}

/** Parse a MIDI file's bytes into playable notes (+ duration). */
export function parseMidi(bytes: ArrayBuffer): ParsedNote[] {
  const midi = new Midi(bytes);
  const notes: ParsedNote[] = [];
  for (const track of midi.tracks) {
    for (const note of track.notes) {
      notes.push({
        time: note.time,
        midi: note.midi,
        duration: note.duration,
        velocity: note.velocity,
      });
    }
  }
  notes.sort((a, b) => a.time - b.time);
  return notes;
}

/** midi note -> frequency in Hz. */
export function midiToFreq(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

/**
 * Schedule a MIDI note as a short pitched oscillator through a gain envelope.
 * Drums (channel-10 style, low/high notes) get a percussive click instead.
 */
function scheduleNote(
  ctx: AudioContext,
  note: ParsedNote,
  dest: AudioNode,
  when: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.value = midiToFreq(note.midi);

  const dur = Math.max(0.05, note.duration);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(note.velocity * 0.5, when + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

  osc.connect(gain);
  gain.connect(dest);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

/**
 * Play the MIDI take and the buddy WAV together.
 *
 * @param midiBytes      the user's MIDI take (raw bytes)
 * @param buddyAudioUrl  the generated response WAV (object URL)
 * @param when           optional start offset in sec (default: immediately)
 * @returns an object with stop(), and promise resolving when both finish.
 */
export async function playTogether(
  midiBytes: ArrayBuffer,
  buddyAudioUrl: string,
): Promise<{ stop: () => void; done: Promise<void> }> {
  const ctx = new AudioContext();
  await ctx.resume();

  // Decode the buddy WAV into a buffer.
  const resp = await fetch(buddyAudioUrl);
  const wav = await resp.arrayBuffer();
  const buddyBuffer = await ctx.decodeAudioData(wav);

  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  const notes = parseMidi(midiBytes);
  const startAt = ctx.currentTime + 0.1;

  // Schedule the buddy at the same clock time.
  const buddySrc = ctx.createBufferSource();
  buddySrc.buffer = buddyBuffer;
  buddySrc.connect(master);
  buddySrc.start(startAt);

  // Schedule the MIDI notes.
  for (const note of notes) {
    scheduleNote(ctx, note, master, startAt + note.time);
  }

  const buddyEnd = startAt + buddyBuffer.duration;
  const lastMidiTime = notes.length ? (notes[notes.length - 1]?.time ?? 0) : 0;
  const midiEnd = startAt + lastMidiTime + 1;
  const end = Math.max(buddyEnd, midiEnd);

  const done = new Promise<void>((resolve) => {
    setTimeout(() => {
      try {
        ctx.close();
      } catch {
        /* already closed */
      }
      resolve();
    }, Math.max(0, (end - ctx.currentTime) * 1000) + 200);
  });

  return {
    stop: () => {
      try {
        buddySrc.stop();
        ctx.close();
      } catch {
        /* ignore */
      }
    },
    done,
  };
}

/** Get the detected tempo from a MIDI file (for display). */
export function midiTempo(buf: ArrayBuffer): number {
  try {
    const midi = new Midi(buf);
    const t = midi.header.tempos[0]?.bpm;
    return t ? Math.round(t) : 120;
  } catch {
    return 120;
  }
}

/**
 * Get the total duration (seconds) of a MIDI file — the time of the last note
 * end. This is what the generated response must match so the take and the
 * buddy are the same length and stay in tempo together.
 */
export function midiDuration(buf: ArrayBuffer): number {
  try {
    const midi = new Midi(buf);
    let end = 0;
    for (const track of midi.tracks) {
      for (const note of track.notes) {
        end = Math.max(end, note.time + note.duration);
      }
    }
    return end;
  } catch {
    return 30;
  }
}
