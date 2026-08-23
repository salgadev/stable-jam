import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The page imports Web Audio + MIDI recorder + canvas visualizers that don't
// exist cleanly under happy-dom. Mock the noisy, browser-only modules so we
// can exercise the component's UI logic.
vi.mock("@/lib/jambuddy/player", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/jambuddy/player")>(
      "@/lib/jambuddy/player",
    );
  return {
    ...actual,
    playTogether: vi.fn(async () => ({
      stop: vi.fn(),
      done: new Promise<void>((r) => setTimeout(r, 5000)),
    })),
    playAudioTogether: vi.fn(async () => ({
      stop: vi.fn(),
      done: new Promise<void>((r) => setTimeout(r, 5000)),
    })),
  };
});

vi.mock("@/lib/jambuddy/recorder", () => ({
  createMidiRecorder: vi.fn(async () => ({
    start: vi.fn(),
    stop: vi.fn(() => ({ notes: [], durationSec: 0 })),
    isActive: vi.fn(() => false),
    dispose: vi.fn(),
  })),
  listMidiInputs: vi.fn(async () => [
    { id: "mpk", name: "MPK Mini" },
    { id: "keystation", name: "Keystation 49" },
  ]),
  grantMicPermission: vi.fn(async () => ({
    getTracks: () => [{ stop: vi.fn() }],
  })),
  createAudioRecorder: vi.fn(async () => ({
    start: vi.fn(),
    stop: vi.fn(async () => ({
      file: new File([new Uint8Array([1, 2, 3])], "cap.webm", {
        type: "audio/webm",
      }),
      durationSec: 1.5,
    })),
    isActive: vi.fn(() => false),
    dispose: vi.fn(),
  })),
  listAudioInputs: vi.fn(async () => [
    { deviceId: "default", label: "Default microphone", isDefault: true },
    { deviceId: "usb", label: "USB Audio Interface", isDefault: false },
  ]),
  recordedNotesAsFile: vi.fn(() => new File([""], "cap.mid")),
}));

vi.mock("@/lib/jambuddy/visualizer", () => ({
  Visualizer: () => <div data-testid="visualizer" />,
}));

import HomePage from "@/app/page";

// Object URLs the component creates (take audio + response audio).
const createObjectURL = vi.fn(() => "blob:fake-audio");
vi.stubGlobal("URL.createObjectURL", createObjectURL);

/** Drive the app to a state with an audio take + a buddy response. */
async function setUpTakeAndResponse(user: ReturnType<typeof userEvent.setup>) {
  render(<HomePage />);
  // Mock the /api/jambuddy/detect + /api/jambuddy calls (fetch).
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/detect")) {
        return new Response(
          JSON.stringify({ bpm: 158, duration: 24 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // joinIn -> return the generated audio blob.
      return new Response(
        new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
        {
          status: 200,
          headers: {
            "X-Jam-Buddy-BPM": "158",
            "X-Jam-Buddy-Time": "1000",
            "Content-Type": "audio/wav",
          },
        },
      );
    }),
  );

  // Upload an audio take so playBoth takes the audio-mix path.
  const file = new File([new Uint8Array([1, 2, 3, 4])], "take.wav", {
    type: "audio/wav",
  });
  const input = document.querySelector<HTMLInputElement>(
    'input[type="file"]',
  );
  if (!input) throw new Error("file input not found");
  fireEvent.change(input, { target: { files: [file] } });

  // Generate the response.
  await user.click(screen.getByRole("button", { name: "JOIN IN" }));
  await screen.findByText(/Done — your buddy produced/i);
}

describe("PLAY TOGETHER toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("URL.createObjectURL", createObjectURL);
  });

  afterEach(() => {
    cleanup();
  });

  it("is disabled when there is no generated response", () => {
    render(<HomePage />);
    const btn = screen.getByRole("button", { name: "PLAY TOGETHER" });
    expect(btn).toBeDisabled();
  });

  it("stays enabled while playing and toggles to STOP, then back", async () => {
    const user = userEvent.setup();
    await setUpTakeAndResponse(user);

    const btn = screen.getByRole("button", { name: "PLAY TOGETHER" });
    expect(btn).toBeEnabled();

    // Start playback.
    await user.click(btn);
    const stopBtn = screen.getByRole("button", { name: "■ STOP" });
    // REGRESSION GUARD: must remain enabled so it can be clicked to stop.
    expect(stopBtn).toBeEnabled();

    // Click again to stop.
    await user.click(stopBtn);
    expect(
      screen.getByRole("button", { name: "PLAY TOGETHER" }),
    ).toBeEnabled();
  });
});

describe("RECORD source toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("URL.createObjectURL", createObjectURL);
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults to MIDI and switches to audio when the Record toggle flips", async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    // Default source is MIDI.
    const recBtn = screen.getByRole("button", {
      name: "Record from MIDI controller",
    });
    expect(recBtn).toBeInTheDocument();

    // Flip the Record source toggle. DOM order: Engine toggle first, Record
    // toggle second. The Record toggle starts unchecked (recordSource='midi').
    const toggles = screen.getAllByRole("checkbox");
    expect(toggles.length).toBeGreaterThanOrEqual(2);
    await user.click(toggles[1]);

    // Now the RECORD button targets audio.
    const audioBtn = screen.getByRole("button", {
      name: "Record from microphone",
    });
    expect(audioBtn).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record from MIDI controller" }),
    ).not.toBeInTheDocument();
  });

  it("shows the audio input device dropdown once audio recording starts", async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    // Flip to audio, then start recording so listAudioInputs populates devices.
    const toggles = screen.getAllByRole("checkbox");
    await user.click(toggles[1]);
    await user.click(screen.getByRole("button", { name: "Record from microphone" }));

    // The device dropdown appears with the two mocked devices.
    const select = await screen.findByRole("combobox", {
      name: "Audio input device",
    });
    expect(select).toBeInTheDocument();
    const options = Array.from(select.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(options).toContain("Default microphone");
    expect(options).toContain("USB Audio Interface");
  });

  it("shows the MIDI device + channel dropdowns once MIDI recording starts", async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    // Start MIDI recording so listMidiInputs populates devices (source
    // defaults to MIDI, so just hit RECORD).
    await user.click(screen.getByRole("button", { name: "Record from MIDI controller" }));

    // Device dropdown lists the two mocked MIDI controllers.
    const deviceSelect = await screen.findByRole("combobox", {
      name: "MIDI input device",
    });
    const deviceOptions = Array.from(deviceSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(deviceOptions).toContain("MPK Mini");
    expect(deviceOptions).toContain("Keystation 49");

    // Channel dropdown defaults to "All" with 16 selectable channels.
    const channelSelect = screen.getByRole("combobox", { name: "MIDI channel" });
    const channelOptions = Array.from(channelSelect.querySelectorAll("option"));
    expect(channelOptions[0]?.textContent).toBe("All");
    expect(channelOptions.length).toBe(17); // All + 16
  });
});
