# 07 — Reaper Integration

## Goal

PatternTalk lives alongside Reaper, not inside it (for the 2-day hackathon). Integration happens at three levels:

1. **Auto-detect project tempo** via Reaper's Web Control surface
2. **MIDI export** that's drag-and-droppable into Reaper
3. **Optional ReaScript bridge** for richer control (stretch)

The CLAP plugin wrap is a stretch goal — see [`02-architecture.md`](02-architecture.md#decision-5-reaper-first-daw-integration).

## Reaper Web Control surface

Reaper has a built-in HTTP server you can enable in Preferences → Control Surfaces → Web Browser Interface.

**Default URL:** `http://localhost:8080`

**Default endpoints we care about:**

| Endpoint | Returns |
|---|---|
| `GET /_/` | HTML control panel (we ignore this) |
| `GET /_/action?name=...` | Run a named action |
| `GET /_/set?param=value` | Set a parameter |
| `WS ws://localhost:8080/_/` | WebSocket for live state |

**Project tempo** is exposed via the WebSocket. On connect:

```json
{
  "type": "state",
  "data": {
    "tempo": 174,
    "timesig": [4, 4],
    "playstate": 0,
    "position": 0
  }
}
```

We subscribe to `state` updates and use the current tempo as the default for new patterns.

## Client-side Reaper detection

```typescript
// apps/web/lib/reaper/client.ts

class ReaperClient {
  private socket: WebSocket | null = null;
  private listeners: Set<(state: ReaperState) => void> = new Set();
  private state: ReaperState = {
    connected: false,
    tempo: null,
    timeSignature: null,
  };

  async connect(): Promise<boolean> {
    try {
      this.socket = new WebSocket("ws://localhost:8080/_/");
      this.socket.onopen = () => {
        this.state.connected = true;
        this.notify();
      };
      this.socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") {
          this.state.tempo = msg.data.tempo;
          this.state.timeSignature = msg.data.timesig;
          this.notify();
        }
      };
      this.socket.onerror = () => {
        this.state.connected = false;
        this.notify();
      };
      return true;
    } catch (e) {
      return false;
    }
  }

  getTempo(): number | null {
    return this.state.tempo;
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  subscribe(listener: (state: ReaperState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

interface ReaperState {
  connected: boolean;
  tempo: number | null;
  timeSignature: [number, number] | null;
}

export const reaper = new ReaperClient();
```

## Tempo resolution priority

When the user generates a pattern, PatternTalk picks the tempo in this order:

1. **Explicit in prompt:** "set tempo to 160" or "180 BPM" → 160 or 180
2. **From Reaper project:** If connected → use project tempo
3. **From uploaded audio:** If user uploaded an audio file → detected BPM
4. **Default:** 120 BPM

```typescript
// apps/web/lib/parser/tempo.ts

export async function resolveTempo(
  parsed: ParsedRequest,
  reaper: ReaperClient,
  uploadedAudio: AudioBuffer | null
): Promise<number> {
  if (parsed.tempo) {
    return { tempo: parsed.tempo, source: "prompt" };
  }

  if (reaper.isConnected() && reaper.getTempo()) {
    return { tempo: reaper.getTempo()!, source: "reaper" };
  }

  if (uploadedAudio) {
    const bpm = await detectBpm(uploadedAudio);
    if (bpm) {
      return { tempo: bpm, source: "audio" };
    }
  }

  return { tempo: 120, source: "default" };
}
```

## MIDI export

The MIDI file is generated in-browser. The user downloads it as a `.mid` file, then drags it onto a Reaper track.

### File naming

```
patterntalk-{pattern-id}-{bars}bars-{bpm}bpm-{timestamp}.mid
```

Examples:
- `patterntalk-d-beat-4bars-180bpm-2026-08-22T1430Z.mid`
- `patterntalk-skank-4bars-120bpm-2026-08-22T1435Z.mid`

### Drag-and-drop into Reaper

Reaper accepts MIDI files dropped from the file system onto a track. We make this explicit:

```typescript
// apps/web/components/midi/DownloadButton.tsx

function downloadMidi(events: MidiEvent[], meta: PatternMeta) {
  const midi = eventsToMidi(events, meta);
  const blob = new Blob([midi], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);

  const filename = `patterntalk-${meta.patternId}-${meta.bars}bars-${meta.bpm}bpm-${new Date().toISOString()}.mid`;

  // Trigger download
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  // Cleanup
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return filename;
}
```

### Drag-from-browser directly into Reaper

For the smoothest demo, the MIDI file should be draggable from the browser window directly onto a Reaper track. Reaper accepts this if the file is exposed as a real file (not a Blob URL), which means we need to keep the file in memory and reference it via the DataTransfer API.

```typescript
function makeMidiDraggable(
  events: MidiEvent[],
  meta: PatternMeta,
  element: HTMLElement
) {
  const midi = eventsToMidi(events, meta);
  const filename = `patterntalk-${meta.patternId}-${meta.bars}bars-${meta.bpm}bpm.mid`;

  element.draggable = true;
  element.ondragstart = (e) => {
    const file = new File([midi], filename, { type: "audio/midi" });
    e.dataTransfer!.files = [file];
    // Some browsers need this
    e.dataTransfer!.setData("DownloadURL", `audio/midi:${filename}:${e.dataTransfer!.getData("DownloadURL")}`);
  };
}
```

**Caveat:** Browser support for dragging real files (not blob URLs) into native apps varies. Test in Chrome on the demo machine before relying on this.

If drag-from-browser is flaky, the fallback is "click to download, then drag from Downloads folder to Reaper." Annoying but reliable.

## Verifying MIDI works in Reaper

Before the demo, smoke-test the MIDI export:

1. Open Reaper, create a new project at 180 BPM, 4/4
2. Add a track, load any drum sampler VST (free options: Drumgizmo, MT Power Drum Kit, or Reaper's built-in ReaDrumCrafter)
3. Download a PatternTalk MIDI file
4. Drag onto the track
5. Hit play — confirm the pattern plays correctly

Common bugs to watch for:
- Tempo mismatch (Reaper plays at project tempo; MIDI file tempo should match)
- Wrong GM drum map notes (kick = 36, snare = 38, etc.)
- Notes too short or too long (drum hits should be very short, ~1-10 ticks)
- MIDI file doesn't import at all (file format corruption)

## ReaScript bridge (stretch)

For richer integration, a small ReaScript can:

- Auto-create a new track and load the MIDI when PatternTalk generates
- Set the project tempo to match the pattern
- Start playback automatically

```lua
-- scripts/reaper/patterntalk_bridge.lua

-- Receives HTTP requests from PatternTalk
-- Endpoint: http://localhost:8081/...

-- For each request, execute a Reaper action

function onRequest(method, path, body)
  if path == "/import-midi" then
    local filepath = body.filepath
    local trackIndex = body.trackIndex or 0
    Reaper.MIDI_InsertMedia(filepath, trackIndex)
    return { ok = true }
  end

  if path == "/set-tempo" then
    local tempo = body.tempo
    reaper.SetProjectTimeSignature(0, tempo, ...)
    return { ok = true }
  end
end
```

This is a stretch goal. If we have a teammate who's comfortable with ReaScript, we ship it. If not, the Web Control surface + MIDI drag-and-drop is the integration story.

## Web Control endpoint reference

The full Reaper Web Control API is documented at:
https://www.reaper.fm/developers/webcontrol.php

Key endpoints for PatternTalk:

| Action | Endpoint |
|---|---|
| Get full state | `WS /_/` |
| Run named action | `GET /_/action?name=<action_id>` |
| Set project tempo | `GET /_/set?project_tempo=<bpm>` |
| Get current tempo | (via WebSocket state) |
| Transport play | `GET /_/action?name=40044` (transport: play) |
| Transport stop | `GET /_/action?name=40044` (toggle, state-dependent) |

**Note:** Reaper's Web Control API is reverse-engineered more than documented. The state format isn't formally specced. Expect some brittleness; verify on the actual Reaper version (currently 7.x).

## Demo integration flow

For the live demo, the integration sequence is:

1. **Reaper is already open** with a project at ~174 BPM (a typical d-beat tempo)
2. **PatternTalk opens** in a browser window next to Reaper
3. **PatternTalk detects Reaper**, announces "Reaper connected at 174 BPM"
4. **User generates a pattern** — PatternTalk uses 174 from Reaper
5. **User downloads or drags MIDI** — drops into a Reaper track with a drum VST
6. **Reaper plays** — pattern sounds correct
7. **Optional:** Change Reaper project tempo to 160, regenerate in PatternTalk, drag new MIDI, plays at new tempo

The whole sequence, with audio, takes about 30 seconds. Memorable.

## What this integration is NOT

- Not a VST/AU/CLAP plugin (stretch goal only)
- Not bidirectional — PatternTalk reads from Reaper, doesn't write project state
- Not automatic — user still has to drag the MIDI file in
- Not a replacement for Reaper's built-in features

This is intentional. The 80/20 here is "auto-detect tempo + clean MIDI export." Everything else is stretch.
