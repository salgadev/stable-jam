import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrompt, MODEL_FOR_INSTRUMENT, type BuddyKnobs } from "@/lib/jambuddy/prompt";

const execFileAsync = promisify(execFile);

interface JambuddyBody {
  knobs?: BuddyKnobs;
  /** Override BPM. If a MIDI take is given, detection runs on it instead. */
  bpm?: number;
  /** Base64-encoded MIDI take (a controller recording). */
  midi?: string;
  /** Base64-encoded audio take (mic/interface/render) for audio-to-audio. */
  audio?: string;
  /** Response length in seconds. Default 30 (ignored when a take is provided). */
  duration?: number;
}

/**
 * Jam Buddy API route.
 *
 * POST /api/jambuddy
 *   body: { knobs, bpm?, midi?, duration? }
 *
 * Shells to tools/jam_buddy.py (the SA3 pipeline) and returns the generated
 * WAV as audio/wav. The Python side does the heavy lifting (SA3 generation +
 * MIDI tempo detection); this route just wires the webapp to it.
 *
 * If a MIDI take is uploaded, the buddy detects the tempo from it (so it
 * "joins in" at YOUR tempo) and the manual `bpm` knob is ignored.
 *
 * The SA3 venv python is resolved from env (JAM_BUDDY_PYTHON) or defaults to
 * the stable-audio-3 venv. The script path is resolved from the repo root.
 */
export async function POST(req: NextRequest) {
  let body: JambuddyBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.knobs) {
    return NextResponse.json({ error: "missing knobs" }, { status: 400 });
  }

  const { prompt, negativePrompt } = buildPrompt(body.knobs);
  const bpm = body.bpm ?? 120;
  const duration = body.duration ?? 30;
  // Drums use small-sfx (clean isolated hits); everything else small-music.
  const model = MODEL_FOR_INSTRUMENT[body.knobs.instrument];

  // Resolve the Python interpreter + script by locating the repo root, which
  // contains tools/jam_buddy.py. Walk up from the Next server cwd until we
  // find it — the cwd differs between `pnpm dev` (apps/web) and a root-level
  // launch, so don't assume a fixed number of levels up. Allow an env override.
  const exists = (p: string) => require("node:fs").existsSync(p);
  let repoRoot: string | null = process.env.JAM_BUDDY_ROOT ?? null;
  if (!repoRoot) {
    let cur = process.cwd();
    while (cur && !exists(join(cur, "tools", "jam_buddy.py"))) {
      const parent = join(cur, "..");
      if (parent === cur) break;
      cur = parent;
    }
    repoRoot = exists(join(cur, "tools", "jam_buddy.py")) ? cur : null;
  }
  if (!repoRoot) {
    return NextResponse.json(
      { error: "could not locate repo root (tools/jam_buddy.py)" },
      { status: 500 },
    );
  }
  const python =
    process.env.JAM_BUDDY_PYTHON ??
    join(repoRoot, "stable-audio-3", ".venv", "Scripts", "python.exe");
  const script = join(repoRoot, "tools", "jam_buddy.py");

  // Always write to a PERSISTENT generations dir at the repo root so the
  // output survives and is inspectable. Filenames are timestamped + tagged so
  // you can tell them apart. The dir is gitignored (regenerable artifact).
  const generationsDir = join(repoRoot, "generations");
  await mkdir(generationsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const sourceTag = body.midi ? "midi" : body.audio ? "audio" : "manual";
  const outPath = join(
    generationsDir,
    `${stamp}-${body.knobs.instrument}-${sourceTag}.wav`,
  );

  try {
    // Build args. A take (MIDI or audio) makes the buddy respond to it; with
    // neither we use the manual bpm knob + duration.
    const args = ["--model", model, "--out", outPath];
    if (body.midi) {
      // MIDI: derive tempo + response duration from the take (server mido).
      const midiPath = join(tmpdir(), `jambuddy-take-${Date.now()}.mid`);
      await writeFile(midiPath, Buffer.from(body.midi, "base64"));
      args.push("--midi", midiPath);
      console.log("[jambuddy] MIDI take: tempo+duration from it");
    } else if (body.audio) {
      // Audio: pass to SA3 via init_audio so it responds to the groove.
      const audioPath = join(tmpdir(), `jambuddy-take-${Date.now()}.wav`);
      await writeFile(audioPath, Buffer.from(body.audio, "base64"));
      args.push("--wav", audioPath);
      console.log("[jambuddy] audio take: audio-to-audio (responds to groove)");
    } else {
      args.push("--bpm", String(bpm), "--duration", String(duration));
    }

    const { stdout } = await execFileAsync(python, [script, ...args], {
      timeout: 300_000, // 5 min — SA3 generation on CPU is slow
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log("[jambuddy] stdout:", stdout);

    // The script prints the tempo it used, e.g.
    //   "Detected BPM (MIDI): 117 from ..."  (with a take)
    //   "Using explicit BPM: 120"            (manual knob)
    //   "Wrote ...: 30.0s @ 117 BPM"
    // Parse the final @ <n> BPM so the GUI can show the tempo the buddy locked
    // onto. Default to the manual bpm knob.
    let usedBpm = bpm;
    const atMatch = stdout.match(/@\s*([\d.]+)\s*BPM/i);
    if (atMatch && atMatch[1]) usedBpm = Math.round(parseFloat(atMatch[1]));
    console.log("[jambuddy] used BPM:", usedBpm);

    const wav = await readFile(outPath);
    return new NextResponse(wav, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": 'attachment; filename="buddy_response.wav"',
        "X-Jam-Buddy-BPM": String(usedBpm),
      },
    });
  } catch (err) {
    console.error("[jambuddy] error:", err);
    // Surface the underlying stderr so a broken pipeline is diagnosable from
    // the browser console, not a blank "generation failed".
    const detail =
      err instanceof Error
        ? (err as Error & { stderr?: string }).stderr?.trim() || err.message
        : String(err);
    return NextResponse.json({ error: "generation failed", detail }, { status: 500 });
  }
}
