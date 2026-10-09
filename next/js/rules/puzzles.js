// Raid puzzle rules. Pure like the engine: mutate state, return events.
//
// state.puzzle = {
//   kind, status: 'active' | 'solved' | 'failed', startedAt, endsAt, strikes,
//   vault:   { wall: [{ sym, color }], slots: [{ answer, clue, holder, setter, value }], checkAt }
//   reactor: { holder, rounds: [[cls…]], round, progress, lastCls, lastAt }
// }

import { CLASS_IDS } from '../content/classes.js';
import { PUZZLES, SYMBOLS, COLORS, MAX_STRIKES, PUZZLE_TIME } from '../content/puzzles.js';

export const VAULT_LOCK_MS = 2500;   // all slots filled -> the vault checks after this pause
export const REACTOR_DEBOUNCE_MS = 1200; // a second press from the class that just went is ignored

const shuffle = (list, rng) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
};

// Classes actually in the raid, in a stable order
export function presentClasses(state) {
    const have = new Set(Object.values(state.players).map(p => p.cls));
    return CLASS_IDS.filter(c => have.has(c));
}

export function startPuzzle(state, kind, now, rng = Math.random) {
    const P = PUZZLES[kind];
    if (!P) throw new Error(`unknown puzzle ${kind}`);
    const classes = presentClasses(state);
    const time = Math.round(P.time * (PUZZLE_TIME[state.difficulty] || 1));
    const pz = { kind, status: 'active', startedAt: now, endsAt: now + time, strikes: 0 };
    if (kind === 'vault') pz.vault = makeVault(state, classes, rng);
    if (kind === 'reactor') pz.reactor = makeReactor(state, classes, rng);
    state.puzzle = pz;
    state.status = 'puzzle';
    state.boss = null;
    return [{ type: 'puzzleStart', kind }];
}

// ---------------------------------------------------------------- vault

function makeVault(state, classes, rng) {
    const syms = shuffle(SYMBOLS.map(s => s.id), rng);
    const cols = shuffle(COLORS.map(c => c.id), rng);
    const wall = syms.map((sym, i) => ({ sym, color: cols[i] }));
    const answers = shuffle(wall.map((_, i) => i), rng).slice(0, 4); // wall positions, all different
    const n = classes.length || 1;
    const hard = state.difficulty === 'heroic', easy = state.difficulty === 'elementary';
    const slots = answers.map((pos, k) => {
        const holder = classes[k % n];
        const setter = n > 1 ? classes[(k + 1) % n] : holder;
        let clue;
        const r = rng();
        if (easy || r < 0.45) clue = { by: 'color', color: wall[pos].color };
        else if (!hard || r < 0.75) clue = { by: 'pos', pos: pos + 1 };
        else if (pos > 0) clue = { by: 'rightOf', color: wall[pos - 1].color };
        else clue = { by: 'leftOf', color: wall[pos + 1].color };
        return { answer: wall[pos].sym, clue, holder, setter, value: null };
    });
    return { wall, slots, checkAt: 0 };
}

export function clueText(clue) {
    if (clue.by === 'color') return `the ${clue.color} symbol`;
    if (clue.by === 'pos') return `symbol #${clue.pos} on the wall (count from the left)`;
    if (clue.by === 'rightOf') return `the symbol just RIGHT of the ${clue.color} one`;
    if (clue.by === 'leftOf') return `the symbol just LEFT of the ${clue.color} one`;
    return '?';
}

function vaultSet(state, p, { s, v }, now, ev) {
    const V = state.puzzle.vault;
    const slot = V.slots[s];
    if (!slot || !(v >= 0 && v < SYMBOLS.length)) return;
    if (slot.setter !== p.cls) { ev.push({ type: 'puzzleReject', pid: p.id, reason: 'notYourSlot', slot: s, setter: slot.setter }); return; }
    if (slot.value === v) return;
    slot.value = v;
    ev.push({ type: 'vaultSet', pid: p.id, slot: s, value: v });
    V.checkAt = V.slots.every(x => x.value !== null) ? now + VAULT_LOCK_MS : 0;
    if (V.checkAt) ev.push({ type: 'vaultLocking', at: V.checkAt });
}

function vaultCheck(state, now, ev) {
    const V = state.puzzle.vault;
    V.checkAt = 0;
    const wrong = V.slots.map((x, i) => (x.value === x.answer ? -1 : i)).filter(i => i >= 0);
    if (!wrong.length) return solve(state, now, ev);
    for (const i of wrong) V.slots[i].value = null;
    strike(state, now, ev, { wrong });
}

// ---------------------------------------------------------------- reactor

