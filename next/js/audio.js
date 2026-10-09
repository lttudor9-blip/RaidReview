// Procedural music and sound effects (Web Audio, no files).
// Carried over from the original game; exposed as a module.

export const AudioEngine = (() => {
    let ctx = null, masterGain = null, musicGain = null, sfxGain = null;
    let muted = false, musicMuted = false;
    let currentLoop = null, currentPhase = 'idle';
    let schedulerTimer = null, nextNoteTime = 0, currentStep = 0;
    let tempo = 130; // BPM
    const STEP_COUNT = 16;
    
    // Musical scales (in semitones from root)
    const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // Natural minor
    const ROOT = 55; // A1 in Hz
    
    function noteFreq(semitones) { return ROOT * Math.pow(2, semitones / 12); }
    function scaleNote(degree, octave = 0) { return noteFreq(MINOR_SCALE[degree % 7] + Math.floor(degree / 7) * 12 + octave * 12); }
    
    function init() {
        if (ctx) return;
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = ctx.createGain(); masterGain.gain.value = 0.5; masterGain.connect(ctx.destination);
            musicGain = ctx.createGain(); musicGain.gain.value = 0.35; musicGain.connect(masterGain);
            sfxGain = ctx.createGain(); sfxGain.gain.value = 0.6; sfxGain.connect(masterGain);
        } catch(e) { console.warn('Audio not supported'); }
    }
    
    function ensureCtx() { if (!ctx) init(); if (ctx?.state === 'suspended') ctx.resume(); }
    
    // === SYNTH PRIMITIVES ===
    function playTone(freq, duration, type = 'square', gain = 0.15, dest = sfxGain, startTime = null) {
        if (!ctx || muted) return;
        const t = startTime || ctx.currentTime;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + duration);
        osc.connect(g); g.connect(dest);
        osc.start(t); osc.stop(t + duration);
    }
    
    function playNoise(duration, gain = 0.1, dest = sfxGain, startTime = null, highpass = 0) {
        if (!ctx || muted) return;
        const t = startTime || ctx.currentTime;
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + duration);
        
        if (highpass > 0) {
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass'; hp.frequency.value = highpass;
            src.connect(hp); hp.connect(g);
        } else {
            src.connect(g);
        }
        g.connect(dest);
        src.start(t); src.stop(t + duration);
    }
    
    function playKick(startTime = null) {
        if (!ctx || muted) return;
        const t = startTime || ctx.currentTime;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(0.4, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(g); g.connect(musicGain);
        osc.start(t); osc.stop(t + 0.2);
    }
    
    function playSnare(startTime = null) {
        if (!ctx || muted) return;
        const t = startTime || ctx.currentTime;
        // Noise burst
        playNoise(0.12, 0.15, musicGain, t, 2000);
        // Tone body
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, t);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.connect(g); g.connect(musicGain);
        osc.start(t); osc.stop(t + 0.08);
    }
    
    function playHihat(open = false, startTime = null) {
        if (!ctx || muted) return;
        playNoise(open ? 0.15 : 0.05, open ? 0.08 : 0.05, musicGain, startTime, 8000);
    }
    
    // === MUSIC PATTERNS ===
    // Each pattern is 16 steps. 1 = play, 0 = rest
    const PATTERNS = {
        battle_normal: {
            kick:   [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,1],
            snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
            hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
            hhOpen: [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0],
            bass:   [0,3,0,3, 0,3,0,3, 5,3,0,3, 0,3,2,3], // scale degrees
            lead:   [7,0,0,10, 0,0,7,0, 5,0,0,3, 0,0,5,0],
            tempo: 130
        },
        battle_enraged: {
            kick:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
            snare:  [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,1,0],
            hihat:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
            hhOpen: [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,1,0],
            bass:   [0,0,5,0, 3,0,0,5, 0,0,7,0, 5,3,0,2],
            lead:   [10,0,12,0, 10,0,7,0, 8,0,10,0, 7,0,5,0],
            tempo: 150
        },
        battle_desperate: {
            kick:   [1,0,1,0, 1,1,1,0, 1,0,1,0, 1,1,1,1],
            snare:  [0,0,1,0, 1,0,0,1, 0,0,1,0, 1,0,1,1],
            hihat:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
            hhOpen: [0,0,0,1, 0,0,1,0, 0,0,0,1, 0,1,0,0],
            bass:   [0,5,0,3, 7,0,5,0, 0,7,0,5, 3,0,2,0],
            lead:   [12,0,14,12, 0,10,0,12, 14,0,12,10, 0,7,10,0],
            tempo: 165
        }
    };
    
    function scheduleStep(pattern, step, time) {
        if (!ctx || musicMuted || muted) return;
        const p = pattern;
        const stepSec = 60 / (p.tempo * 4); // 16th note duration
        
        // Drums
        if (p.kick[step]) playKick(time);
        if (p.snare[step]) playSnare(time);
        if (p.hihat[step]) playHihat(false, time);
        if (p.hhOpen[step]) playHihat(true, time);
        
        // Bass (sawtooth, low octave)
        if (p.bass[step] > 0) {
            playTone(scaleNote(p.bass[step], 1), stepSec * 1.5, 'sawtooth', 0.08, musicGain, time);
        }
        
        // Lead (square, higher octave) - only on some phases
        if (p.lead[step] > 0) {
            playTone(scaleNote(p.lead[step], 2), stepSec * 0.8, 'square', 0.04, musicGain, time);
        }
    }
    
    function startMusic(phaseName) {
        ensureCtx();
        if (!ctx) return;
        const pattern = PATTERNS[phaseName];
        if (!pattern) return;
        
        // If already playing this phase, don't restart
        if (currentPhase === phaseName && schedulerTimer) return;
        
        stopMusic();
        currentPhase = phaseName;
        tempo = pattern.tempo;
        currentStep = 0;
        nextNoteTime = ctx.currentTime + 0.05;
        
        // Lookahead scheduler (runs ahead of audio clock for tight timing)
        function scheduler() {
            const scheduleAhead = 0.1; // seconds
            while (nextNoteTime < ctx.currentTime + scheduleAhead) {
                scheduleStep(pattern, currentStep % STEP_COUNT, nextNoteTime);
                nextNoteTime += 60 / (tempo * 4); // 16th note
                currentStep++;
            }
        }
        
        schedulerTimer = setInterval(scheduler, 25);
    }
    
    function stopMusic() {
        if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
        currentPhase = 'idle';
        currentStep = 0;
    }
    
    function setPhase(phase) {
        if (musicMuted || muted) return;
        const map = {
            'NORMAL': 'battle_normal',
            'ENRAGED': 'battle_enraged', 
            'DESPERATE': 'battle_desperate',
            'LOBBY': null,
            'PAUSED': null,
            'WAVE_CLEAR': null,
            'VICTORY': null,
            'DEFEAT': null
        };
        const target = map[phase];
        if (target) startMusic(target);
        else stopMusic();
    }
    
    // === SOUND EFFECTS ===
    function sfxCorrect() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        playTone(523, 0.08, 'square', 0.12, sfxGain, t);        // C5
        playTone(659, 0.08, 'square', 0.12, sfxGain, t + 0.06); // E5
        playTone(784, 0.15, 'square', 0.12, sfxGain, t + 0.12); // G5
    }
    
    function sfxWrong() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        playTone(200, 0.15, 'sawtooth', 0.12, sfxGain, t);
        playTone(150, 0.25, 'sawtooth', 0.1, sfxGain, t + 0.1);
    }
    
    function sfxHit(damage = 800) {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        const intensity = Math.min(1, damage / 5000);
        playNoise(0.06 + intensity * 0.08, 0.08 + intensity * 0.1, sfxGain, t, 1000);
        playTone(100 + intensity * 200, 0.08, 'sawtooth', 0.08 + intensity * 0.08, sfxGain, t);
    }
    
    function sfxUltimate() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        // Quick charge-up chirp (tiny anticipation)
        playTone(880, 0.06, 'square', 0.08, sfxGain, t);
        playTone(1320, 0.04, 'square', 0.06, sfxGain, t + 0.04);
        // SLAM - heavy low-end impact at t+0.1
        const kick = ctx.createOscillator();
        const kg = ctx.createGain();
        kick.type = 'sine';
        kick.frequency.setValueAtTime(200, t + 0.1);
        kick.frequency.exponentialRampToValueAtTime(30, t + 0.35);
        kg.gain.setValueAtTime(0.35, t + 0.1);
        kg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        kick.connect(kg); kg.connect(sfxGain);
        kick.start(t + 0.1); kick.stop(t + 0.4);
        // Noise burst (crunch)
        playNoise(0.1, 0.2, sfxGain, t + 0.1, 800);
        // High sparkle ring-out (the satisfying part)
        playTone(1047, 0.3, 'square', 0.08, sfxGain, t + 0.12);
        playTone(1568, 0.25, 'square', 0.05, sfxGain, t + 0.14);
        playTone(2093, 0.2, 'sine', 0.04, sfxGain, t + 0.16);
    }
    
    function sfxHeal() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        playTone(440, 0.1, 'sine', 0.08, sfxGain, t);
        playTone(554, 0.1, 'sine', 0.08, sfxGain, t + 0.08);
        playTone(659, 0.1, 'sine', 0.08, sfxGain, t + 0.16);
        playTone(880, 0.2, 'sine', 0.08, sfxGain, t + 0.24);
    }
    
    function sfxShield() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        playTone(300, 0.15, 'triangle', 0.1, sfxGain, t);
        playTone(450, 0.2, 'triangle', 0.08, sfxGain, t + 0.08);
    }
    
    function sfxBuff() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        playTone(330, 0.08, 'square', 0.06, sfxGain, t);
        playTone(440, 0.08, 'square', 0.06, sfxGain, t + 0.06);
        playTone(550, 0.12, 'square', 0.06, sfxGain, t + 0.12);
    }
    
    function sfxBossDamage() {
        ensureCtx(); if (!ctx || muted) return;
        playNoise(0.15, 0.12, sfxGain, null, 500);
        playTone(80, 0.2, 'sawtooth', 0.1);
    }
    
    function sfxStreak() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        playTone(523, 0.06, 'square', 0.1, sfxGain, t);
        playTone(659, 0.06, 'square', 0.1, sfxGain, t + 0.05);
        playTone(784, 0.06, 'square', 0.1, sfxGain, t + 0.1);
        playTone(1047, 0.2, 'square', 0.12, sfxGain, t + 0.15);
    }
    
    function sfxVictory() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        const notes = [523, 523, 523, 659, 784, 784, 659, 784, 1047];
        const times = [0, 0.12, 0.24, 0.36, 0.48, 0.72, 0.96, 1.08, 1.2];
        const durs  = [0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.1, 0.1, 0.6];
        notes.forEach((n, i) => playTone(n, durs[i], 'square', 0.1, sfxGain, t + times[i]));
    }
    
    function sfxDefeat() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        playTone(400, 0.3, 'sawtooth', 0.1, sfxGain, t);
        playTone(350, 0.3, 'sawtooth', 0.1, sfxGain, t + 0.3);
        playTone(300, 0.3, 'sawtooth', 0.1, sfxGain, t + 0.6);
        playTone(200, 0.6, 'sawtooth', 0.12, sfxGain, t + 0.9);
    }
    
    function sfxWaveClear() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        playTone(440, 0.1, 'square', 0.08, sfxGain, t);
        playTone(554, 0.1, 'square', 0.08, sfxGain, t + 0.1);
        playTone(659, 0.1, 'square', 0.08, sfxGain, t + 0.2);
        playTone(880, 0.3, 'triangle', 0.1, sfxGain, t + 0.3);
    }
    
    function sfxPuzzleSolve() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        [523, 587, 659, 784, 880, 1047].forEach((n, i) => {
            playTone(n, 0.15, 'sine', 0.08, sfxGain, t + i * 0.07);
        });
    }
    
    function sfxCountdown() {
        ensureCtx(); if (!ctx || muted) return;
        playTone(880, 0.08, 'square', 0.08);
    }
    
    function sfxAchievement() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        // Distinctive 2-part: quick shimmer + satisfying lock-in tone
        playTone(1047, 0.06, 'sine', 0.06, sfxGain, t);
        playTone(1319, 0.06, 'sine', 0.06, sfxGain, t + 0.04);
        playTone(1568, 0.06, 'sine', 0.07, sfxGain, t + 0.08);
        // Lock-in chord
        playTone(784, 0.25, 'triangle', 0.08, sfxGain, t + 0.15);
        playTone(1047, 0.25, 'triangle', 0.06, sfxGain, t + 0.15);
        playTone(1568, 0.3, 'sine', 0.05, sfxGain, t + 0.15);
    }
    
    function sfxBossIntro() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        // Deep ominous rising tone
        playTone(80, 0.8, 'sawtooth', 0.06, sfxGain, t);
        playTone(110, 0.6, 'sawtooth', 0.05, sfxGain, t + 0.3);
        playTone(147, 0.5, 'sawtooth', 0.05, sfxGain, t + 0.6);
        // Impact hit
        playTone(55, 0.3, 'square', 0.1, sfxGain, t + 0.9);
        playTone(65, 0.3, 'sawtooth', 0.08, sfxGain, t + 0.9);
    }
    
    function sfxBossDeath() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        // Descending destruction
        playTone(440, 0.15, 'sawtooth', 0.08, sfxGain, t);
        playTone(330, 0.15, 'sawtooth', 0.07, sfxGain, t + 0.1);
        playTone(220, 0.2, 'sawtooth', 0.07, sfxGain, t + 0.2);
        playTone(110, 0.3, 'sawtooth', 0.06, sfxGain, t + 0.35);
        playTone(55, 0.5, 'square', 0.1, sfxGain, t + 0.5);
    }
    
    function sfxTaunt() {
        ensureCtx(); if (!ctx || muted) return;
        const t = ctx.currentTime;
        // Evil laugh-like descending notes
        playTone(330, 0.12, 'square', 0.05, sfxGain, t);
        playTone(294, 0.12, 'square', 0.05, sfxGain, t + 0.15);
        playTone(262, 0.15, 'square', 0.05, sfxGain, t + 0.3);
        playTone(220, 0.2, 'triangle', 0.06, sfxGain, t + 0.45);
    }
    
    // === CONTROLS ===
    function toggleMute() { muted = !muted; if (muted) stopMusic(); return muted; }
    function toggleMusic() { musicMuted = !musicMuted; if (musicMuted) stopMusic(); return musicMuted; }
    function setVolume(v) { if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v)); }
    function isMuted() { return muted; }
    
    return {
        init, ensureCtx, setPhase, stopMusic,
        sfxCorrect, sfxWrong, sfxHit, sfxUltimate, sfxHeal, sfxShield, sfxBuff,
        sfxBossDamage, sfxStreak, sfxVictory, sfxDefeat, sfxWaveClear,
        sfxPuzzleSolve, sfxCountdown, sfxAchievement, sfxBossIntro, sfxBossDeath, sfxTaunt,
        toggleMute, toggleMusic, setVolume, isMuted
    };
})();
