// Fair play: the projector is the referee. Everything a Chromebook sends is a
// request the host checks here before the game acts on it, so a script, an
// auto-clicker or a bot flood can't do anything a real student couldn't.
//
// Pure: no Firebase, no DOM. `G` is the guard's state, kept by the host.

export const LIMITS = {
    maxPlayers: 60,         // a full class plus room to spare; past this the lobby locks itself
    minAnswerGapMs: 1000,   // a real student can't read, tap, act and read again faster than this
    answerBurst: 5,         // answers allowed back to back...
    answerRefillMs: 2500,   // ...then one more every 2.5s (24 a minute, far above a real pace)
    maxIntentsPerBatch: 12, // more than this arriving at once is a script, not a student
    calloutGapMs: 4000,
    puzzleGapMs: 250,
    flagAfter: 3            // blocked attempts before the teacher is warned
};

export function createGuard() {
    return { p: {} };
}

const slot = (G, pid) => (G.p[pid] ||= { tokens: LIMITS.answerBurst, refillAt: 0, lastAnswer: -1e12, lastCallout: -1e12, lastPuzzle: -1e12, blocked: 0, flagged: false });

function strike(G, pid, reason) {
    const s = slot(G, pid);
    s.blocked++;
    const newlyFlagged = !s.flagged && s.blocked >= LIMITS.flagAfter;
    if (newlyFlagged) s.flagged = true;
    return { ok: false, reason, flagged: newlyFlagged };
}

export const isFlagged = (G, pid) => !!G.p[pid]?.flagged;

const isIndex = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
const ABILITIES = new Set(['basic', 'special', 'ult']);

// Is this intent well-formed? (Anything else is dropped silently.)
export function validIntent(it, { questions, players }) {
    if (!it || typeof it !== 'object' || typeof it.t !== 'string') return false;
    switch (it.t) {
        case 'a': {
            const q = isIndex(it.q, questions.length) && questions[it.q];
            return !!q && isIndex(it.p, q.answers.length) && (it.n === undefined || (typeof it.n === 'string' && it.n.length <= 16));
        }
        case 'x': return ABILITIES.has(it.ab) && (it.tg == null || (typeof it.tg === 'string' && !!players[it.tg]));
        case 'c': return ['heal', 'shield', 'ult'].includes(it.k);
        case 'v': return typeof it.perk === 'string' && it.perk.length <= 32;
        case 'p': return typeof it.a === 'string' && it.a.length <= 12;
        default: return false;
    }
}

// Rate limits per kind of intent. Returns { ok } or { ok: false, reason, flagged }.
export function allow(G, pid, it, now) {
    const s = slot(G, pid);
    if (it.t === 'a') {
        // refill the bucket
        if (s.tokens < LIMITS.answerBurst) {
            const gained = Math.floor((now - s.refillAt) / LIMITS.answerRefillMs);
            if (gained > 0) { s.tokens = Math.min(LIMITS.answerBurst, s.tokens + gained); s.refillAt += gained * LIMITS.answerRefillMs; }
        }
        if (now - s.lastAnswer < LIMITS.minAnswerGapMs) return strike(G, pid, 'too fast');
        if (s.tokens <= 0) return strike(G, pid, 'too fast');
        if (s.tokens === LIMITS.answerBurst) s.refillAt = now;
        s.tokens--;
        s.lastAnswer = now;
        return { ok: true };
    }
    if (it.t === 'c') {
        if (now - s.lastCallout < LIMITS.calloutGapMs) return { ok: false, reason: 'callout cooldown' }; // harmless, not a strike
        s.lastCallout = now;
        return { ok: true };
    }
    if (it.t === 'p') {
        if (now - s.lastPuzzle < LIMITS.puzzleGapMs) return strike(G, pid, 'too fast');
        s.lastPuzzle = now;
        return { ok: true };
    }
    return { ok: true }; // actions need a right answer first (engine), votes count once
}

// A flood of intents in one update: keep the first few, drop the rest
export function capBatch(G, pid, keys) {
    if (keys.length <= LIMITS.maxIntentsPerBatch) return { keep: keys, dropped: 0, flagged: false };
    const r = strike(G, pid, 'flood');
    return { keep: keys.slice(0, LIMITS.maxIntentsPerBatch), dropped: keys.length - LIMITS.maxIntentsPerBatch, flagged: r.flagged };
}

// Display names: plain text, trimmed, never empty
export function cleanName(name) {
    const n = String(name ?? '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    return n || 'Student';
}
