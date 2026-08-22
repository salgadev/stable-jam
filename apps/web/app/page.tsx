"use client";

import { useState } from "react";
import {
  buildPrompt,
  GENRES,
  INSTRUMENTS,
  MOODS,
  type BuddyGenre,
  type BuddyInstrument,
  type BuddyMood,
} from "@/lib/jambuddy/prompt";
import { playTogether, midiDuration } from "@/lib/jambuddy/player";

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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
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
        style={{ ["--knob-pct" as string]: `${pct}%` }}
      />
      <span className="font-mono text-sm font-bold text-[#e8e8f0]">
        {disabled ? "from take" : format(value)}
      </span>
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

export default function HomePage() {
  const [instrument, setInstrument] = useState<BuddyInstrument>("bass");
  const [genre, setGenre] = useState<BuddyGenre>("metal");
  const [mood, setMood] = useState<BuddyMood>("energetic");
  const [bpm, setBpm] = useState(184);
  const [midiFile, setMidiFile] = useState<File | null>(null);
  const [midiBytes, setMidiBytes] = useState<ArrayBuffer | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("Ready.");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [usedBpm, setUsedBpm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPlayingTogether, setIsPlayingTogether] = useState(false);

  const { prompt, negativePrompt } = buildPrompt({
    instrument,
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

  async function handleMidiFile(f: File | null) {
    setMidiFile(f);
    setMidiBytes(null);
    if (!f) {
      setStatus("Ready.");
      return;
    }
    const bytes = await fileToArrayBuffer(f);
    setMidiBytes(bytes);
    setStatus(
      `Loaded ${f.name}. Tempo will be detected from it, and the buddy will match its ${midiDuration(bytes).toFixed(1)}s length.`,
    );
  }

  function handleAudioFile(f: File | null) {
    setAudioFile(f);
    if (!f) {
      setStatus("Ready.");
      return;
    }
    setStatus(
      `Loaded ${f.name}. The buddy will respond to its groove (audio-to-audio).`,
    );
  }

  /** Play the MIDI take and the generated response together, in tempo. */
  async function playBoth() {
    if (!midiBytes || !audioUrl) {
      setStatus("Load a MIDI take and generate a response first.");
      return;
    }
    setIsPlayingTogether(true);
    setStatus("Playing your take + the buddy together…");
    try {
      const { done } = await playTogether(midiBytes, audioUrl);
      await done;
      setStatus("Done — both played together.");
    } catch (e) {
      setStatus(`Playback error: ${String(e)}`);
    } finally {
      setIsPlayingTogether(false);
    }
  }

  async function joinIn() {
    setBusy(true);
    setStatus("Producing… this can take a minute on CPU.");
    setAudioUrl(null);
    setUsedBpm(null);
    try {
      const payload: {
        knobs: {
          instrument: BuddyInstrument;
          genre: BuddyGenre;
          mood: BuddyMood;
          bpm: number;
        };
        bpm?: number;
        midi?: string;
        audio?: string;
        duration?: number;
      } = { knobs: { instrument, genre, mood, bpm } };

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
      // The route returns the tempo it locked onto in the X-Jam-Buddy-BPM header.
      const headerBpm = res.headers.get("X-Jam-Buddy-BPM");
      if (headerBpm) setUsedBpm(Math.round(Number(headerBpm)));
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

        {/* Instrument / trigger pads */}
        <section aria-labelledby="pads-label" className="mb-6">
          <h2
            id="pads-label"
            className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#7f829c]"
          >
            Instrument
          </h2>
          <div className="grid grid-cols-5 gap-2">
            {INSTRUMENTS.map((inst) => (
              <Pad
                key={inst}
                label={inst}
                selected={instrument === inst}
                onSelect={() => setInstrument(inst)}
              />
            ))}
          </div>
        </section>

        {/* Knob row */}
        <section
          aria-label="Style controls"
          className="mb-6 grid grid-cols-3 gap-4 rounded-xl bg-[#15161f] p-4"
        >
          <Knob
            label="Genre"
            value={GENRES.indexOf(genre)}
            min={0}
            max={GENRES.length - 1}
            onChange={(v) => setGenre(GENRES[v] ?? "metal")}
            format={(v) => GENRES[v] ?? ""}
          />
          <Knob
            label="Mood"
            value={MOODS.indexOf(mood)}
            min={0}
            max={MOODS.length - 1}
            onChange={(v) => setMood(MOODS[v] ?? "energetic")}
            format={(v) => MOODS[v] ?? ""}
          />
          <Knob
            label="Tempo"
            value={bpm}
            min={60}
            max={220}
            step={1}
            onChange={setBpm}
            format={(v) => `${v} BPM`}
            disabled={midiFile !== null || audioFile !== null}
          />
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
            MIDI sets the tempo; audio makes the buddy respond to your groove.
          </p>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#7f829c]">
                MIDI take (controller) — buddy matches its tempo + length
              </span>
              <input
                type="file"
                accept=".mid,.midi,audio/midi,audio/x-midi"
                aria-label="Upload a MIDI take from a controller"
                onChange={(e) => handleMidiFile(e.target.files?.[0] ?? null)}
                className="block w-full rounded border border-[#2a2d3d] bg-[#12131b] px-3 py-2 text-sm text-[#c9c9d6] file:mr-3 file:rounded file:border-0 file:bg-[#f4a261] file:px-3 file:py-1 file:font-bold file:text-[#12131b]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#7f829c]">
                Audio take (mic/interface) — buddy responds to the groove
              </span>
              <input
                type="file"
                accept=".wav,.mp3,.aiff,.flac,audio/*"
                aria-label="Upload an audio take"
                onChange={(e) => handleAudioFile(e.target.files?.[0] ?? null)}
                className="block w-full rounded border border-[#2a2d3d] bg-[#12131b] px-3 py-2 text-sm text-[#c9c9d6] file:mr-3 file:rounded file:border-0 file:bg-[#f4a261] file:px-3 file:py-1 file:font-bold file:text-[#12131b]"
              />
            </label>
          </div>
          {midiFile && (
            <p className="mt-2 text-xs text-[#7f829c]">
              {midiFile.name} — tempo + length detected from it.
            </p>
          )}
          {audioFile && (
            <p className="mt-2 text-xs text-[#7f829c]">
              {audioFile.name} — audio-to-audio; the buddy responds to its groove.
            </p>
          )}
        </section>

        {/* Transport */}
        <div className="mb-2 flex items-center gap-4">
          <button
            type="button"
            onClick={joinIn}
            disabled={busy}
            className="jambuddy-trigger flex-1"
          >
            {busy ? "PRODUCING…" : "JOIN IN"}
          </button>
          <button
            type="button"
            onClick={playBoth}
            disabled={!midiBytes || !audioUrl || isPlayingTogether}
            className="jambuddy-trigger flex-1"
            style={{
              background:
                "linear-gradient(180deg,#5fd38a 0%,#3aa55f 100%)",
              boxShadow: "0 2px 0 #256b3f",
            }}
          >
            {isPlayingTogether ? "PLAYING…" : "PLAY BOTH"}
          </button>
          <div className="font-mono text-xs text-[#7f829c]">
            <div className="uppercase tracking-widest">Prompt</div>
            <div className="mt-1 max-w-[16rem] truncate text-[#e8e8f0]">
              {prompt}
            </div>
            <div className="mt-1 opacity-60">neg: {negativePrompt}</div>
          </div>
        </div>
        <p className="mb-6 text-[11px] text-[#7f829c]">
          {midiFile && audioUrl
            ? "PLAY BOTH plays your MIDI take and the buddy's response together, in tempo."
            : "Load a MIDI take and generate a response, then PLAY BOTH to hear them together."}
        </p>

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
          {audioUrl && (
            <audio controls src={audioUrl} className="mt-3 w-full">
              Your browser does not support audio playback.
            </audio>
          )}
        </section>
      </div>
    </main>
  );
}
