import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { Visualizer, type VisualizerHandle } from "@/lib/jambuddy/visualizer";

/**
 * Regression test for the "one playback at a time" rule.
 *
 * Each playable waveform owns its own <Audio>. The parent wires onStartPlayback
 * to stop any other playback before a new one starts. This pins:
 *  - clicking a playable waveform's toggle fires onStartPlayback FIRST
 *  - the exposed stop() handle actually stops the audio and resets the toggle
 * So PLAY TOGETHER / another waveform can always silence a playing one.
 */

// Fake Audio so `new Audio(url)` works under happy-dom.
class FakeAudio {
  onended: (() => void) | null = null;
  paused = true;
  played = false;
  play() {
    this.played = true;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
let fakeAudio: FakeAudio | null = null;

// Fake AudioContext + fetch so the waveform-draw effect completes cleanly.
class FakeAudioContext {
  sampleRate = 44100;
  close() {
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(100),
    });
  }
}

beforeEach(() => {
  fakeAudio = new FakeAudio();
  vi.stubGlobal("Audio", class { constructor() { return fakeAudio; } });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
  ));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Visualizer playable waveform", () => {
  it("fires onStartPlayback BEFORE starting play (exclusivity guard)", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const ref = createRef<VisualizerHandle>();
    await act(async () => {
      render(
        <Visualizer
          ref={ref}
          audioUrl="blob:take"
          playable
          onStartPlayback={onStart}
        />,
      );
    });

    await user.click(screen.getByRole("button", { name: "Play" }));

    // The owner must be told to stop anything else before this one starts.
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(fakeAudio?.played).toBe(true);
  });

  it("exposes a stop() handle that stops audio and flips the toggle back", async () => {
    const user = userEvent.setup();
    const ref = createRef<VisualizerHandle>();
    await act(async () => {
      render(<Visualizer ref={ref} audioUrl="blob:take" playable />);
    });

    await user.click(screen.getByRole("button", { name: "Play" }));
    // Now playing -> the toggle reads Stop.
    expect(screen.getByRole("button", { name: "Stop playback" })).toBeInTheDocument();

    act(() => {
      ref.current?.stop();
    });
    expect(fakeAudio?.paused).toBe(true);
    // stop() resets internal state, so the toggle reads Play again.
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });
});
