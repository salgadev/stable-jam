#!/usr/bin/env python3
"""
midjson_to_mid.py
=================
Consume the JSON event stream emitted by gp_to_keyswitched_mid.js and write
one Type-1 MIDI file per track into <out_dir>, named <TrackName>_keyswitched.mid.

Usage:
    node gp_to_keyswitched_mid.js input.gp out_dir > events.json
    python midjson_to_mid.py events.json <out_dir>
"""
import json
import os
import re
import sys

import mido

_FORBIDDEN = re.compile(r'[\\/:\*\?"<>\|]+')
_WS = re.compile(r'\s+')


def sanitize(name, default="output"):
    cleaned = _FORBIDDEN.sub(' ', name or '')
    cleaned = _WS.sub(' ', cleaned).strip().rstrip('. ')
    return cleaned or default


def write_track(mid, name, channel, events, ticks_per_beat=960):
    track = mid.add_track(name[:127] if name else "Guitar")
    last = 0
    for e in events:
        tick = max(0, int(e['tick']))
        kind = e['kind']
        note = int(e['note'])
        vel = int(e.get('velocity', 0))
        if kind == 'note_on' and vel > 0:
            msg = mido.Message('note_on', channel=channel, note=note,
                               velocity=max(1, min(127, vel)), time=tick - last)
        else:
            msg = mido.Message('note_off', channel=channel, note=note,
                               velocity=0, time=tick - last)
        track.append(msg)
        last = tick
    return track


def main():
    if len(sys.argv) < 3:
        print("Usage: python midjson_to_mid.py <events.json> <out_dir>",
              file=sys.stderr)
        return 2
    events_path = sys.argv[1]
    out_dir = sys.argv[2]
    with open(events_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    os.makedirs(out_dir, exist_ok=True)
    tempo = int(data.get('tempo', 120))
    ts = data.get('timeSignature', {})
    ts_num = int(ts.get('numerator', 4))
    ts_den = int(ts.get('denominator', 4))

    written = []
    for tr in data.get('tracks', []):
        events = tr['events']
        if not events:
            continue
        mid = mido.MidiFile(type=1, ticks_per_beat=960)
        conductor = mid.add_track("Conductor")
        conductor.append(mido.MetaMessage(
            'set_tempo', tempo=mido.bpm2tempo(tempo), time=0))
        conductor.append(mido.MetaMessage(
            'time_signature', numerator=ts_num, denominator=ts_den, time=0))
        write_track(mid, tr['name'], int(tr['channel']), events)
        fname = sanitize(tr['name']) + "_keyswitched.mid"
        out_path = os.path.join(out_dir, fname)
        mid.save(out_path)
        # stats
        ks_notes = sum(1 for e in events if e['kind'] == 'note_on' and e.get('ks'))
        played = sum(1 for e in events if e['kind'] == 'note_on' and not e.get('ks'))
        written.append((out_path, tr['name'], tr['channel'], len(events), ks_notes, played))

    for out_path, name, ch, nev, ks, played in written:
        size = os.path.getsize(out_path)
        print(f"  {os.path.basename(out_path)}  ({size:,}B, ch={ch}) "
              f"events={nev} keyswitch_on={ks} played_notes={played}")
    print(f"\nWrote {len(written)} file(s) to {out_dir}")
    return 0


if __name__ == '__main__':
    sys.exit(main())