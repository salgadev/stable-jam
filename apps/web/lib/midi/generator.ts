/**
 * MIDI file generator.
 *
 * Wraps @tonejs/midi to convert MidiEvent[] into a Uint8Array (.mid file bytes)
 * suitable for download or for the drag-and-drop-into-Reaper flow.
 *
 * Source: docs/03-data-model.md §MIDI generation.
 */

import { Midi } from "@tonejs/midi";
import {
  LIMB_TO_GM,
  type Limb,
  type MidiEvent,
} from "@patterntalk/shared-types";
import { bpmToMicrosecondsPerQuarter } from "../patterns/engine";

export interface MidiMeta {
  patternId: string;
  patternName: string;
  bars: number;
  bpm: number;
}

/**
 * Convert MidiEvent[] to a SMF (Standard MIDI File) byte buffer.
 * One track, channel 10 (the GM drum channel).
 */
export function eventsToMidi(events: MidiEvent[], meta: MidiMeta): Uint8Array {
  const midi = new Midi();

  // Tempo + time signature on the master track header.
  midi.header.setTempo(bpmToMicrosecondsPerQuarter(meta.bpm));
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: [4, 4] }];

  const drums = midi.addTrack();
  drums.name = `${meta.patternName} (Jam Buddy)`;
  drums.channel = 9; // 0-indexed; SMF channel 10 is the GM drum channel.

  for (const ev of events) {
    const midiNote = LIMB_TO_GM[ev.limb];
    drums.addNote({
      midi: midiNote,
      ticks: ev.tick,
      durationTicks: ev.duration,
      velocity: ev.velocity / 127,
    });
  }

  return midi.toArray();
}

/**
 * Build a filename per docs/07-reaper-integration.md §File naming.
 * Example: jambuddy-d-beat-4bars-180bpm-2026-08-22T1430Z.mid
 */
export function midiFilename(meta: MidiMeta, when: Date = new Date()): string {
  const ts = when.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `jambuddy-${meta.patternId}-${meta.bars}bars-${meta.bpm}bpm-${ts}.mid`;
}

/**
 * Trigger a browser download of the MIDI file. Returns the filename used.
 *
 * The caller is responsible for the Reaper drag-and-drop UX (see
 * docs/07-reaper-integration.md §Drag-from-browser directly into Reaper)
 * — this is the simpler click-to-download path, kept as the reliable fallback.
 */
export function downloadMidi(events: MidiEvent[], meta: MidiMeta): string {
  const bytes = eventsToMidi(events, meta);
  // `new Uint8Array(...)` re-wraps as a plain (non-SharedArrayBuffer-backed)
  // ArrayBuffer — required by lib.dom.d.ts in TS 5.7+.
  const blob = new Blob([new Uint8Array(bytes)], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const filename = midiFilename(meta);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoke after a tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return filename;
}

/**
 * Inverse of downloadMidi: build a File object suitable for the HTML5
 * drag-and-drop API (DataTransfer.files). Used for drag-from-browser
 * directly into a Reaper track.
 */
export function midiAsFile(events: MidiEvent[], meta: MidiMeta): File {
  const bytes = eventsToMidi(events, meta);
  return new File(
    [new Uint8Array(bytes)],
    midiFilename(meta),
    { type: "audio/midi" },
  );
}

// Re-export Limb for convenience — keeps consumers from digging into shared-types.
export type { Limb };
