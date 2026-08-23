"use client";

import { useRef, useState } from "react";
import {
  buildPrompt,
  GENRE_LABELS,
  GENRES,
  INPUT_INSTRUMENTS,
  INPUT_INSTRUMENT_LABELS,
  INSTRUMENTS,
  INSTRUMENT_LABELS,
  MOOD_LABELS,
  MOODS,
  type BuddyGenre,
  type BuddyInstrument,
  type BuddyMood,
  type InputInstrument,
} from "@/lib/jambuddy/prompt";
import { parseMidi, isPercussion, midiDuration, playTogether, playAudioTogether, playMidi } from "@/lib/jambuddy/player";
import {
  createMidiRecorder,
  createAudioRecorder,
  listAudioInputs,
  listMidiInputs,
  grantMicPermission,
  recordedNotesAsFile,
  type MidiRecorder,
  type AudioRecorder,
  type AudioInput,
  type MidiInput,
} from "@/lib/jambuddy/recorder";
import { Visualizer } from "@/lib/jambuddy/visualizer";

/**
 * Jam Buddy — "you start playing, it joins in."
 *
 * A hardware-sampler-styled panel. The user sets the instrument (a knob), the
 * style, and the tempo, optionally loads a MIDI take from a controller, then
 * hits "JOIN IN" — the buddy responds at their tempo. The response plays back
 * in the rack.
 *
 * Accessibility preserved: every knob is a labelled <input type=range> (keyboard
 * operable + screenreader-readable), buttons have accessible names, and the
 * status is announced via aria-live. Focus outline is the global :focus-visible.
 */

/* A rotary-style knob. Under the hood a labelled <input type=range> so it works
 * with a keyboard and a screen reader, wrapped in a dark hardware look. */
function Knob({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v: number) => String(v),
  disabled = false,
  editable = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
  /** Render the readout as a typeable number input (e.g. exact tempo). */
  editable?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  // --knob-rot is an actual angle (degrees), NOT a percentage. CSS can't do
  // calc(<percentage> * <angle>) — passing the degrees directly keeps the
  // needle + arc in sync with the value.
  const rot = `${pct * 3}deg`;

  // For editable knobs (e.g. tempo), hold a local draft while typing so we
  // don't clamp mid-keystroke. Type "158": "1" → draft "1", "15" → draft
  // "15", "158" → commit on blur/Enter (clamped to [min,max]).
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    const clamped = Number.isFinite(n)
      ? Math.min(max, Math.max(min, n))
      : value;
    setDraft(null);
    if (clamped !== value) onChange(clamped);
  };
  const syncDraft = () => setDraft(String(value));

  return (
    <label className={`flex flex-col items-center gap-1 ${disabled ? "opacity-40" : ""}`}>
      <span className="text-[10px] uppercase tracking-widest text-[#7f8c9b]">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="jambuddy-knob"
        style={{ ["--knob-rot" as string]: rot }}
      />
      {editable ? (
        <input
          type="number"
          min={min}
          max={max}
          step={step ?? 1}
          // Controlled by the draft while editing; otherwise the prop value.
          value={draft === null ? value : draft}
          aria-label={`${label} value`}
          disabled={disabled}
          onFocus={syncDraft}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onChange={(e) => setDraft(e.target.value)}
          className="w-16 rounded border border-[#2a2d3d] bg-[#12131b] px-1 text-center font-mono text-sm font-bold text-[#e8e8f0]"
        />
      ) : (
        <span className="font-mono text-sm font-bold text-[#e8e8f0]">
          {disabled ? "from take" : format(value)}
        </span>
      )}
    </label>
  );
}

/* A trigger pad that selects an option and flashes as a visual affordance. */
function Pad({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`jambuddy-pad ${selected ? "jambuddy-pad--on" : ""}`}
    >
      {label}
    </button>
  );
}

