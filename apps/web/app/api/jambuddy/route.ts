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
  /** Generation backend: "local" (CPU SA3) or "api" (Stable Audio 3.0 Large, 26 credits/gen). */
  mode?: "local" | "api";
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
  // Thread the TS-built AudioSparx prompt through so Genre:/Moods:/Instruments
  // tags actually reach SA3. The Python CLI also accepts --instrument/--genre
  // for standalone use, but route.ts is authoritative here.
  const python =
    process.env.JAM_BUDDY_PYTHON ??
    join(repoRoot, "stable-audio-3", ".venv", "Scripts", "python.exe");

  // Local = Stable Audio small models on CPU (supports negative prompt, free,
  // slow). API = Stable Audio 3.0 Large via Stability REST (no negative prompt,
  // fast, 26 credits/gen). Default to API — key is present, it's faster and
  // isolates better; the user can flip to local (offline / free) in the GUI.
  const mode: "local" | "api" =
    body.mode === "local" ? "local" : "api";
  const script = join(
    repoRoot,
    "tools",
    mode === "api" ? "jam_buddy_api.py" : "jam_buddy.py",
  );

  // Always write to a PERSISTENT generations dir at the repo root so the
  // output survives and is inspectable. Filenames are timestamped + tagged so
  // you can tell them apart. The dir is gitignored (regenerable artifact).
  const generationsDir = join(repoRoot, "generations");
  await mkdir(generationsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const sourceTag = body.midi ? "midi" : body.audio ? "audio" : "manual";
  // API returns MP3 (output_format mp3); local returns WAV.
  const ext = mode === "api" ? "mp3" : "wav";
  const outPath = join(
    generationsDir,
    `${stamp}-${body.knobs.instrument}-${sourceTag}-${mode}.${ext}`,
  );

  try {
    // Build args. A take (MIDI or audio) makes the buddy respond to it; with
    // neither we use the manual bpm knob + duration. The TS-built prompt and
    // negative prompt override the Python auto-build so AudioSparx tags
    // (Genre:/Moods:/Instruments:) actually reach SA3.

    const args = [
      "--instrument",
      body.knobs.instrument,
      "--prompt",
      prompt,
      "--out",
      outPath,
    ];
    // Local model + negative prompt are CPU-only concepts. The API fixes the
    // model (stable-audio-3) and accepts NO negative prompt.
    if (mode === "local") {
      args.unshift("--model", model);
      args.push("--negative-prompt", negativePrompt);
    }
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

    const t0 = Date.now();
    // The Python child needs STABILITY_API_KEY in its env for API mode. Read it
    // from the repo-root .env (the child's cwd is apps/web, so it can't find it
    // itself) and pass it explicitly. Local mode ignores it.
    let childEnv = process.env;
    if (mode === "api") {
      const dotenvPath = join(repoRoot, ".env");
      let apiKey = process.env.STABILITY_API_KEY ?? null;
      if (!apiKey) {
        try {
          const dotenvText = await readFile(dotenvPath, "utf8");
          const m = dotenvText.match(/^STABILITY_API_KEY=(.+)$/m);
          const val = m?.[1];
          if (val) apiKey = val.trim().replace(/^["']|["']$/g, "");
        } catch {
          /* .env missing — the child will error clearly */
        }
      }
      if (!apiKey) {
        throw new Error(
          "STABILITY_API_KEY not found in repo .env or process env (required for api mode)",
        );
      }
      childEnv = { ...process.env, STABILITY_API_KEY: apiKey };
    }
    const { stdout } = await execFileAsync(python, [script, ...args], {
      timeout: 300_000, // 5 min — SA3 generation on CPU is slow
      maxBuffer: 10 * 1024 * 1024,
      env: childEnv,
    });
    const generateMs = Date.now() - t0;
    console.log("[jambuddy] stdout:", stdout);
    console.log("[jambuddy] generate time:", generateMs, "ms");

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
    // API returns MP3, local returns WAV — serve the right content-type.
    const contentType = mode === "api" ? "audio/mpeg" : "audio/wav";
    const filename = mode === "api" ? "buddy_response.mp3" : "buddy_response.wav";
    return new NextResponse(wav, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Jam-Buddy-BPM": String(usedBpm),
        "X-Jam-Buddy-Time": String(generateMs),
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
