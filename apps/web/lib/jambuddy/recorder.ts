/**
 * Web MIDI capture for Jam Buddy.
 *
 * Listens to a connected MIDI input (a controller the user is playing),
 * records note-on/note-off events with timestamps, and converts them into a
 * Standard MIDI File (.mid) so the take feeds the existing upload pipeline
 * (tempo auto-detect + duration + generation).
 *
 * Browser-only (Web MIDI API). Keep all MIDI access here, call from the page.
 */

import { Midi } from "@tonejs/midi";

export interface RecordedNote {
  /** Absolute time (seconds) from the recording start. */
  time: number;
  midi: number;
  velocity: number;
  /** GM channel the message arrived on (0-15; 9 = percussion). */
  channel: number;
}

export interface MidiRecorder {
  start(): void;
  stop(): { notes: RecordedNote[]; durationSec: number };
  isActive(): boolean;
  /** Detach the MIDI listener (call when leaving the page / no longer needed). */
  dispose(): void;
}

/**
 * Build a Standard MIDI File byte buffer from recorded notes + a detected BPM.
 * Single track, tempo meta at t=0, one note-on/note-off pair per event in
 * PPQ-relative ticks. Reuses @tonejs/midi so we don't hand-roll SMF bytes.
 */
export function recordedNotesToMidi(
  notes: RecordedNote[],
  bpm: number,
): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(60_000_000 / bpm);
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: [4, 4] }];

  // Group by channel: a separate track per GM channel so percussion (9) and
  // pitched notes don't collide.
  const channels = [...new Set(notes.map((n) => n.channel))];
  const byChannel = new Map<number, RecordedNote[]>();
  for (const ch of channels) byChannel.set(ch, []);
  for (const n of notes) byChannel.get(n.channel)!.push(n);

  const ppq = 480;
  for (const [ch, chNotes] of byChannel) {
    const track = midi.addTrack();
    track.channel = ch;
    track.name = `Capture ch${ch}`;
    for (const n of [...chNotes].sort((a, b) => a.time - b.time)) {
      const ticks = Math.max(0, Math.round((n.time / 60) * bpm * ppq));
      const durTicks = Math.max(1, Math.round((0.1 / 60) * bpm * ppq));
      track.addNote({
        midi: n.midi,
        ticks,
        durationTicks: durTicks,
        velocity: Math.max(0.01, Math.min(1, n.velocity / 127)),
      });
    }
  }
  return midi.toArray();
}

/** Build a .mid File (for the take upload slot). */
export function recordedNotesAsFile(
  notes: RecordedNote[],
  bpm: number,
): File {
  const bytes = recordedNotesToMidi(notes, bpm);
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return new File(
    [new Uint8Array(bytes)],
    `jambuddy-live-capture-${ts}.mid`,
    { type: "audio/midi" },
  );
}

/**
 * Create a recorder bound to a MIDI input. Requests MIDI access (user gesture
 * required in some browsers). Returns a started recorder + the chosen input.
 *
 * If `preferredDeviceName` is given, use that input; otherwise the first
 * available. Throws if Web MIDI is unsupported or no input is available.
 */
export async function createMidiRecorder(
  preferredDeviceName?: string,
): Promise<MidiRecorder> {
  if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) {
    throw new Error("Web MIDI is not supported in this browser (try Chrome/Edge).");
  }

  const access = await navigator.requestMIDIAccess();
  const inputs = [...access.inputs.values()];
  if (inputs.length === 0) {
    throw new Error("No MIDI input device found. Connect a controller.");
  }
  const input =
    inputs.find((i) => i.name === preferredDeviceName) ??
    inputs[0] ??
    null;
  if (!input) {
    throw new Error("No MIDI input device found. Connect a controller.");
  }

  let active = false;
  let startTime = 0;
  const notes: RecordedNote[] = [];

  const onMessage = (e: MIDIMessageEvent) => {
    if (!active || !e.data) return;
    const status = e.data[0];
    const midi = e.data[1];
    const vel = e.data[2];
    if (status === undefined || midi === undefined || vel === undefined) return;
    const cmd = status & 0xf0;
    const channel = status & 0x0f;
    if (cmd === 0x90 && vel > 0) {
      notes.push({
        time: (performance.now() - startTime) / 1000,
        midi,
        velocity: vel,
        channel,
      });
    }
  };
  input.addEventListener("midimessage", onMessage);

  return {
    start() {
      startTime = performance.now();
      notes.length = 0;
      active = true;
    },
    stop() {
      active = false;
      return {
        notes: [...notes],
        durationSec:
          notes.length > 0
            ? (performance.now() - startTime) / 1000
            : 0,
      };
    },
    isActive: () => active,
    dispose() {
      active = false;
      input.removeEventListener("midimessage", onMessage);
    },
  };
}