/** Bundled demo MIDI takes, shown as clickable examples (Gradio-style). */
const DEMO_MIDIS = [
  { name: "sacrifice-drums", label: "Sacrifice (drums)" },
  { name: "demo-bass-line", label: "Demo bass line" },
  { name: "demo-lead-riff", label: "Demo lead riff" },
];

export default function HomePage() {
  const [instrument, setInstrument] = useState<BuddyInstrument>("bass");
  const [inputInstrument, setInputInstrument] = useState<InputInstrument>("other");
  const [genre, setGenre] = useState<BuddyGenre>("metal");
  const [mood, setMood] = useState<BuddyMood>("energetic");
  const [bpm, setBpm] = useState(184);
  const [midiFile, setMidiFile] = useState<File | null>(null);
  const [midiBytes, setMidiBytes] = useState<ArrayBuffer | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  // Object URL of the uploaded audio take (for playback + waveform).
  const [takeAudioUrl, setTakeAudioUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Ready.");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingTogether, setIsPlayingTogether] = useState(false);
  const [usedBpm, setUsedBpm] = useState<number | null>(null);
  const [usedSeconds, setUsedSeconds] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Generation backend. API (Stable Audio 3.0 Large) is default when the key is
  // present — fast + better isolation, 26 credits/gen. Local = CPU small model,
  // free, supports the negative prompt, slower.
  const [mode, setMode] = useState<"api" | "local">("api");
  // Live capture. recRef holds the active recorder (MIDI or audio); recording
  // is a state so the big RED button reflects it. recordSource lets the user
  // pick what to record (MIDI from a controller, or audio from the mic/interface).
  const recRef = useRef<MidiRecorder | AudioRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSource, setRecordSource] = useState<"midi" | "audio">("midi");
  // Audio input devices for the source dropdown (populated once mic is allowed).
  const [audioInputs, setAudioInputs] = useState<AudioInput[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState<string | null>(null);
  // MIDI input devices + optional channel filter for the source dropdown.
  const [midiInputs, setMidiInputs] = useState<MidiInput[]>([]);
  const [midiDeviceId, setMidiDeviceId] = useState<string | null>(null);
  const [midiChannel, setMidiChannel] = useState<number | null>(null);
  // Object URL of the last recorded MIDI take (for save + piano-roll).
  const [recordedMidiUrl, setRecordedMidiUrl] = useState<string | null>(null);

  const { prompt, negativePrompt } = buildPrompt({
    instrument,
    inputInstrument,
    genre,
    mood,
    bpm,
  });

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
    return file.arrayBuffer();
  }

  /** Detect whether a take file is MIDI or audio from its name/MIME type. */
  function isMidiFile(f: File): boolean {
    return (
      /\.mid$/i.test(f.name) ||
      /\.midi$/i.test(f.name) ||
      f.type === "audio/midi" ||
      f.type === "audio/x-midi"
    );
  }

  /** Play a bundled demo MIDI solo through the synth (no buddy). */
  async function playDemo(name: string) {
    try {
      const res = await fetch(`/demos/${name}.mid`);
      if (!res.ok) throw new Error(`fetch ${name}.mid -> ${res.status}`);
      const bytes = await res.arrayBuffer();
      await playMidi(bytes);
    } catch (e) {
      setStatus(`Couldn't play demo: ${String(e)}`);
    }
  }

  /** Load a bundled demo MIDI (served from /demos) as a take. */
  async function loadDemo(name: string) {
    setStatus(`Loading demo "${name}"…`);
    try {
      const res = await fetch(`/demos/${name}.mid`);
      if (!res.ok) throw new Error(`fetch ${name}.mid -> ${res.status}`);
      const bytes = await res.arrayBuffer();
      // A File with the right name/type flows through the exact same path as
      // an upload (isMidiFile → tempo detect → duration).
      const file = new File([bytes], `${name}.mid`, { type: "audio/midi" });
      await handleTakeFile(file);
      setStatus(`Loaded demo "${name}".`);
    } catch (e) {
      setStatus(`Couldn't load demo: ${String(e)}`);
    }
  }

  /** Handle a single uploaded take (MIDI or audio), auto-detecting the type. */
  async function handleTakeFile(f: File | null) {
    // One upload slot for either kind; picking a new file clears the old take.
    setMidiFile(null);
    setMidiBytes(null);
    setAudioFile(null);
    if (takeAudioUrl) URL.revokeObjectURL(takeAudioUrl);
    setTakeAudioUrl(null);
    if (!f) {
      setStatus("Ready.");
      return;
    }
    if (isMidiFile(f)) {
      setMidiFile(f);
      const bytes = await fileToArrayBuffer(f);
      setMidiBytes(bytes);
      // Soft-default: if the MIDI has GM channel 9 notes, pre-select the
      // "Drums" input-instrument pad. parseMidi throws on corrupt bytes; fall
      // back to "other".
      try {
        setInputInstrument(parseMidi(bytes).some(isPercussion) ? "drums" : "other");
      } catch {
        setInputInstrument("other");
      }
      // Pre-fill the tempo knob from the take's tempo map (Option A: detect
      // first, knob stays authoritative + editable).
      await prefillTempo(f, "midi");
      setStatus(
        `Loaded ${f.name}. Tempo auto-detected (${bpm} BPM); adjust the knob if needed.`,
      );
    } else {
      setAudioFile(f);
      setTakeAudioUrl(URL.createObjectURL(f));
      // Audio is heard by the buddy (audio-to-audio). Clear the MIDI-driven
      // input-instrument default so the user's declaration reflects the audio.
      setInputInstrument("other");
      await prefillTempo(f, "audio");
      setStatus(
        `Loaded ${f.name}. Tempo auto-detected (${bpm} BPM); adjust the knob if needed.`,
      );
    }
  }

  /** Ask the server to detect BPM+duration and pre-fill the tempo knob. */
  async function prefillTempo(f: File, kind: "midi" | "audio") {
    try {
      const base64 = await fileToBase64(f);
      const res = await fetch("/api/jambuddy/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "midi" ? { midi: base64 } : { audio: base64, genre },
        ),
      });
      if (res.ok) {
        const data = (await res.json()) as { bpm?: number; duration?: number };
        if (typeof data.bpm === "number" && data.bpm > 0) {
          setBpm(Math.round(Math.max(40, Math.min(240, data.bpm))));
        }
        return data;
      }
    } catch {
      /* detection is best-effort; knob keeps its current value */
    }
    return null;
  }

  /** Toggle live capture (MIDI from a controller, or audio from the mic).
   * On stop, the take is written to a .mid/.webm File and fed through the
   * normal take pipeline (tempo detect + duration + input). */
  async function toggleRecord() {
    if (recording) {
      // Stop: convert the capture to a take File and treat it as a take.
      const rec = recRef.current;
      if (rec) {
        if (recordSource === "midi") {
          const midiRec = rec as MidiRecorder;
          const { notes, durationSec } = midiRec.stop();
          rec.dispose();
          recRef.current = null;
          setRecording(false);
          if (notes.length === 0) {
            setStatus("Recording stopped — no notes captured.");
            return;
          }
          // Use the current knob BPM (or 120) for the tempo map of the .mid.
          const file = recordedNotesAsFile(notes, bpm || 120);
          // Keep an object URL so the user can save the .mid and see its roll.
          if (recordedMidiUrl) URL.revokeObjectURL(recordedMidiUrl);
          setRecordedMidiUrl(URL.createObjectURL(file));
          setStatus(
            `Captured ${notes.length} notes (${durationSec.toFixed(1)}s). Detecting tempo…`,
          );
          await handleTakeFile(file);
        } else {
          const audioRec = rec as AudioRecorder;
          const { file, durationSec } = await audioRec.stop();
          rec.dispose();
          recRef.current = null;
          setRecording(false);
          setStatus(
            `Captured ${durationSec.toFixed(1)}s of audio. Detecting tempo…`,
          );
          await handleTakeFile(file);
        }
      } else {
        setRecording(false);
      }
      return;
    }
    // Start: create the recorder + begin listening.
    if (recordSource === "midi") {
      setStatus("Connecting to MIDI controller…");
      try {
        // Populate the MIDI device list on first record (port enumeration).
        if (midiInputs.length === 0) {
          const devices = await listMidiInputs();
          setMidiInputs(devices);
          if (!midiDeviceId) {
            setMidiDeviceId(devices[0]?.id ?? null);
          }
        }
        const rec = await createMidiRecorder(
          midiDeviceId ?? undefined,
          midiChannel ?? undefined,
        );
        recRef.current = rec;
        rec.start();
        setRecording(true);
        setStatus("● RECORDING — play your take, then press stop.");
      } catch (e) {
        setStatus(`MIDI record unavailable: ${String(e)}`);
      }
    } else {
      setStatus("Requesting microphone access…");
      try {
        // Grant permission FIRST (a user gesture) so enumerateDevices returns
        // real labels + all devices. On first click the list is empty; after
        // the grant we populate it before starting to record.
        if (audioInputs.length === 0) {
          const permStream = await grantMicPermission();
          permStream.getTracks().forEach((t) => t.stop());
          const devices = await listAudioInputs();
          setAudioInputs(devices);
          if (!audioDeviceId) {
            const defaultDev = devices.find((d) => d.isDefault);
            setAudioDeviceId(defaultDev?.deviceId ?? devices[0]?.deviceId ?? null);
          }
        }
        const rec = await createAudioRecorder(audioDeviceId ?? undefined);
        recRef.current = rec;
        rec.start();
        setRecording(true);
        setStatus("● RECORDING — play your take, then press stop.");
      } catch (e) {
        setStatus(`Audio record unavailable: ${String(e)}`);
      }
    }
  }

  /** Download the last recorded MIDI take as a .mid file. */
  function saveRecordedMidi() {
    if (!recordedMidiUrl) {
      setStatus("Record a take first, then save it.");
      return;
    }
    const a = document.createElement("a");
    a.href = recordedMidiUrl;
    a.download = `jambuddy-live-capture-${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")}.mid`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus("Saved your recorded MIDI take.");
  }

  /** Download the generated buddy response (audio) as a file. */
  function saveGeneratedAudio() {
    if (!audioUrl) {
      setStatus("Generate a response first, then save it.");
      return;
    }
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `jambuddy-response-${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")}.${mode === "api" ? "mp3" : "wav"}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus("Saved the buddy's response.");
  }

  /** Play the take and the buddy response together (audio mix, or MIDI synth).
   * Toggle: pressing again stops playback.
   *
   * Re-entry guard: isPlayingTogether is React state (async), so a fast second
   * click can read a stale `false` and start a SECOND simultaneous layer. Keep
   * a synchronous ref so the toggle is atomic. */
  const playbackRef = useRef<{ stop: () => void } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  async function playBoth() {
    if (playbackRef.current) {
      // Stop: kill current playback (synchronous — immune to stale state).
      playbackRef.current.stop();
      playbackRef.current = null;
      setIsPlayingTogether(false);
      setStatus("Stopped.");
      return;
    }
    if (!audioUrl) {
      setStatus("Generate a response first.");
      return;
    }
    // Pause the standalone audio element so the response isn't heard twice.
    audioRef.current?.pause();
    playbackRef.current = { stop: () => {} }; // claim the toggle synchronously
    setIsPlayingTogether(true);
    setStatus("Playing your take + the buddy together…");
    try {
      let handle: { stop: () => void; done: Promise<void> };
      if (midiBytes) {
        // MIDI take: render with the built-in synth, layered with the buddy.
        handle = await playTogether(midiBytes, audioUrl);
      } else if (takeAudioUrl) {
        // Audio take: mix the two audio files on the same clock.
        handle = await playAudioTogether(takeAudioUrl, audioUrl);
      } else {
        playbackRef.current = null;
        setIsPlayingTogether(false);
        setStatus("Load a take first to play it with the response.");
        return;
      }
      playbackRef.current = handle;
      await handle.done;
      if (playbackRef.current === handle) {
        playbackRef.current = null;
        setIsPlayingTogether(false);
        setStatus("Done — both played together.");
      }
    } catch (e) {
      playbackRef.current = null;
      setIsPlayingTogether(false);
      setStatus(`Playback error: ${String(e)}`);
    }
  }

  async function joinIn() {
    setBusy(true);
    setStatus(
      mode === "api"
        ? "Producing… (Stable Audio API, ~20s)."
        : "Producing… this can take a minute on CPU.",
    );
    setAudioUrl(null);
    setUsedBpm(null);
    setUsedSeconds(null);
    try {
      const payload: {
        knobs: {
          instrument: BuddyInstrument;
          inputInstrument: InputInstrument;
          genre: BuddyGenre;
          mood: BuddyMood;
          bpm: number;
        };
        bpm?: number;
        midi?: string;
        audio?: string;
        /** Real extension of the audio take (e.g. aif, wav, mp3) so the server
         * names the temp file correctly. */
        audioExt?: string;
        duration?: number;
        mode: "api" | "local";
      } = { knobs: { instrument, inputInstrument, genre, mood, bpm }, mode };

      if (midiFile) {
        setStatus("Reading your MIDI take…");
        const base64 = await fileToBase64(midiFile);
        payload.midi = base64;
        // Detect tempo from the take, and match its length so the response
        // starts and ends together with it (in tempo).
        delete payload.bpm;
        if (midiBytes) payload.duration = Math.max(1, midiDuration(midiBytes));
      } else if (audioFile) {
        setStatus("Reading your audio take…");
        const base64 = await fileToBase64(audioFile);
        payload.audio = base64;
        // Pass the real audio extension so the server names the temp file
        // correctly (soundfile won't read a .wav-named AIFF/WEBM).
        const extMatch = audioFile.name.match(/\.(aiff?|wav|mp3|flac|ogg|m4a|webm)$/i);
        const ext = extMatch?.[1] ?? "wav";
        payload.audioExt = ext.toLowerCase();
        // Audio-to-audio: the buddy responds to the groove.
        delete payload.bpm;
      }

      const res = await fetch("/api/jambuddy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setStatus(`Production failed: ${err?.detail ?? err?.error ?? res.status}`);
        return;
      }
      // The route returns the tempo it locked onto + the wall-clock generate time.
      const headerBpm = res.headers.get("X-Jam-Buddy-BPM");
      if (headerBpm) setUsedBpm(Math.round(Number(headerBpm)));
      const headerTime = res.headers.get("X-Jam-Buddy-Time");
      if (headerTime) setUsedSeconds(Number(headerTime) / 1000);
      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
      setStatus("Done — your buddy produced a response.");
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      id="main-content"
      className="mx-auto max-w-3xl px-4 py-8"
      aria-labelledby="page-title"
    >
      <div className="jambuddy-rack rounded-2xl p-6 shadow-2xl">
        <header className="mb-6 flex items-center justify-between border-b border-[#2a2d3d] pb-3">
          <h1
            id="page-title"
            className="font-mono text-2xl font-bold tracking-tight text-[#e8e8f0]"
          >
            JAM <span className="text-[#f4a261]">BUDDY</span>
          </h1>
          <span className="rounded bg-[#2a2d3d] px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-[#7f829c]">
            rack • v0.1
          </span>
        </header>

        {/* Knob row — all 4 knobs on one row */}
        <section
          aria-label="Style controls"
          className="mb-6 grid grid-cols-4 gap-4 rounded-xl bg-[#15161f] p-4"
        >
          <Knob
            label="Instrument"
            value={INSTRUMENTS.indexOf(instrument)}
            min={0}
            max={INSTRUMENTS.length - 1}
            onChange={(v) => setInstrument(INSTRUMENTS[v] ?? "guitar")}
            format={(v) => INSTRUMENT_LABELS[INSTRUMENTS[v] ?? "guitar"] ?? ""}
          />
          <Knob
            label="Genre"
            value={GENRES.indexOf(genre)}
            min={0}
            max={GENRES.length - 1}
            onChange={(v) => setGenre(GENRES[v] ?? "metal")}
            format={(v) => GENRE_LABELS[GENRES[v] ?? "metal"] ?? ""}
          />
          <Knob
            label="Mood"
            value={MOODS.indexOf(mood)}
            min={0}
            max={MOODS.length - 1}
            onChange={(v) => setMood(MOODS[v] ?? "energetic")}
            format={(v) => MOOD_LABELS[MOODS[v] ?? "energetic"] ?? ""}
          />
          <Knob
            label="Tempo"
            value={bpm}
            min={60}
            max={220}
            step={1}
            onChange={setBpm}
            format={(v) => `${v} BPM`}
            editable
          />
        </section>

        {/* Prompt — mirrors the knobs, shown right below them */}
        <div className="mb-6 rounded bg-[#15161f] px-4 py-2 font-mono text-xs text-[#7f829c]">
          <div className="uppercase tracking-widest">Prompt</div>
          <div className="mt-1 truncate text-[#e8e8f0]">{prompt}</div>
          <div className="mt-1 opacity-60">neg: {negativePrompt}</div>
        </div>

        {/* Your-take-is knob — declares what instrument the user is playing
            so the buddy can complement it (no MIR on input). */}
        <section
          aria-label="Your take"
          className="mb-6 rounded bg-[#1f2130] p-4"
        >
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#7f829c]">
            Your take is
          </h2>
          <p className="mb-2 text-[11px] text-[#7f829c]">
            For MIDI we can&apos;t read the notes, so tell us what you&apos;re
            playing — it helps the buddy complement (not duplicate) it. Audio is
            heard directly (audio-to-audio).
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {INPUT_INSTRUMENTS.map((i) => (
              <Pad
                key={i}
                label={INPUT_INSTRUMENT_LABELS[i]}
                selected={inputInstrument === i}
                onSelect={() => setInputInstrument(i)}
              />
            ))}
          </div>
        </section>

        {/* Take input — MIDI or audio */}
        <section
          aria-labelledby="take-label"
          className="mb-6 rounded bg-[#1f2130] p-4"
        >
          <h2
            id="take-label"
            className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#7f829c]"
          >
            Your take (optional)
          </h2>
          <p className="mb-2 text-[11px] text-[#7f829c]">
            MIDI sets tempo + length; audio makes the buddy respond to your groove.
            Drop either in the slot below.
          </p>
          <label className="flex flex-col gap-1">
            <input
              type="file"
              accept=".mid,.midi,.wav,.mp3,.aiff,.flac,audio/midi,audio/x-midi,audio/*"
              aria-label="Upload your take — MIDI or audio"
              onChange={(e) => handleTakeFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded border border-[#2a2d3d] bg-[#12131b] px-3 py-2 text-sm text-[#c9c9d6] file:mr-3 file:rounded file:border-0 file:bg-[#f4a261] file:px-3 file:py-1 file:font-bold file:text-[#12131b]"
            />
          </label>
          {midiFile && (
            <p className="mt-2 text-xs text-[#7f829c]">
              {midiFile.name} — MIDI: tempo + length detected from it.
            </p>
          )}
          {audioFile && (
            <p className="mt-2 text-xs text-[#7f829c]">
              {audioFile.name} — audio: buddy responds to its groove (audio-to-audio).
            </p>
          )}
          {/* Gradio-style demo examples: click the name to load as a take, or
              hit the ▶ to preview it solo through the synth. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#7f829c]">
              Demos
            </span>
            {DEMO_MIDIS.map((d) => (
              <div
                key={d.name}
                className="flex items-center gap-1 rounded-full border border-[#2a2d3d] bg-[#1a1c28] py-1 pl-3 pr-1 text-xs"
              >
                <button
                  type="button"
                  onClick={() => loadDemo(d.name)}
                  disabled={busy}
                  className="text-[#e8e8f0] hover:text-[#5fd38a]"
                >
                  {d.label}
                </button>
                <button
                  type="button"
                  onClick={() => playDemo(d.name)}
                  disabled={busy}
                  aria-label={`Play demo ${d.label}`}
                  title="Preview"
                  className="grid h-5 w-5 place-items-center rounded-full border border-[#2a2d3d] text-[10px] text-[#5fd38a] hover:bg-[#5fd38a] hover:text-[#12131b]"
                >
                  ▶
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Transport */}
        <div className="mb-3 flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#7f829c]">
            Engine
          </span>
          <label className="engine-toggle">
            <input
              type="checkbox"
              checked={mode === "api"}
              onChange={(e) => setMode(e.target.checked ? "api" : "local")}
            />
            <span className="engine-toggle__switch">
              <span className="engine-toggle__label engine-toggle__label--api">API</span>
              <span className="engine-toggle__lever" aria-hidden="true" />
              <span className="engine-toggle__label engine-toggle__label--local">Local</span>
            </span>
          </label>
          <span className="font-mono text-[10px] text-[#7f829c]">
            {mode === "api"
              ? "Stable Audio 3.0 Large · 26 credits/gen · ~20s"
              : "Local CPU · free · supports negative prompt · slower"}
          </span>
        </div>
        {/* Record source — MIDI controller or mic/interface */}
        <div className="mb-3 flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#7f829c]">
            Record
          </span>
          <label className="engine-toggle">
            <input
              type="checkbox"
              checked={recordSource === "audio"}
              onChange={(e) =>
                setRecordSource(e.target.checked ? "audio" : "midi")
              }
            />
            <span className="engine-toggle__switch">
              <span className="engine-toggle__label engine-toggle__label--local">
                MIDI
              </span>
              <span className="engine-toggle__lever" aria-hidden="true" />
              <span className="engine-toggle__label engine-toggle__label--api">
                Audio
              </span>
            </span>
          </label>
          <span className="font-mono text-[10px] text-[#7f829c]">
            {recordSource === "midi"
              ? "MIDI controller"
              : "Mic / audio interface"}
          </span>
          {recordSource === "audio" && audioInputs.length > 0 && (
            <label className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#7f829c]">
                Input
              </span>
              <select
                value={audioDeviceId ?? ""}
                onChange={(e) => setAudioDeviceId(e.target.value || null)}
                aria-label="Audio input device"
                className="rounded border border-[#2a2d3d] bg-[#12131b] px-2 py-1 text-xs text-[#e8e8f0]"
              >
                {audioInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {recordSource === "midi" && midiInputs.length > 0 && (
            <>
              <label className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#7f829c]">
                  Device
                </span>
                <select
                  value={midiDeviceId ?? ""}
                  onChange={(e) => setMidiDeviceId(e.target.value || null)}
                  aria-label="MIDI input device"
                  className="rounded border border-[#2a2d3d] bg-[#12131b] px-2 py-1 text-xs text-[#e8e8f0]"
                >
                  {midiInputs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#7f829c]">
                  Channel
                </span>
                <select
                  value={midiChannel === null ? "" : String(midiChannel)}
                  onChange={(e) =>
                    setMidiChannel(
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                  aria-label="MIDI channel"
                  className="rounded border border-[#2a2d3d] bg-[#12131b] px-2 py-1 text-xs text-[#e8e8f0]"
                >
                  <option value="">All</option>
                  {Array.from({ length: 16 }, (_, i) => (
                    <option key={i} value={String(i)}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        {/* Transport — sampler/sequencer pads */}
        <div className="mb-2 grid grid-cols-3 gap-4">
          <button
            type="button"
            onClick={toggleRecord}
            disabled={busy}
            aria-pressed={recording}
            aria-label={
              recording
                ? "Stop recording"
                : recordSource === "midi"
                  ? "Record from MIDI controller"
                  : "Record from microphone"
            }
            className="jambuddy-padbig flex-1"
            style={{ ["--pad-c" as string]: "#e05252" }}
          >
            <span className="jambuddy-padbig__label">
              {recording ? "■ STOP" : "● RECORD"}
            </span>
          </button>
          <button
            type="button"
            onClick={joinIn}
            disabled={busy}
            className="jambuddy-padbig flex-1"
            style={{ ["--pad-c" as string]: "#f4a261" }}
          >
            <span className="jambuddy-padbig__label">
              {busy ? "PRODUCING…" : "JOIN IN"}
            </span>
          </button>
          <button
            type="button"
            onClick={playBoth}
            disabled={!audioUrl}
            aria-pressed={isPlayingTogether}
            className="jambuddy-padbig flex-1"
            style={{ ["--pad-c" as string]: "#5fd38a" }}
          >
            <span className="jambuddy-padbig__label">
              {isPlayingTogether ? "■ STOP" : "PLAY TOGETHER"}
            </span>
          </button>
        </div>

        {/* Status + playback */}
        <section
          aria-live="polite"
          aria-label="Status"
          className="rounded bg-[#12131b] p-4"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-[#7f829c]">STATUS</span>
            <span
              className={`h-2 w-2 rounded-full ${
                busy ? "bg-[#f4a261]" : audioUrl ? "bg-[#5fd38a]" : "bg-[#4a4d5e]"
              }`}
            />
          </div>
          <p className="mt-1 text-sm text-[#e8e8f0]">{status}</p>
          {usedBpm !== null && (
            <p className="mt-2 font-mono text-sm font-bold text-[#f4a261]">
              Buddy tempo: {usedBpm} BPM
            </p>
          )}
          {usedSeconds !== null && (
            <p className="mt-1 font-mono text-xs text-[#7f829c]">
              Generated in {usedSeconds.toFixed(1)}s
            </p>
          )}
          {audioUrl && (
            <audio
              ref={audioRef}
              controls
              src={audioUrl}
              className="mt-3 w-full"
            >
              Your browser does not support audio playback.
            </audio>
          )}
        </section>

        {/* Take + response visualizers — stacked vertically, DAW-style.
            Each waveform has its own SAVE button beside it. */}
        {(midiBytes || takeAudioUrl || audioUrl) && (
          <section
            aria-label="Take and response"
            className="mt-4 flex flex-col gap-4"
          >
            {midiBytes ? (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Visualizer
                    midiBytes={midiBytes}
                    label="Your take (MIDI piano-roll)"
                  />
                </div>
                <button
                  type="button"
                  onClick={saveRecordedMidi}
                  disabled={!recordedMidiUrl}
                  className="jambuddy-save"
                  title="Download this MIDI take"
                  aria-label="Download this MIDI take"
                >
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
                    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3v12" />
                    <path d="M6 11l6 6 6-6" />
                    <path d="M4 20h16" />
                  </svg>
                </button>
              </div>
            ) : takeAudioUrl ? (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Visualizer
                    audioUrl={takeAudioUrl}
                    label="Your take (audio waveform)"
                  />
                </div>
              </div>
            ) : null}
            {audioUrl && (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Visualizer
                    audioUrl={audioUrl}
                    label="Buddy response (waveform)"
                  />
                </div>
                <button
                  type="button"
                  onClick={saveGeneratedAudio}
                  disabled={!audioUrl}
                  className="jambuddy-save"
                  title="Download this response"
                  aria-label="Download this response"
                >
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
                    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3v12" />
                    <path d="M6 11l6 6 6-6" />
                    <path d="M4 20h16" />
                  </svg>
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
