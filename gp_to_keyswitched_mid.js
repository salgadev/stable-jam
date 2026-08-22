#!/usr/bin/env node
/**
 * gp_to_keyswitched_mid.js
 * ========================
 * Convert a Guitar Pro 7/8 (.gp) file to per-track Sforzando keyswitched MIDI.
 *
 * PyGuitarPro only reads up to GP5, so this uses alphaTab (which reads GP7/8
 * .gp natively) to extract notes + articulations in absolute-tick space, then
 * emits a JSON event stream that a tiny mido-based writer turns into a Type-1
 * MIDI file. The keyswitch mapping and sustain-reset behaviour mirror
 * gp5_to_keyswitched_mid.py exactly so both tools produce compatible output.
 *
 * INSTALL
 *     npm install @coderline/alphatab   (in this directory)
 *
 * USAGE
 *     node gp_to_keyswitched_mid.js <input.gp> <out_dir> [--include-drums]
 *         [--no-sustain-reset] [--no-trim-silence] [--velocity N]
 *
 * One <TrackName>_keyswitched.mid is written per non-drum track into <out_dir>.
 * Tracks that share a name get a "(N)" suffix so files never collide.
 *
 * The script prints a JSON object to stdout that the配套 Python writer
 * consumes; humans can read the per-track summary at the bottom of the output.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const at = require('@coderline/alphatab');

// ---- keyswitch map (same as gp5_to_keyswitched_mid.py) ---------------------
const KEYSWITCH_MAP = {
    sustain:   17,
    palm_mute: 20,
    harmonic:  9,
    slide_up:  24,
    slide_down: 23,
    slide_in:  27,
    hammer:    26,
    bend:      91,
};
const SUSTAIN_KEYSWITCH = 18;       // SusUp (cleaner sustain)
const KEYSWITCH_DURATION_TICKS = 960; // one quarter, clamped later
const DEFAULT_VELOCITY = 100;

// alphaTab Dynamics enum -> MIDI velocity
// Off=0, ppp=1, pp=2, p=3, mp=4, mf=5, f=6, ff=7, fff=8
const DYN_VEL = { 1: 16, 2: 32, 3: 48, 4: 64, 5: 80, 6: 96, 7: 112, 8: 127 };

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node gp_to_keyswitched_mid.js <input.gp> <out_dir> [options]');
    process.exit(1);
}
const inputPath = args[0];
const outDir = args[1];
const opts = {
    includeDrums: args.includes('--include-drums'),
    sustainReset: !args.includes('--no-sustain-reset'),
    trimSilence: !args.includes('--no-trim-silence'),
    fallbackVel: parseInt(args.find((a, i) => args[i - 1] === '--velocity')) || DEFAULT_VELOCITY,
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v | 0)); }

function loadScore(file) {
    const bytes = fs.readFileSync(file);
    return at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
}

function isDrumTrack(t) {
    if (t.isPercussionTrack) return true;
    const pi = t.playbackInfo || {};
    if (pi.primaryChannel === 9) return true;
    return /drum|kit|percussion/i.test(t.name || '');
}

function velocityFor(note, beat) {
    const d = note.dynamics ?? beat.dynamics;
    if (d && DYN_VEL[d]) return DYN_VEL[d];
    return opts.fallbackVel;
}

// --- articulation detection -------------------------------------------------
function detectTechniques(note, beat) {
    const techs = [];
    if (note.isPalmMute || beat.isPalmMute) techs.push('palm_mute');
    if (note.harmonicType) techs.push('harmonic');
    if (note.isHammerPullOrigin) techs.push('hammer');
    if (note.slideInType) techs.push('slide_in');
    // slides out / to a target -> directional slide
    if (note.slideOutType || note.slideTarget) {
        let dir = 'up';
        if (note.slideTarget) {
            dir = note.slideTarget.realValue > note.realValue ? 'up' :
                 note.slideTarget.realValue < note.realValue ? 'down' : 'up';
        } else if (note.slideOutType === 2) dir = 'down';
        techs.push(dir === 'down' ? 'slide_down' : 'slide_up');
    }
    if (note.bendType || (note.bendPoints && note.bendPoints.length)) techs.push('bend');
    return techs;
}

// --- tie-chain end-tick map -------------------------------------------------
// Mirrors _build_tie_chain_map from the GP5 tool: the origin note's note_off
// extends through every tied continuation on the same (string, pitch).
function buildNoteEndMap(track, absStartOf) {
    const noteEnd = new Map(); // id(note) -> absolute end tick
    const active = new Map();  // "string|pitch" -> id(origin note)
    for (const st of track.staves) {
        for (let bi = 0; bi < st.bars.length; bi++) {
            const bar = st.bars[bi];
            const barStart = absStartOf(bar);
            for (const voice of bar.voices) {
                if (voice.isEmpty) continue;
                for (const beat of voice.beats) {
                    const start = barStart + (beat.playbackStart || 0);
                    const dur = beat.playbackDuration || 0;
                    for (const note of beat.notes) {
                        if (note.isDead) continue;
                        const key = note.string + '|' + note.realValue;
                        const nd = Math.max(1, Math.round(dur * (note.durationPercent || 1)));
                        if (note.isTieDestination) {
                            const origin = active.get(key);
                            if (origin !== undefined) noteEnd.set(origin, start + nd);
                            // tied notes don't get their own note_on/off
                        } else {
                            noteEnd.set(note.id, start + nd);
                            active.set(key, note.id);
                        }
                    }
                }
            }
        }
    }
    return noteEnd;
}

function buildTrackEvents(track, absStartOf) {
    const channel = (track.playbackInfo && track.playbackInfo.primaryChannel != null)
        ? track.playbackInfo.primaryChannel : 0;
    const ch = channel === 9 ? 0 : channel; // never reuse GM percussion

    const noteEnd = buildNoteEndMap(track, absStartOf);

    // raw events: { tick, kind:'note_on'|'note_off', note, velocity, ks?:bool }
    const events = [];
    const pendingSustain = new Set(); // "tick" -> already emitted sustain at this tick

    for (const st of track.staves) {
        for (let bi = 0; bi < st.bars.length; bi++) {
            const bar = st.bars[bi];
            const barStart = absStartOf(bar);
            for (const voice of bar.voices) {
                if (voice.isEmpty) continue;
                for (const beat of voice.beats) {
                    const start = barStart + (beat.playbackStart || 0);
                    for (const note of beat.notes) {
                        if (note.isDead) continue;
                        const tied = note.isTieDestination;
                        const techs = detectTechniques(note, beat);
                        const ksNotes = [];
                        let hasArticulation = false;
                        for (const t of techs) {
                            const ks = KEYSWITCH_MAP[t];
                            if (ks != null) { ksNotes.push(ks); hasArticulation = true; }
                        }
                        // Tied notes share the previous attack's envelope. They only
                        // emit keyswitches when they carry a NEW articulation (e.g. a
                        // bend starting on the tied side). A tied note with no
                        // articulation emits nothing — no default sustain either.
                        if (!tied && !hasArticulation && opts.sustainReset) {
                            if (!pendingSustain.has(start)) {
                                pendingSustain.add(start);
                                ksNotes.push(SUSTAIN_KEYSWITCH);
                            }
                        }
                        const vel = clamp(velocityFor(note, beat), 1, 127);
                        for (const ks of ksNotes) {
                            events.push({ tick: start, kind: 'note_on', note: ks, velocity: vel, ks: true });
                            // sentinel: close at start+DUR (clamped later)
                            events.push({ tick: start + KEYSWITCH_DURATION_TICKS, kind: 'keyswitch_off', note: ks, velocity: 0, ks: true });
                        }
                        if (!tied) {
                            const end = noteEnd.has(note.id) ? noteEnd.get(note.id) : (start + Math.max(1, Math.round((beat.playbackDuration || 0) * (note.durationPercent || 1))));
                            const pitch = clamp(note.realValue, 0, 127);
                            events.push({ tick: start, kind: 'note_on', note: pitch, velocity: vel, ks: false });
                            events.push({ tick: end, kind: 'note_off', note: pitch, velocity: 0, ks: false });
                        }
                    }
                }
            }
        }
    }

    if (!events.length) return null;

    // --- clamp keyswitch_off + re-trigger (mirrors the GP5 tool) ------------
    const ksSet = new Set(Object.values(KEYSWITCH_MAP));
    ksSet.add(SUSTAIN_KEYSWITCH);
    events.sort((a, b) => a.tick - b.tick);

    const openStacks = new Map(); // "ch|note" -> [onTick,...]
    const resolved = [];
    function closeOldest(ch, note, atTick) {
        const key = ch + '|' + note;
        const stack = openStacks.get(key);
        if (!stack || !stack.length) return;
        const onTick = stack.shift();
        if (!stack.length) openStacks.delete(key);
        const cap = onTick + KEYSWITCH_DURATION_TICKS;
        let clamped = Math.min(atTick, cap);
        if (clamped < onTick) clamped = onTick;
        resolved.push({ tick: clamped, kind: 'note_off', note, velocity: 0, ks: true });
    }
    for (const e of events) {
        if (e.kind === 'keyswitch_off') {
            closeOldest(ch, e.note, e.tick);
        } else if (e.kind === 'note_on' && e.ks && ksSet.has(e.note)) {
            closeOldest(ch, e.note, e.tick); // re-trigger closes previous
            resolved.push(e);
            const key = ch + '|' + e.note;
            if (!openStacks.has(key)) openStacks.set(key, []);
            openStacks.get(key).push(e.tick);
        } else if (e.kind === 'note_off' && e.ks && ksSet.has(e.note)) {
            closeOldest(ch, e.note, e.tick);
        } else {
            resolved.push(e);
        }
    }
    let out = resolved;

    // --- trim leading silence ---------------------------------------------
    if (opts.trimSilence) {
        let earliest = null;
        for (const e of out) {
            if (e.kind === 'note_on' || e.kind === 'note_off') {
                if (earliest === null || e.tick < earliest) earliest = e.tick;
            }
        }
        if (earliest != null && earliest > 0) {
            out = out
                .filter(e => e.tick - earliest >= 0)
                .map(e => ({ ...e, tick: e.tick - earliest }));
        }
    }
    out.sort((a, b) => a.tick - b.tick);
    return { name: track.name || 'Guitar', channel: ch, events: out };
}

function main() {
    const score = loadScore(inputPath);
    const mbStart = new Map(); // bar.index -> start tick
    for (const mb of score.masterBars) mbStart.set(mb.index, mb.start || 0);
    const absStartOf = (bar) => mbStart.get(bar.index) || 0;

    // tempo + time sig from first master bar
    let tempo = score.tempo || 120;
    const tempoAuto = score.masterBars[0] && score.masterBars[0].tempoAutomations;
    if (tempoAuto && tempoAuto.length && tempoAuto[0].value) tempo = tempoAuto[0].value.bpm || tempo;
    let tsNum = 4, tsDen = 4;
    const mb0 = score.masterBars[0];
    if (mb0) { tsNum = mb0.timeSignatureNumerator || 4; tsDen = mb0.timeSignatureDenominator || 4; }

    const tracks = [];
    const nameCount = {};
    for (const t of score.tracks) {
        if (isDrumTrack(t) && !opts.includeDrums) continue;
        const built = buildTrackEvents(t, absStartOf);
        if (!built) continue;
        // disambiguate duplicate names
        let name = built.name;
        nameCount[name] = (nameCount[name] || 0) + 1;
        if (nameCount[name] > 1) name = `${name} (${nameCount[name]})`;
        tracks.push({ ...built, name });
    }

    const result = { input: inputPath, tempo: Math.round(tempo), timeSignature: { numerator: tsNum, denominator: tsDen }, tracks };
    process.stdout.write(JSON.stringify(result));
}

main();