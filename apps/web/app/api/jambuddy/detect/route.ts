import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuddyGenre } from "@/lib/jambuddy/prompt";

const execFileAsync = promisify(execFile);

/**
 * Jam Buddy BPM/duration detection.
 *
 * POST /api/jambuddy/detect
 *   body: { midi?: string(base64), audio?: string(base64), genre?: BuddyGenre }
 *
 * Shells to tools/jam_buddy_api.py (or jam_buddy.py) with --detect-only and
 * returns the detected BPM + duration so the client can PRE-FILL the tempo
 * knob. The knob stays authoritative afterward.
 */
export async function POST(req: NextRequest) {
  let body: { midi?: string; audio?: string; genre?: BuddyGenre };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.midi && !body.audio) {
    return NextResponse.json(
      { error: "need a midi or audio take to detect tempo from" },
      { status: 400 },
    );
  }

  // Resolve repo root + python like the main route.
  const exists = (p: string) => require("node:fs").existsSync(p);
  let repoRoot: string | null = process.env.JAM_BUDDY_ROOT ?? null;
  if (!repoRoot) {
    let cur = process.cwd();
    while (cur && !exists(join(cur, "tools", "jam_buddy_api.py"))) {
      const parent = join(cur, "..");
      if (parent === cur) break;
      cur = parent;
    }
    repoRoot = exists(join(cur, "tools", "jam_buddy_api.py")) ? cur : null;
  }
  if (!repoRoot) {
    return NextResponse.json(
      { error: "could not locate repo root" },
      { status: 500 },
    );
  }
  const python =
    process.env.JAM_BUDDY_PYTHON ??
    (exists(join(repoRoot, "stable-audio-3", ".venv", "Scripts", "python.exe"))
      ? join(repoRoot, "stable-audio-3", ".venv", "Scripts", "python.exe")
      : "python3");
  const script = join(repoRoot, "tools", "jam_buddy_api.py");

  try {
    const args = ["--detect-only"];
    if (body.midi) {
      const midiPath = join(tmpdir(), `jambuddy-detect-${Date.now()}.mid`);
      await writeFile(midiPath, Buffer.from(body.midi, "base64"));
      args.push("--midi", midiPath);
    } else if (body.audio) {
      const audioPath = join(tmpdir(), `jambuddy-detect-${Date.now()}.wav`);
      await writeFile(audioPath, Buffer.from(body.audio, "base64"));
      args.push("--wav", audioPath);
      // Genre prior for audio detection (helps octave disambiguation).
      if (body.genre) args.push("--genre", body.genre);
    }
    const { stdout } = await execFileAsync(python, [script, ...args], {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    // stdout ends with "DETECT <bpm> <duration>"
    const m = stdout.match(/DETECT\s+([\d.]+)\s+([\d.]+)/);
    const bpmVal = m?.[1];
    const durVal = m?.[2];
    if (!bpmVal || !durVal) {
      return NextResponse.json(
        { error: "detection produced no result", detail: stdout.trim() },
        { status: 500 },
      );
    }
    return NextResponse.json({
      bpm: Math.round(parseFloat(bpmVal)),
      duration: parseFloat(durVal),
    });
  } catch (err) {
    const detail =
      err instanceof Error
        ? (err as Error & { stderr?: string }).stderr?.trim() || err.message
        : String(err);
    return NextResponse.json({ error: "detection failed", detail }, { status: 500 });
  }
}