/**
 * Audio capture via getUserMedia + MediaRecorder (mic / audio interface).
 *
 * Returns a recorder with start/stop; stop() yields the captured audio as a
 * File (.webm) so it can feed the same take pipeline (tempo detect + duration
 * + audio-to-audio generation) as an uploaded audio take.
 *
 * Browser-only. Requires a mic permission grant (user gesture).
 */
export interface AudioRecorder {
  start(): void;
  stop(): Promise<{ file: File; durationSec: number }>;
  isActive(): boolean;
  dispose(): void;
}

/** A selectable audio input device. */
export interface AudioInput {
  deviceId: string;
  label: string;
  /** True when this is the system default input. */
  isDefault: boolean;
}

/**
 * List available audio input devices (mics / interfaces). Returns the actual
 * deviceId + label for each `audioinput`. Labels are only populated once mic
 * permission has been granted; before that, devices appear as "Mic …" without
 * a usable label, so call this after a getUserMedia() grant.
 */
export async function listAudioInputs(): Promise<AudioInput[]> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter((d) => d.kind === "audioinput");
  const defaultId =
    devices.find((d) => d.kind === "audioinput" && d.deviceId === "default")
      ?.deviceId ?? null;
  return audioInputs.map((d) => ({
    deviceId: d.deviceId,
    label: d.label || "Default microphone",
    isDefault: defaultId !== null && d.deviceId === defaultId,
  }));
}

/**
 * Create an audio recorder. Requests microphone access (user gesture). Throws
 * if getUserMedia/MediaRecorder is unsupported or the mic is denied.
 *
 * `preferredDeviceId` pins the device to record from (from listAudioInputs).
 * If it's missing/unplugged we fall back to the system default instead of
 * failing — a hot-plugged/unplugged device should never brick recording.
 */
export async function createAudioRecorder(
  preferredDeviceId?: string,
): Promise<AudioRecorder> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    throw new Error(
      "Audio recording is not supported in this browser (need mic + MediaRecorder).",
    );
  }

  // Request the preferred device if given; fall back to default on failure.
  const constraints: MediaStreamConstraints = preferredDeviceId
    ? { audio: { deviceId: { exact: preferredDeviceId } } }
    : { audio: true };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (!preferredDeviceId) throw err;
    // The pinned device is gone — retry with the default mic.
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  const rec = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  let startTime = 0;
  let active = false;

  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  return {
    start() {
      startTime = performance.now();
      chunks.length = 0;
      active = true;
      rec.start();
    },
    stop() {
      return new Promise((resolve) => {
        const onStop = () => {
          active = false;
          stream.getTracks().forEach((t) => t.stop());
          const type = rec.mimeType || "audio/webm";
          const file = new File(
            chunks,
            `jambuddy-live-audio-${new Date()
              .toISOString()
              .replace(/[-:]/g, "")
              .replace(/\.\d+Z$/, "Z")}.webm`,
            { type },
          );
          resolve({
            file,
            durationSec: (performance.now() - startTime) / 1000,
          });
        };
        rec.addEventListener("stop", onStop, { once: true });
        rec.stop();
      });
    },
    isActive: () => active,
    dispose() {
      active = false;
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
