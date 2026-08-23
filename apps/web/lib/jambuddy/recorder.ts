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

/** A MIDI input port (device) the user can select. */
export interface MidiInput {
  id: string;
  name: string;
}

/** List connected MIDI input devices (ports). */
export async function listMidiInputs(): Promise<MidiInput[]> {
  if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) {
    return [];
  }
  const access = await navigator.requestMIDIAccess();
  return [...access.inputs.values()].map((i) => ({
    id: i.id,
    name: i.name || "MIDI controller",
  }));
}

/**
 * Create a recorder bound to a MIDI input. Requests MIDI access (user gesture
 * required in some browsers). Returns a started recorder + the chosen input.
 *
 * `preferredDeviceId` selects the input port (from listMidiInputs). `channel`
 * (0-15) filters to a single GM channel; `undefined` records all channels.
 * Falls back to the first available input if the preferred device is gone.
 */
export async function createMidiRecorder(
  preferredDeviceId?: string,
  channel?: number,
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
    inputs.find((i) => i.id === preferredDeviceId) ??
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
    const msgChannel = status & 0x0f;
    // If a channel filter is set, ignore messages on other channels.
    if (channel !== undefined && msgChannel !== channel) return;
    if (cmd === 0x90 && vel > 0) {
      notes.push({
        time: (performance.now() - startTime) / 1000,
        midi,
        velocity: vel,
        channel: msgChannel,
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
 * List available audio input devices (mics / interfaces). Must be called AFTER
 * mic permission is granted (getUserMedia), otherwise labels are blank and the
 * list is incomplete. The browser exposes a `default` pseudo-device alongside
 * the real devices — we keep it as its own entry (labelled "Default"), but the
 * real per-device entries are what the user picks from.
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
  return audioInputs.map((d) => ({
    deviceId: d.deviceId,
    label: d.label || (d.deviceId === "default" ? "Default microphone" : "Mic"),
    isDefault: d.deviceId === "default",
  }));
}

/**
 * Grant mic permission (a user gesture) and return the live stream. The caller
 * stops the tracks if it only wanted permission (to enumerate devices).
 */
export async function grantMicPermission(): Promise<MediaStream> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error("getUserMedia is not supported in this browser.");
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

/**
 * Decode an audio Blob (any browser-playable format, e.g. WebM/Opus from
 * MediaRecorder) into a 16-bit PCM WAV Blob. The Python pipeline reads the
 * take with `soundfile`, which does NOT understand WebM — it needs a real WAV.
 * Returns null if decode fails (caller can fall back to the raw blob).
 */
export async function blobToWav(blob: Blob): Promise<Blob | null> {
  try {
    const buf = await blob.arrayBuffer();
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    try {
      const audioBuf = await ctx.decodeAudioData(buf);
      const numChannels = audioBuf.numberOfChannels ?? 1;
      const sr = audioBuf.sampleRate ?? 44100;
      const samples = audioBuf.getChannelData(0);
      const numFrames = samples.length;
      const interleaved = new Float32Array(numFrames * numChannels);
      for (let ch = 0; ch < numChannels; ch++) {
        const chan = audioBuf.getChannelData(ch);
        for (let i = 0; i < numFrames; i++) {
          const v = chan[i];
          if (v !== undefined) interleaved[i * numChannels + ch] = v;
        }
      }
      // 16-bit PCM WAV.
      const buffer = new ArrayBuffer(44 + interleaved.length * 2);
      const view = new DataView(buffer);
      const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + interleaved.length * 2, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sr, true);
      view.setUint32(28, sr * numChannels * 2, true);
      view.setUint16(32, numChannels * 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, interleaved.length * 2, true);
      let off = 44;
      for (let i = 0; i < interleaved.length; i++) {
        const raw = interleaved[i] ?? 0;
        const s = Math.max(-1, Math.min(1, raw));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
      return new Blob([buffer], { type: "audio/wav" });
    } finally {
      void ctx.close();
    }
  } catch {
    return null;
  }
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
        const onStop = async () => {
          active = false;
          stream.getTracks().forEach((t) => t.stop());
          const type = rec.mimeType || "audio/webm";
          const raw = new Blob(chunks, { type });
          // Convert WebM -> PCM WAV so the Python pipeline (soundfile) can read
          // it. If decode fails, fall back to the raw blob.
          const wav = await blobToWav(raw);
          const ts = new Date()
            .toISOString()
            .replace(/[-:]/g, "")
            .replace(/\.\d+Z$/, "Z");
          const file = new File(
            [wav ?? raw],
            wav
              ? `jambuddy-live-audio-${ts}.wav`
              : `jambuddy-live-audio-${ts}.webm`,
            { type: wav ? "audio/wav" : type },
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
