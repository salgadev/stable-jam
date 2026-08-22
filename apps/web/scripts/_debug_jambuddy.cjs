const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);
const { join } = require("node:path");

const repoRoot = join(__dirname, "..", "..", "..");
const python = join(repoRoot, "stable-audio-3", ".venv", "Scripts", "python.exe");
const script = join(repoRoot, "tools", "jam_buddy.py");
const out = join(require("node:os").tmpdir(), "out.wav");

execFileAsync(
  python,
  [script, "--bpm", "120", "--out", out],
  { timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
)
  .then(({ stdout }) => {
    console.log("OK. stdout bytes:", stdout.length);
    console.log("tail:", stdout.slice(-200));
  })
  .catch((err) => {
    console.log("ERROR name:", err.name);
    console.log("ERROR code:", err.code);
    console.log("ERROR killed:", err.killed);
    console.log("ERROR signal:", err.signal);
    console.log("ERROR message:", err.message);
    console.log("ERROR stderr:", JSON.stringify(err.stderr));
    console.log("ERROR stdout:", JSON.stringify(err.stdout?.slice(-300)));
  });
