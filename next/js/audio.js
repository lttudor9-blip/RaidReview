// Raid Review audio: an adaptive soundtrack and sound effects, all synthesized
// with Web Audio (no files to load or license).
//
// MUSIC (projector only)
//   Audio.music('boss:raider' | 'boss:enforcer' | 'boss:construct' | 'boss:omega'
//               | 'lobby' | 'puzzle' | 'rest' | 'victory' | 'defeat' | null)
//   Audio.setIntensity(0..1)   more layers come in as the fight builds
//   Audio.setPhase('NORMAL' | 'ENRAGED' | 'DESPERATE')
//                              changes land on the next bar after a one-bar
//                              build (snare roll + riser), then an impact
//   Audio.setUrgency(0..1)     puzzle clock: ticking speeds up and thickens
//   Audio.stinger('ult' | 'combo' | 'hero' | 'bossDown' | 'wipe' | 'telegraph' | 'solve' | 'fail')
//                              hits that land on the beat
//   Audio.muffle(on)           muffles the music (paused, wiped)
//
// SFX (host and students): the sfx* functions from the original game.
//
// For tests and offline rendering: Audio.attach(ctx) + Audio.pump(untilTime).

export const AudioEngine = (() => {
    let ctx = null, offline = false;
    let master, comp, musicBus, musicFilter, duckGain, pumpGain, drumBus, sfxGain, reverb, reverbSend, delay, delaySend;
    let noiseBuf = null;
    let muted = false, musicMuted = false;

    // ============================================================ graph

    function build(c) {
        ctx = c;
        comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
        master = ctx.createGain(); master.gain.value = 0.8;
        master.connect(comp); comp.connect(ctx.destination);

        // music: (drums + pumped instruments) -> duck -> lowpass (muffle) -> musicBus -> master
        musicBus = ctx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
        musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 20000; musicFilter.Q.value = 0.7;
        musicFilter.connect(musicBus);
        duckGain = ctx.createGain(); duckGain.connect(musicFilter);
        drumBus = ctx.createGain(); drumBus.gain.value = 0.9; drumBus.connect(duckGain);
        pumpGain = ctx.createGain(); pumpGain.connect(duckGain); // sidechained to the kick

        // space
        reverb = ctx.createConvolver(); reverb.buffer = impulse(1.9, 2.2);
        const revOut = ctx.createGain(); revOut.gain.value = 0.5;
        reverb.connect(revOut); revOut.connect(duckGain);
        reverbSend = ctx.createGain(); reverbSend.gain.value = 1; reverbSend.connect(reverb);
        delay = ctx.createDelay(1.5);
        delay.delayTime.value = 0.35;
        const fb = ctx.createGain(); fb.gain.value = 0.32;
        const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2800;
        delay.connect(dlp); dlp.connect(fb); fb.connect(delay);
        const dOut = ctx.createGain(); dOut.gain.value = 0.35; dlp.connect(dOut); dOut.connect(pumpGain);
        delaySend = ctx.createGain(); delaySend.connect(delay);

        sfxGain = ctx.createGain(); sfxGain.gain.value = 0.6; sfxGain.connect(master);

        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }

    function impulse(seconds, decay) {
        const len = Math.floor(ctx.sampleRate * seconds);
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
        return buf;
    }

    function init() {
        if (ctx) return;
        try { build(new (window.AudioContext || window.webkitAudioContext)()); }
        catch (e) { ctx = null; console.warn('Audio not supported'); }
    }
    function ensureCtx() { if (!ctx) init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
    function attach(c) { build(c); offline = true; }

    // ============================================================ instruments

    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

    function env(g, t, peak, a, d, sustain = 0, hold = 0, r = 0.05) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + a);
        if (hold > 0) {
            g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain || 0.0001), t + a + d);
            g.gain.setValueAtTime(Math.max(0.0001, peak * sustain || 0.0001), t + a + d + hold);
            g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + hold + r);
            return t + a + d + hold + r;
        }
        g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
        return t + a + d;
    }

    function osc(type, freq, t, end, dest, detune = 0) {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
        o.connect(dest); o.start(t); o.stop(end + 0.02);
        return o;
    }

    function noise(t, dur, dest, { type = 'highpass', freq = 1000, q = 0.7, gain = 0.3, attack = 0.001 } = {}) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain();
        env(g, t, gain, attack, dur);
        src.connect(f); f.connect(g); g.connect(dest);
        src.start(t, Math.random() * 1.5); src.stop(t + attack + dur + 0.05);
        return { src, f, g };
    }

    // ---- one-shot cache. Drums, plucks, bells and ticks are synthesized once
    // into a buffer and replayed from then on: one node per hit instead of
    // five or six, which keeps the soundtrack light on school laptops.
    const baked = new Map();
    function oneShot(key, dur, draw, t, routes) {
        const buf = baked.get(key);
        if (buf) {
            const src = ctx.createBufferSource(); src.buffer = buf;
            for (const [dest, gain] of routes) { const g = ctx.createGain(); g.gain.value = gain; src.connect(g); g.connect(dest); }
            src.start(t);
            return;
        }
        if (buf === undefined && !offline) bake(key, dur, draw);
        const mix = ctx.createGain();
        for (const [dest, gain] of routes) { const g = ctx.createGain(); g.gain.value = gain; mix.connect(g); g.connect(dest); }
        draw(t, mix);
    }
    function bake(key, dur, draw) {
        if (typeof OfflineAudioContext === 'undefined') return;
        baked.set(key, null);
        const off = new OfflineAudioContext(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
        const live = ctx;
        ctx = off;
        try { draw(0.001, off.destination); } catch (e) { ctx = live; baked.delete(key); return; }
        ctx = live;
        off.startRendering().then(b => baked.set(key, b), () => baked.delete(key));
    }

    const drawKick = (t, out) => {
        const g = ctx.createGain();
        const o = osc('sine', 165, t, t + 0.45, g);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
        env(g, t, 0.95, 0.002, 0.42);
        g.connect(out);
        noise(t, 0.012, out, { freq: 2500, gain: 0.25 });
    };
    function kick(t, vel = 1, dest = drumBus) {
        oneShot('kick', 0.5, drawKick, t, [[dest, vel]]);
        // sidechain pump on everything melodic
        pumpGain.gain.setValueAtTime(0.32, t);
        pumpGain.gain.linearRampToValueAtTime(1, t + 0.17);
    }

    const drawSnare = (t, out) => {
        noise(t, 0.2, out, { type: 'bandpass', freq: 1900, q: 0.6, gain: 0.42 });
        const g = ctx.createGain();
        const o = osc('triangle', 200, t, t + 0.12, g);
        o.frequency.exponentialRampToValueAtTime(150, t + 0.1);
        env(g, t, 0.3, 0.001, 0.11);
        g.connect(out);
    };
    function snare(t, vel = 1) { oneShot('snare', 0.25, drawSnare, t, [[drumBus, vel], [reverbSend, 0.35 * vel]]); }

    const drawClap = (t, out) => { for (let i = 0; i < 3; i++) noise(t + i * 0.011, i === 2 ? 0.16 : 0.02, out, { type: 'bandpass', freq: 1300, q: 1.1, gain: 0.3 }); };
    function clap(t, vel = 1) { oneShot('clap', 0.25, drawClap, t, [[drumBus, vel], [reverbSend, 0.4 * vel]]); }

    const drawHat = open => (t, out) => noise(t, open ? 0.22 : 0.035, out, { freq: 7500, gain: open ? 0.12 : 0.1 });
    function hat(t, open = false, vel = 1) { oneShot(open ? 'hatO' : 'hatC', open ? 0.26 : 0.05, drawHat(open), t, [[drumBus, vel]]); }

    function tom(t, midi, vel = 1) {
        const g = ctx.createGain();
        const o = osc('sine', mtof(midi) * 1.6, t, t + 0.3, g);
        o.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.12);
        env(g, t, 0.5 * vel, 0.002, 0.28);
        g.connect(drumBus);
    }

    // sawtooth bass with a filter pluck and a sine sub
    function bass(t, midi, dur, { bright = 0.5, drive = 0 } = {}) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6 + drive * 6;
        const top = 300 + bright * 2600;
        f.frequency.setValueAtTime(top, t); f.frequency.exponentialRampToValueAtTime(140, t + Math.min(dur, 0.25));
        const g = ctx.createGain();
        const end = env(g, t, 0.22, 0.004, 0.12, 0.6, Math.max(0, dur - 0.14), 0.04);
        osc('sawtooth', mtof(midi), t, end, f, -7);
        osc('sawtooth', mtof(midi), t, end, f, 7);
        if (drive > 0) osc('square', mtof(midi), t, end, f);
        f.connect(g); g.connect(pumpGain);
        const sg = ctx.createGain();
        const send = env(sg, t, 0.28, 0.004, 0.1, 0.8, Math.max(0, dur - 0.12), 0.04);
        osc('sine', mtof(midi - 12), t, send, sg);
        sg.connect(pumpGain);
    }

    // 808-style sub with a pitch drop (desperate phase)
    function sub808(t, midi, dur) {
        const g = ctx.createGain();
        const o = osc('sine', mtof(midi) * 2, t, t + dur, g);
        o.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.06);
        env(g, t, 0.55, 0.003, dur);
        g.connect(drumBus);
    }

    function pad(t, midis, dur, { level = 0.05, cutoff = 1400 } = {}) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.5;
        const g = ctx.createGain();
        const a = Math.min(0.6, dur * 0.3);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(level, t + a);
        g.gain.setValueAtTime(level, t + dur - 0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
        for (const m of midis) for (const dt of [-9, 9]) osc('sawtooth', mtof(m), t, t + dur + 0.5, f, dt);
        f.connect(g); g.connect(pumpGain); g.connect(reverbSend);
    }

    const drawPluck = (midi, bright) => (t, out) => {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
        f.frequency.setValueAtTime(800 + bright * 4200, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.16);
        const g = ctx.createGain();
        const end = env(g, t, 1, 0.002, 0.2);
        osc('square', mtof(midi), t, end, f);
        osc('sawtooth', mtof(midi), t, end, f, 6);
        f.connect(g); g.connect(out);
    };
    function pluck(t, midi, { level = 0.09, bright = 0.6 } = {}) {
        const b = Math.round(bright * 3) / 3; // a few brightness steps keep the cache small
        oneShot(`pluck${midi}:${b}`, 0.25, drawPluck(midi, b), t, [[pumpGain, level], [delaySend, level]]);
    }

    function lead(t, midi, dur, { level = 0.07 } = {}) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200; f.Q.value = 1.5;
        const g = ctx.createGain();
        const end = env(g, t, level, 0.01, 0.08, 0.75, Math.max(0, dur - 0.1), 0.12);
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 5.5; lg.gain.value = 0;
        lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(dur > 0.4 ? 14 : 0, t + Math.min(dur, 0.5));
        lfo.connect(lg); lfo.start(t); lfo.stop(end + 0.02);
        for (const [type, dt] of [['sawtooth', -7], ['square', 7]]) { const o = osc(type, mtof(midi), t, end, f, dt); lg.connect(o.detune); }
        f.connect(g); g.connect(pumpGain); g.connect(delaySend); g.connect(reverbSend);
    }

    const drawBell = midi => (t, out) => {
        const g = ctx.createGain();
        env(g, t, 1, 0.002, 1.6);
        osc('sine', mtof(midi), t, t + 1.7, g);
        const g2 = ctx.createGain(); env(g2, t, 0.5, 0.002, 0.6);
        osc('sine', mtof(midi) * 2.76, t, t + 0.7, g2); g2.connect(g);
        g.connect(out);
    };
    function bell(t, midi, level = 0.08, dest = null) { oneShot(`bell${midi}`, 1.75, drawBell(midi), t, [[dest || pumpGain, level], [reverbSend, level]]); }

    const drawTick = accent => (t, out) => {
        noise(t, 0.012, out, { freq: accent ? 3000 : 5000, gain: accent ? 0.22 : 0.13 });
        const g = ctx.createGain(); env(g, t, accent ? 0.06 : 0.03, 0.001, 0.03);
        osc('sine', accent ? 1760 : 2637, t, t + 0.04, g); g.connect(out);
    };
    function tick(t, accent = false) { oneShot(accent ? 'tickA' : 'tick', 0.06, drawTick(accent), t, [[drumBus, 1]]); }

    function riser(t, dur, dest = drumBus, level = 0.16) {
        const n = noise(t, dur, dest, { type: 'bandpass', freq: 400, q: 2, gain: level, attack: dur * 0.95 });
        n.f.frequency.setValueAtTime(300, t); n.f.frequency.exponentialRampToValueAtTime(7000, t + dur);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level * 0.25, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.03);
        const o = osc('sawtooth', 110, t, t + dur, g); o.frequency.exponentialRampToValueAtTime(880, t + dur);
        g.connect(dest);
    }

    function impact(t, dest = drumBus, level = 1) {
        const g = ctx.createGain();
        const o = osc('sine', 90, t, t + 1.6, g); o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
        env(g, t, 0.9 * level, 0.003, 1.5); g.connect(dest);
        noise(t, 0.9, dest, { type: 'lowpass', freq: 900, gain: 0.45 * level });
        noise(t, 1.4, reverbSend, { type: 'lowpass', freq: 3000, gain: 0.25 * level });
    }

    const drawHeart = (t, out) => {
        for (const [dt, v] of [[0, 1], [0.16, 0.7]]) {
            const g = ctx.createGain(); const o = osc('sine', 70, t + dt, t + dt + 0.25, g);
            o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.2);
            env(g, t + dt, v, 0.004, 0.22); g.connect(out);
        }
    };
    function heartbeat(t, level = 0.6) { oneShot('heart', 0.45, drawHeart, t, [[drumBus, level]]); }

    // ============================================================ songs
    // Melodies are strings of 16th-note tokens: a number is a scale degree
    // (0 = key root, can go negative or past 7), '-' holds, '.' rests.

    const SCALES = {
        minor: [0, 2, 3, 5, 7, 8, 10],
        phrygian: [0, 1, 3, 5, 7, 8, 10],
        harmonic: [0, 2, 3, 5, 7, 8, 11],
        dorian: [0, 2, 3, 5, 7, 9, 10],
        major: [0, 2, 4, 5, 7, 9, 11]
    };
    const P = s => s.replace(/\s+/g, '').split('').map(Number); // drum pattern "1000 1000 ..."

    const SONGS = {
        'boss:raider': {
            bpm: 128, root: 45, scale: 'minor', prog: [0, 5, 3, 4],
            kick: P('1000 1000 1000 1000'), snare: P('0000 1000 0000 1000'), hat: P('0010 0010 0010 0010'),
            bass: [0, null, 12, 0, null, 0, 12, null, 0, null, 12, 0, null, 0, 7, 12],
            arp: [0, 1, 2, 3, 2, 1, 0, 2, 0, 1, 2, 3, 2, 3, 1, 2],
            lead: '4 - - 4 3 - 2 - 0 - - - 2 - 3 - | 5 - - 4 3 - - 2 0 - - - . . . . | 3 - - 3 2 - 3 - 5 - - - 4 - 3 - | 4 - - - 2 - - - 1 - - - -1 - - -'
        },
        'boss:enforcer': {
            bpm: 120, root: 38, scale: 'phrygian', prog: [0, 1, 0, 6], halftime: true,
            kick: P('1001 0010 1000 0010'), snare: P('0000 0000 1000 0000'), hat: P('1010 1010 1010 1010'),
            bass: [0, null, null, 0, null, null, 0, null, 0, null, 1, null, 0, null, null, null],
            arp: [0, null, 2, null, 1, null, 2, null, 0, null, 2, null, 3, null, 2, null],
            lead: '7 - - - - - 8 - 7 - - - 5 - - - | 8 - - - 7 - - - 5 - - - 4 - 5 - | 7 - - - - - 8 - 10 - - - 8 - 7 - | 5 - - - - - - - 4 - - - 3 - - -'
        },
        'boss:construct': {
            bpm: 134, root: 42, scale: 'harmonic', prog: [0, 5, 3, 4],
            kick: P('1000 1000 1000 1001'), snare: P('0000 1000 0000 1000'), hat: P('1011 1011 1011 1011'),
            bass: [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 7, 12, 7, 12],
            arp: [0, 2, 1, 3, 0, 2, 1, 3, 3, 1, 2, 0, 3, 1, 2, 0],
            lead: '4 - 6 - 7 - - - 6 - 4 - 2 - - - | 5 - 4 - 2 - - - 0 - - - . . . . | 3 - 5 - 7 - - - 8 - 7 - 5 - - - | 6 - - - 4 - - - 6 - - - 7 - - -'
        },
        'boss:omega': {
            bpm: 140, root: 36, scale: 'minor', prog: [0, 5, 2, 6],
            kick: P('1000 1000 1000 1000'), snare: P('0000 1000 0000 1000'), hat: P('0010 0010 0010 0011'),
            bass: [0, null, 0, 0, 12, null, 0, 0, null, 0, 12, 0, null, 0, 10, 12],
            arp: [0, 1, 2, 3, 1, 2, 3, 2, 0, 1, 2, 3, 2, 1, 2, 3],
            lead: '7 - - - 6 - 7 - 9 - - - 7 - - - | 8 - - - 7 - 5 - 4 - - - 2 - - - | 4 - - - 5 - 6 - 7 - - - 9 - 7 - | 8 - - - - - 7 - 6 - - - - - - -'
        },
        lobby: {
            bpm: 100, root: 45, scale: 'dorian', prog: [0, 3, 5, 4], chill: true,
            kick: P('1000 0000 1000 0000'), snare: P('0000 1000 0000 1000'), hat: P('0010 0010 0010 0010'),
            bass: [0, null, null, null, null, null, 0, null, null, null, 7, null, null, null, null, null],
            arp: [0, null, 2, 1, null, 3, null, 2, 0, null, 2, 1, null, 3, 2, null],
            lead: null
        },
        rest: {
            bpm: 96, root: 43, scale: 'major', prog: [0, 4, 5, 3], chill: true,
            kick: P('1000 0000 1000 0000'), snare: P('0000 1000 0000 1000'), hat: P('0010 0010 0010 0010'),
            bass: [0, null, null, null, null, null, 0, null, null, null, 7, null, null, null, null, null],
            arp: [0, 2, 3, 2, 1, 2, 3, 2, 0, 2, 3, 2, 1, 3, 2, 1],
            lead: null
        },
        puzzle: {
            bpm: 92, root: 38, scale: 'minor', prog: [0, 5, 3, 4], puzzle: true,
            kick: P('1000 0000 1000 0000'), snare: P('0000 0000 0000 0000'), hat: P('0000 0000 0000 0000'),
            bass: [0, null, 0, null, 0, null, 0, null, 0, null, 0, null, 0, null, 0, null],
            arp: [0, null, null, 2, null, null, 1, null, null, 3, null, null, 2, null, null, null],
            lead: null
        },
        victory: {
            bpm: 112, root: 48, scale: 'major', prog: [0, 4, 5, 3], victory: true,
            kick: P('1000 1000 1000 1000'), snare: P('0000 1000 0000 1000'), hat: P('0010 0010 0010 0010'),
            bass: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, null, 7, null],
            arp: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 1, 2, 3],
            lead: '4 - - - 4 - 5 - 7 - - - 4 - - - | 6 - - - 5 - 4 - 1 - - - . . . . | 5 - - - 5 - 6 - 7 - - - 9 - 8 - | 7 - - - - - - - 6 - - - 7 - - -'
        },
        defeat: {
            bpm: 70, root: 38, scale: 'minor', prog: [0, 5, 3, 4], defeat: true,
            kick: P('0000 0000 0000 0000'), snare: P('0000 0000 0000 0000'), hat: P('0000 0000 0000 0000'),
            bass: [0, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
            arp: [0, null, null, null, 2, null, null, null, 1, null, null, null, null, null, null, null],
            lead: null
        }
    };
    for (const s of Object.values(SONGS)) s.melody = s.lead ? parseMelody(s.lead) : null;

    function parseMelody(str) {
        const toks = str.replace(/\|/g, ' ').trim().split(/\s+/);
        const out = new Array(toks.length).fill(null);
        for (let i = 0; i < toks.length; i++) {
            if (toks[i] === '-' || toks[i] === '.') continue;
            let len = 1;
            while (toks[i + len] === '-') len++;
            out[i] = { deg: Number(toks[i]), len };
        }
        return out;
    }

    const degMidi = (song, deg, oct = 0) => {
        const sc = SCALES[song.scale];
        return song.root + sc[((deg % 7) + 7) % 7] + 12 * (Math.floor(deg / 7) + oct);
    };
    const chordMidis = (song, rootDeg, oct = 0) => [0, 2, 4, 7].map(k => degMidi(song, rootDeg + k, oct));

    // ============================================================ conductor

    const M = {
        song: null, name: null, step: 0, nextTime: 0, timer: null,
        phase: 'NORMAL', pendingPhase: null, building: false,
        intensity: 0.2, urgency: 0, muffled: false, stingers: []
    };
    const PHASE_TEMPO = { NORMAL: 1, ENRAGED: 1.06, DESPERATE: 1.12 };

    const stepDur = () => 60 / (M.song.bpm * (M.song.puzzle ? 1 + M.urgency * 0.25 : PHASE_TEMPO[M.phase] || 1)) / 4;

    function layers() {
        const s = M.song, i = M.intensity, ph = M.phase;
        if (s.chill || s.victory) return { kick: true, snare: true, hat: true, bass: true, arp: true, pad: true, lead: !!s.melody, sub: false, hat16: false, fills: s.victory };
        if (s.defeat) return { pad: true, arp: true, bass: true };
        if (s.puzzle) {
            const u = M.urgency;
            return { pad: true, bass: true, arp: u < 0.85, kick: u >= 0.55, ticks: true, heart: u >= 0.8 };
        }
        const hot = ph !== 'NORMAL';
        return {
            kick: true, bass: true, pad: true,
            hat: hot || i >= 0.2,
            snare: hot || i >= 0.4,
            arp: ph === 'DESPERATE' || i >= 0.6,
            lead: ph === 'DESPERATE' || (hot && i >= 0.55) || i >= 0.85,
            hat16: ph === 'DESPERATE' || (hot && i >= 0.7),
            fills: hot || i >= 0.5,
            sub: ph === 'DESPERATE',
            drive: ph === 'DESPERATE' ? 1 : ph === 'ENRAGED' ? 0.5 : 0
        };
    }

    function scheduleStep(t) {
        const s = M.song, st = M.step % 16, bar = Math.floor(M.step / 16), sd = stepDur();
        const chordDeg = s.prog[bar % s.prog.length];

        if (st === 0) {
            // phase change: one bar of build, then an impact on the downbeat
            if (M.building) {
                M.building = false;
                M.phase = M.pendingPhase; M.pendingPhase = null;
                impact(t, drumBus, 0.8);
            } else if (M.pendingPhase) {
                M.building = true;
            }
        }
        const L = layers();

        if (M.building) {
            if (st === 0) { riser(t, sd * 16); pad(t, chordMidis(s, chordDeg, 1), sd * 16, { level: 0.04, cutoff: 900 }); }
            const roll = st < 8 ? st % 4 === 0 : st < 12 ? st % 2 === 0 : true;
            if (roll) snare(t, 0.35 + (st / 16) * 0.65);
            if (st === 0) bass(t, degMidi(s, chordDeg) + 0, sd * 8, { bright: 0.2 });
            return;
        }

        // drums
        if (L.kick && s.kick[st]) kick(t, s.chill || s.puzzle ? 0.7 : 1);
        if (L.kick && s.puzzle && M.urgency >= 0.7 && st % 4 === 0) kick(t, 0.6);
        const fillBar = L.fills && bar % 4 === 3 && st >= 12;
        if (fillBar) { if (s.chill || s.victory) clap(t, 0.5 + (st - 12) * 0.12); else snare(t, 0.5 + (st - 12) * 0.15); }
        else if (L.snare && s.snare[st]) { s.halftime ? snare(t, 1) : (st === 12 && M.phase !== 'NORMAL' ? clap(t) : snare(t)); }
        if (L.hat16 && !fillBar) hat(t, st % 4 === 2, st % 2 ? 0.55 : 0.9);
        else if (L.hat && s.hat[st]) hat(t, st === 14 && bar % 2 === 1);
        if (L.sub && st === 0) sub808(t, degMidi(s, chordDeg) - 12, sd * 8);
        if (L.heart && st % 8 === 0) heartbeat(t, 0.5);
        if (L.ticks) {
            const every = M.urgency >= 0.75 ? 1 : M.urgency >= 0.4 ? 2 : 4;
            if (st % every === 0) tick(t, st % 4 === 0);
        }

        // bass
        if (L.bass) {
            const b = s.bass[st];
            if (b !== null && b !== undefined) {
                let len = 1; while (len < 4 && s.bass[(st + len) % 16] == null && st + len < 16) len++;
                const midi = degMidi(s, chordDeg) + b;
                if (s.defeat) bass(t, midi - 12, sd * 16, { bright: 0.05 });
                else if (s.puzzle) bass(t, midi, sd * 1.5, { bright: 0.12 + M.urgency * 0.3 });
                else bass(t, midi, sd * Math.min(len, s.chill ? 6 : 2), { bright: s.chill ? 0.2 : 0.35 + M.intensity * 0.3, drive: L.drive || 0 });
            }
        }

        // pad: one chord per bar
        if (L.pad && st === 0) {
            const level = s.puzzle ? 0.035 + M.urgency * 0.02 : s.chill ? 0.04 : s.defeat ? 0.05 : 0.028 + M.intensity * 0.012;
            pad(t, chordMidis(s, chordDeg, s.root < 40 ? 2 : 1), sd * 16, { level, cutoff: s.defeat ? 700 : 1200 + M.intensity * 1200 });
        }

        // arp
        if (L.arp) {
            const a = s.arp[st];
            if (a !== null && a !== undefined) {
                const midi = chordMidis(s, chordDeg, s.root < 40 ? 3 : 2)[a];
                if (s.puzzle || s.defeat) bell(t, midi, s.defeat ? 0.05 : 0.045);
                else pluck(t, midi + (M.phase === 'DESPERATE' ? 12 : 0), { level: s.chill ? 0.07 : 0.06, bright: 0.4 + M.intensity * 0.5 });
            }
        }

        // lead melody (4 bars)
        if (L.lead && s.melody) {
            const n = s.melody[(bar % 4) * 16 + st];
            if (n) lead(t, degMidi(s, n.deg, s.root < 40 ? 3 : 2) + (M.phase === 'DESPERATE' ? 12 : 0), n.len * sd, { level: s.victory ? 0.075 : 0.06 });
        }

        // stingers waiting for this step
        M.stingers = M.stingers.filter(x => { if (x.step <= M.step) { playStinger(x.kind, t); return false; } return true; });
    }

    function pump(until) {
        if (!ctx) return;
        while (M.song && M.nextTime < until) {
            scheduleStep(M.nextTime);
            M.nextTime += stepDur();
            M.step++;
        }
    }

    function startClock() {
        if (offline || M.timer) return;
        M.timer = setInterval(() => pump(ctx.currentTime + 0.15), 30);
    }
    function stopClock() { if (M.timer) { clearInterval(M.timer); M.timer = null; } }

    // Switch tracks. The old one rings out; the new one starts on a fresh bar.
    function music(name, opts = {}) {
        if (!ctx) init();
        if (!ctx) return;
        if (name === M.name && M.song && !opts.restart) { if (opts.phase) setPhase(opts.phase); if (opts.intensity != null) M.intensity = opts.intensity; return; }
        M.name = name;
        M.song = name ? SONGS[name] : null;
        M.phase = opts.phase || 'NORMAL'; M.pendingPhase = null; M.building = false;
        M.intensity = opts.intensity ?? 0.2; M.urgency = 0; M.stingers = [];
        M.step = 0;
        if (!M.song || muted || musicMuted) { stopClock(); return; }
        M.nextTime = opts.at ?? ctx.currentTime + 0.08;
        delay.delayTime.setValueAtTime(stepDur() * 3, ctx.currentTime); // dotted-8th echo in time with the song
        if (opts.stinger) playStinger(opts.stinger, ctx.currentTime + 0.02);
        startClock();
    }

    function stopMusic() { M.name = null; M.song = null; stopClock(); }

    // Back-compat: NORMAL/ENRAGED/DESPERATE changes phase; anything else stops.
    function setPhase(phase) {
        if (!['NORMAL', 'ENRAGED', 'DESPERATE'].includes(phase)) return stopMusic();
        if (!M.song) return;
        // phases only escalate during a fight (a new track resets to NORMAL)
        const rank = { NORMAL: 0, ENRAGED: 1, DESPERATE: 2 };
        if (rank[phase] <= Math.max(rank[M.phase], rank[M.pendingPhase] ?? -1)) return;
        M.pendingPhase = phase;
    }

    function setIntensity(x) { M.intensity = Math.max(0, Math.min(1, x)); }
    function setUrgency(x) { M.urgency = Math.max(0, Math.min(1, x)); }

    function muffle(on) {
        if (!ctx) return;
        const t = ctx.currentTime;
        M.muffled = on;
        musicFilter.frequency.cancelScheduledValues(t);
        musicFilter.frequency.setValueAtTime(musicFilter.frequency.value, t);
        musicFilter.frequency.exponentialRampToValueAtTime(on ? 420 : 20000, t + (on ? 0.4 : 0.8));
    }

    function duck(amount = 0.35, seconds = 1.2) {
        if (!ctx) return;
        const t = ctx.currentTime;
        duckGain.gain.cancelScheduledValues(t);
        duckGain.gain.setValueAtTime(duckGain.gain.value, t);
        duckGain.gain.linearRampToValueAtTime(amount, t + 0.08);
        duckGain.gain.setValueAtTime(amount, t + seconds);
        duckGain.gain.linearRampToValueAtTime(1, t + seconds + 0.5);
    }

    // Stingers land on the next 8th note so they feel part of the music.
    function stinger(kind) {
        if (!ctx || muted) return;
        ensureCtx();
        if (M.song && !musicMuted && !offline) {
            let s = M.step; while (s % 2) s++;
            M.stingers.push({ kind, step: s });
        } else playStinger(kind, ctx.currentTime + 0.01);
    }
    function stingerAt(kind, t) { playStinger(kind, t); } // offline rendering

    function playStinger(kind, t) {
        const s = M.song || SONGS['boss:raider'];
        const deg = s.prog[Math.floor(M.step / 16) % s.prog.length];
        const stab = (midis, level = 0.09) => {
            for (const m of midis) {
                const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(6000, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.6);
                const g = ctx.createGain(); env(g, t, level, 0.003, 0.9);
                for (const dt of [-12, 0, 12]) osc('sawtooth', mtof(m), t, t + 0.95, f, dt);
                f.connect(g); g.connect(sfxGain); g.connect(reverbSend);
            }
        };
        switch (kind) {
            case 'ult':
                impact(t, sfxGain, 0.7);
                stab(chordMidis(s, deg, s.root < 40 ? 2 : 1), 0.06);
                break;
            case 'combo':
                impact(t, sfxGain, 0.9); impact(t + 0.18, sfxGain, 0.6);
                [0, 1, 2, 3, 4, 5, 6, 7].forEach(k => pluckTo(t + k * 0.04, degMidi(s, deg + k, 2)));
                stab(chordMidis(s, deg, 2), 0.06);
                break;
            case 'hero': {
                duck(0.3, 1.6);
                const maj = SCALES.major, base = s.root + 24;
                stab([base, base + maj[2], base + maj[4], base + 12], 0.07);
                [0, 2, 4, 7, 9, 11, 14].forEach((k, i) => bellTo(t + 0.08 + i * 0.06, base + 12 + (maj[k % 7] + 12 * Math.floor(k / 7)), 0.06));
                break;
            }
            case 'bossDown':
                impact(t, sfxGain, 1.1);
                stab(chordMidis(s, s.prog[0], 1), 0.07);
                for (let k = 0; k < 6; k++) bellTo(t + 0.25 + k * 0.09, degMidi(s, 7 - k, 2), 0.05);
                break;
            case 'wipe': {
                const g = ctx.createGain(); env(g, t, 0.3, 0.02, 3);
                const o = osc('sawtooth', mtof(s.root), t, t + 3, g); o.frequency.exponentialRampToValueAtTime(mtof(s.root - 12), t + 2.5);
                const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
                g.connect(f); f.connect(sfxGain); f.connect(reverbSend);
                impact(t, sfxGain, 0.8);
                break;
            }
            case 'telegraph':
                duck(0.45, 1.0);
                for (const dt of [0, 0.22]) { const g = ctx.createGain(); env(g, t + dt, 0.16, 0.005, 0.18); osc('square', 220, t + dt, t + dt + 0.2, g); osc('square', 233, t + dt, t + dt + 0.2, g); g.connect(sfxGain); }
                break;
            case 'solve':
                impact(t, sfxGain, 0.6);
                [0, 2, 4, 7, 9, 11, 14].forEach((k, i) => bellTo(t + i * 0.07, s.root + 36 + SCALES.major[k % 7] + 12 * Math.floor(k / 7), 0.07));
                break;
            case 'fail': {
                const g = ctx.createGain(); env(g, t, 0.22, 0.01, 1.4);
                for (const m of [s.root + 12, s.root + 13, s.root + 18]) { const o = osc('sawtooth', mtof(m + 12), t, t + 1.4, g); o.frequency.exponentialRampToValueAtTime(mtof(m), t + 1.2); }
                const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
                g.connect(f); f.connect(sfxGain); f.connect(reverbSend);
                impact(t + 0.05, sfxGain, 0.5);
                break;
            }
        }
    }
    const pluckTo = (t, midi) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 4000; const g = ctx.createGain(); env(g, t, 0.06, 0.002, 0.18); osc('square', mtof(midi), t, t + 0.2, f); f.connect(g); g.connect(sfxGain); g.connect(delaySend); };
    const bellTo = (t, midi, level) => bell(t, midi, level, sfxGain);

    // ============================================================ sound effects
    // (kept from the original game, now on cached noise)

    function playTone(freq, duration, type = 'square', gain = 0.15, dest = sfxGain, startTime = null) {
        if (!ctx || muted) return;
        const t = startTime || ctx.currentTime;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + duration);
        osc(type, freq, t, t + duration, g);
        g.connect(dest);
    }
    function playNoise(duration, gain = 0.1, dest = sfxGain, startTime = null, highpass = 0) {
        if (!ctx || muted) return;
        noise(startTime || ctx.currentTime, duration, dest, { type: highpass ? 'highpass' : 'allpass', freq: highpass || 1000, gain });
    }
    const ready = () => { ensureCtx(); return ctx && !muted; };

    function sfxCorrect() { if (!ready()) return; const t = ctx.currentTime; playTone(523, 0.08, 'square', 0.12, sfxGain, t); playTone(659, 0.08, 'square', 0.12, sfxGain, t + 0.06); playTone(784, 0.15, 'square', 0.12, sfxGain, t + 0.12); }
    function sfxWrong() { if (!ready()) return; const t = ctx.currentTime; playTone(200, 0.15, 'sawtooth', 0.12, sfxGain, t); playTone(150, 0.25, 'sawtooth', 0.1, sfxGain, t + 0.1); }
    function sfxHit(damage = 800) {
        if (!ready()) return;
        const t = ctx.currentTime, k = Math.min(1, damage / 5000);
        playNoise(0.06 + k * 0.08, 0.08 + k * 0.1, sfxGain, t, 1000);
        playTone(100 + k * 200, 0.08, 'sawtooth', 0.08 + k * 0.08, sfxGain, t);
    }
    function sfxUltimate() {
        if (!ready()) return;
        const t = ctx.currentTime;
        playTone(880, 0.06, 'square', 0.08, sfxGain, t); playTone(1320, 0.04, 'square', 0.06, sfxGain, t + 0.04);
        const g = ctx.createGain(); const o = osc('sine', 200, t + 0.1, t + 0.4, g); o.frequency.exponentialRampToValueAtTime(30, t + 0.35);
        g.gain.setValueAtTime(0.35, t + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4); g.connect(sfxGain);
        playNoise(0.1, 0.2, sfxGain, t + 0.1, 800);
        playTone(1047, 0.3, 'square', 0.08, sfxGain, t + 0.12); playTone(1568, 0.25, 'square', 0.05, sfxGain, t + 0.14); playTone(2093, 0.2, 'sine', 0.04, sfxGain, t + 0.16);
    }
    function sfxHeal() { if (!ready()) return; const t = ctx.currentTime; [440, 554, 659, 880].forEach((f, i) => playTone(f, i === 3 ? 0.2 : 0.1, 'sine', 0.08, sfxGain, t + i * 0.08)); }
    function sfxShield() { if (!ready()) return; const t = ctx.currentTime; playTone(300, 0.15, 'triangle', 0.1, sfxGain, t); playTone(450, 0.2, 'triangle', 0.08, sfxGain, t + 0.08); }
    function sfxBuff() { if (!ready()) return; const t = ctx.currentTime; [330, 440, 550].forEach((f, i) => playTone(f, i === 2 ? 0.12 : 0.08, 'square', 0.06, sfxGain, t + i * 0.06)); }
    function sfxBossDamage() { if (!ready()) return; playNoise(0.15, 0.12, sfxGain, null, 500); playTone(80, 0.2, 'sawtooth', 0.1); }
    function sfxStreak() { if (!ready()) return; const t = ctx.currentTime; [523, 659, 784].forEach((f, i) => playTone(f, 0.06, 'square', 0.1, sfxGain, t + i * 0.05)); playTone(1047, 0.2, 'square', 0.12, sfxGain, t + 0.15); }
    function sfxVictory() {
        if (!ready()) return;
        const t = ctx.currentTime;
        const notes = [523, 523, 523, 659, 784, 784, 659, 784, 1047], times = [0, 0.12, 0.24, 0.36, 0.48, 0.72, 0.96, 1.08, 1.2], durs = [0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.1, 0.1, 0.6];
        notes.forEach((n, i) => playTone(n, durs[i], 'square', 0.1, sfxGain, t + times[i]));
    }
    function sfxDefeat() { if (!ready()) return; const t = ctx.currentTime; [400, 350, 300].forEach((f, i) => playTone(f, 0.3, 'sawtooth', 0.1, sfxGain, t + i * 0.3)); playTone(200, 0.6, 'sawtooth', 0.12, sfxGain, t + 0.9); }
    function sfxWaveClear() { if (!ready()) return; const t = ctx.currentTime; [440, 554, 659].forEach((f, i) => playTone(f, 0.1, 'square', 0.08, sfxGain, t + i * 0.1)); playTone(880, 0.3, 'triangle', 0.1, sfxGain, t + 0.3); }
    function sfxPuzzleSolve() { if (!ready()) return; const t = ctx.currentTime; [523, 587, 659, 784, 880, 1047].forEach((n, i) => playTone(n, 0.15, 'sine', 0.08, sfxGain, t + i * 0.07)); }
    function sfxCountdown() { if (!ready()) return; playTone(880, 0.08, 'square', 0.08); }
    function sfxAchievement() {
        if (!ready()) return;
        const t = ctx.currentTime;
        playTone(1047, 0.06, 'sine', 0.06, sfxGain, t); playTone(1319, 0.06, 'sine', 0.06, sfxGain, t + 0.04); playTone(1568, 0.06, 'sine', 0.07, sfxGain, t + 0.08);
        playTone(784, 0.25, 'triangle', 0.08, sfxGain, t + 0.15); playTone(1047, 0.25, 'triangle', 0.06, sfxGain, t + 0.15); playTone(1568, 0.3, 'sine', 0.05, sfxGain, t + 0.15);
    }
    function sfxBossIntro() {
        if (!ready()) return;
        const t = ctx.currentTime;
        riser(t, 1.0, sfxGain, 0.12);
        playTone(80, 0.8, 'sawtooth', 0.06, sfxGain, t); playTone(110, 0.6, 'sawtooth', 0.05, sfxGain, t + 0.3); playTone(147, 0.5, 'sawtooth', 0.05, sfxGain, t + 0.6);
        impact(t + 1.0, sfxGain, 0.9);
    }
    function sfxBossDeath() {
        if (!ready()) return;
        const t = ctx.currentTime;
        [440, 330, 220, 110].forEach((f, i) => playTone(f, 0.15 + i * 0.05, 'sawtooth', 0.08 - i * 0.005, sfxGain, t + [0, 0.1, 0.2, 0.35][i]));
        playTone(55, 0.5, 'square', 0.1, sfxGain, t + 0.5);
    }
    function sfxTaunt() { if (!ready()) return; const t = ctx.currentTime; [330, 294, 262].forEach((f, i) => playTone(f, 0.12, 'square', 0.05, sfxGain, t + i * 0.15)); playTone(220, 0.2, 'triangle', 0.06, sfxGain, t + 0.45); }

    // ============================================================ controls

    function toggleMute() {
        muted = !muted;
        if (muted) stopClock();
        else if (M.song && !musicMuted && ctx) { M.nextTime = ctx.currentTime + 0.05; startClock(); }
        return muted;
    }
    function toggleMusic() {
        musicMuted = !musicMuted;
        if (musicMuted) stopClock();
        else if (M.song && !muted && ctx) { M.nextTime = ctx.currentTime + 0.05; startClock(); }
        return musicMuted;
    }
    function pauseMusic() { stopClock(); }
    function resumeMusic() { if (M.song && !muted && !musicMuted && ctx) { M.nextTime = ctx.currentTime + 0.05; startClock(); } }
    function setVolume(v) { if (master) master.gain.value = Math.max(0, Math.min(1, v)); }
    function isMuted() { return muted; }
    function state() { return { track: M.name, phase: M.phase, pending: M.pendingPhase, building: M.building, intensity: M.intensity, urgency: M.urgency, step: M.step }; }

    return {
        init, ensureCtx, attach, pump,
        music, stopMusic, setPhase, setIntensity, setUrgency, stinger, stingerAt, muffle, duck, pauseMusic, resumeMusic, state,
        sfxCorrect, sfxWrong, sfxHit, sfxUltimate, sfxHeal, sfxShield, sfxBuff,
        sfxBossDamage, sfxStreak, sfxVictory, sfxDefeat, sfxWaveClear,
        sfxPuzzleSolve, sfxCountdown, sfxAchievement, sfxBossIntro, sfxBossDeath, sfxTaunt,
        toggleMute, toggleMusic, setVolume, isMuted,
        SONGS: Object.keys(SONGS),
        _debug: () => ({ ctx, reverb, reverbSend, delay, delaySend, comp, master, musicBus })
    };
})();
