"use client";

/**
 * Jam Buddy take visualizer.
 *
 * Renders the user's take and the buddy's response on a canvas:
 *  - MIDI  -> a piano-roll (notes as bars over time, pitch on the y-axis).
 *  - audio -> a real waveform (min/max peaks over time).
 *
 * MIDI has no waveform (it's note data, not audio), so the honest visual for a
 * MIDI take is a piano-roll; audio gets the waveform. Both share a time axis so
 * you can compare the take and the response side by side.
 */

import { useEffect, useRef } from "react";
import { parseMidi, type ParsedNote } from "./player";

interface VisualizerProps {
  /** MIDI bytes -> piano-roll. Mutually exclusive with audioUrl. */
  midiBytes?: ArrayBuffer | null;
  /** Audio object URL -> waveform. Mutually exclusive with midiBytes. */
  audioUrl?: string | null;
  /** Optional label shown above the canvas. */
  label?: string;
  /** Height of the canvas in px. */
  height?: number;
}

const NOTE_MIN = 21; // A0
const NOTE_MAX = 108; // C8

/** Draw a piano-roll of MIDI notes onto a canvas. */
function drawPianoRoll(
  canvas: HTMLCanvasElement,
  notes: ParsedNote[],
  duration: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "#12131b";
  ctx.fillRect(0, 0, w, h);

  if (notes.length === 0 || duration <= 0) {
    ctx.fillStyle = "#7f829c";
    ctx.font = "12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("no notes", w / 2, h / 2);
    return;
  }

  const pad = 8;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const span = NOTE_MAX - NOTE_MIN;

  // Grid lines every octave.
  ctx.strokeStyle = "#2a2d3d";
  ctx.lineWidth = 1;
  for (let n = NOTE_MIN; n <= NOTE_MAX; n += 12) {
    const y = pad + (1 - (n - NOTE_MIN) / span) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  // Notes as bars.
  const maxTime = Math.max(duration, ...notes.map((n) => n.time + n.duration));
  for (const n of notes) {
    const x = pad + (n.time / maxTime) * plotW;
    const bw = Math.max(2, (n.duration / maxTime) * plotW);
    const y = pad + (1 - (n.midi - NOTE_MIN) / span) * plotH;
    const bh = Math.max(2, plotH / span);
    ctx.fillStyle = n.channel === 9 ? "#f4a261" : "#5fd38a";
    ctx.fillRect(x, y - bh, bw, bh);
  }
}

/** Draw a waveform (min/max peaks) of an AudioBuffer onto a canvas. */
function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "#12131b";
  ctx.fillRect(0, 0, w, h);

  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / w);
  const amp = h / 2;
  ctx.fillStyle = "#5fd38a";
  for (let x = 0; x < w; x++) {
    let min = 1;
    let max = -1;
    for (let i = 0; i < step; i++) {
      const v = data[x * step + i];
      if (v === undefined) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y1 = amp + min * amp;
    const y2 = amp + max * amp;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

export function Visualizer({
  midiBytes,
  audioUrl,
  label,
  height = 120,
}: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (midiBytes) {
      let notes: ParsedNote[] = [];
      let duration = 0;
      try {
        notes = parseMidi(midiBytes);
        duration = notes.reduce(
          (m, n) => Math.max(m, n.time + n.duration),
          0,
        );
      } catch {
        /* corrupt bytes -> empty roll */
      }
      drawPianoRoll(canvas, notes, duration);
      return;
    }

    if (audioUrl) {
      const ctx = new AudioContext();
      fetch(audioUrl)
        .then((r) => r.arrayBuffer())
        .then((buf) => ctx.decodeAudioData(buf))
        .then((audio) => {
          drawWaveform(canvas, audio);
          ctx.close();
        })
        .catch(() => {
          const c = canvas.getContext("2d");
          if (c) {
            c.fillStyle = "#12131b";
            c.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
            c.fillStyle = "#7f829c";
            c.font = "12px ui-monospace, monospace";
            c.textAlign = "center";
            c.fillText("no audio", canvas.clientWidth / 2, canvas.clientHeight / 2);
          }
        });
      return;
    }

    // Nothing to draw.
    const c = canvas.getContext("2d");
    if (c) {
      c.fillStyle = "#12131b";
      c.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    }
  }, [midiBytes, audioUrl]);

  return (
    <div className="w-full">
      {label && (
        <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[#7f829c]">
          {label}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full rounded border border-[#2a2d3d] bg-[#12131b]"
        style={{ height }}
      />
    </div>
  );
}