function makeReactor(state, classes, rng) {
    const holder = classes.includes('TACTICIAN') ? 'TACTICIAN' : classes[0];
    const n = Object.keys(state.players).length;
    const base = Math.max(4, Math.min(7, 4 + Math.floor(n / 8)));
    const lens = [base, base + 2];
    const pool = classes.length ? classes : CLASS_IDS;
    const rounds = lens.map(len => {
        const seq = [];
        while (seq.length < len) {
            const c = pool[Math.floor(rng() * pool.length)];
            // no class three times running, and in a full squad not twice running
            if (pool.length > 1 && c === seq[seq.length - 1] && (pool.length > 2 || c === seq[seq.length - 2])) continue;
            seq.push(c);
        }
        return seq;
    });
    return { holder, rounds, round: 0, progress: 0, lastCls: null, lastAt: 0 };
}

function reactorPress(state, p, now, ev) {
    const R = state.puzzle.reactor;
    const seq = R.rounds[R.round];
    // classmates double-tapping the step they just did is not a mistake
    if (p.cls === R.lastCls && now - R.lastAt < REACTOR_DEBOUNCE_MS) return;
    if (seq[R.progress] === p.cls) {
        R.progress++;
        R.lastCls = p.cls; R.lastAt = now;
        ev.push({ type: 'reactorStep', pid: p.id, cls: p.cls, progress: R.progress, round: R.round });
        if (R.progress >= seq.length) {
            if (R.round + 1 >= R.rounds.length) return solve(state, now, ev);
            R.round++; R.progress = 0; R.lastCls = null;
            ev.push({ type: 'reactorRound', round: R.round });
        }
        return;
    }
    R.progress = 0; R.lastCls = null; R.lastAt = now;
    strike(state, now, ev, { pid: p.id, cls: p.cls, expected: seq[0] });
}

// ---------------------------------------------------------------- shared

function strike(state, now, ev, detail) {
    const pz = state.puzzle;
    pz.strikes++;
    ev.push({ type: 'puzzleStrike', kind: pz.kind, strikes: pz.strikes, ...detail });
    if (pz.strikes >= MAX_STRIKES) fail(state, now, ev, 'strikes');
}

function solve(state, now, ev) {
    const pz = state.puzzle;
    pz.status = 'solved'; pz.endedAt = now;
    ev.push({ type: 'puzzleSolved', kind: pz.kind, secs: Math.round((now - pz.startedAt) / 1000), strikes: pz.strikes });
}

function fail(state, now, ev, why) {
    const pz = state.puzzle;
    pz.status = 'failed'; pz.endedAt = now;
    ev.push({ type: 'puzzleFailed', kind: pz.kind, why });
}

export function puzzleInput(state, pid, input, now) {
    const pz = state.puzzle, p = state.players[pid];
    if (!pz || pz.status !== 'active' || !p || !input) return [];
    const ev = [];
    if (pz.kind === 'vault' && input.a === 'set') vaultSet(state, p, input, now, ev);
    if (pz.kind === 'reactor' && input.a === 'press') reactorPress(state, p, now, ev);
    return ev;
}

export function tickPuzzle(state, now) {
    const pz = state.puzzle;
    if (!pz || pz.status !== 'active') return [];
    const ev = [];
    if (pz.kind === 'vault' && pz.vault.checkAt && now >= pz.vault.checkAt) vaultCheck(state, now, ev);
    if (pz.status === 'active' && now >= pz.endsAt) fail(state, now, ev, 'time');
    return ev;
}

// The stakes. Solving: full heal plus a bonus. Failing: no heal (the fallen
// get back up on 25%) and the next boss is tougher.
export function applyPuzzleOutcome(state) {
    const pz = state.puzzle;
    if (!pz || pz.status === 'active') return [];
    const out = PUZZLES[pz.kind][pz.status === 'solved' ? 'solved' : 'failed'];
    for (const p of Object.values(state.players)) {
        if (p.status !== 'alive') { p.status = 'alive'; p.lives = Math.max(1, p.lives); p.hp = 0; }
        p.hp = out.heal ? p.maxHp : Math.max(p.hp, Math.round(p.maxHp * 0.25));
        p.ult = Math.max(0, Math.min(100, p.ult + out.ult));
        p.revive = 0; p.infected = 0; p.armed = false; p.shield = false;
    }
    state.team.syn = {}; state.team.synLevel = 1;
    state.regroupUntil = 0;
    state.nextMods = out.mods ? { ...out.mods } : null;
    state.puzzleLog = [...(state.puzzleLog || []), { kind: pz.kind, solved: pz.status === 'solved', strikes: pz.strikes, secs: Math.round(((pz.endedAt || pz.endsAt) - pz.startedAt) / 1000) }];
    state.puzzle = null;
    return [{ type: 'puzzleOutcome', kind: pz.kind, solved: pz.status === 'solved', ...out }];
}
