import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaid, addPlayer, startBoss } from '../next/js/rules/engine.js';
import { startPuzzle, puzzleInput, tickPuzzle, applyPuzzleOutcome, presentClasses, VAULT_LOCK_MS, REACTOR_DEBOUNCE_MS } from '../next/js/rules/puzzles.js';
import { BOSSES } from '../next/js/content/raid.js';

function seededRng(seed = 7) {
    return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}
function squad(classes = ['WARRIOR', 'GUARDIAN', 'MEDIC', 'TACTICIAN'], difficulty = 'regular') {
    const s = createRaid({ difficulty });
    classes.forEach((cls, i) => addPlayer(s, `p${i}`, { name: `P${i}`, cls }));
    return s;
}
const pidOf = (s, cls) => Object.values(s.players).find(p => p.cls === cls).id;
const types = ev => ev.map(e => e.type);

test('vault: each clue goes to a different class than the one who enters it', () => {
    const s = squad();
    startPuzzle(s, 'vault', 0, seededRng());
    const slots = s.puzzle.vault.slots;
    assert.equal(slots.length, 4);
    for (const x of slots) assert.notEqual(x.holder, x.setter);
    assert.equal(new Set(slots.map(x => x.answer)).size, 4, 'answers are all different');
    // every class holds a clue and sets a slot
    assert.equal(new Set(slots.map(x => x.holder)).size, 4);
    assert.equal(new Set(slots.map(x => x.setter)).size, 4);
});

test('vault: only the right class can set a slot', () => {
    const s = squad();
    startPuzzle(s, 'vault', 0, seededRng());
    const slot = s.puzzle.vault.slots[0];
    const wrongCls = ['WARRIOR', 'GUARDIAN', 'MEDIC', 'TACTICIAN'].find(c => c !== slot.setter);
    const ev = puzzleInput(s, pidOf(s, wrongCls), { a: 'set', s: 0, v: slot.answer }, 10);
    assert.deepEqual(types(ev), ['puzzleReject']);
    assert.equal(slot.value, null);
    puzzleInput(s, pidOf(s, slot.setter), { a: 'set', s: 0, v: slot.answer }, 10);
    assert.equal(slot.value, slot.answer);
});

test('vault: right code after the lock pause solves it; wrong slots clear and strike', () => {
    const s = squad();
    startPuzzle(s, 'vault', 0, seededRng());
    const V = s.puzzle.vault;
    V.slots.forEach((x, i) => puzzleInput(s, pidOf(s, x.setter), { a: 'set', s: i, v: i === 2 ? (x.answer + 1) % 6 : x.answer }, 100));
    assert.ok(V.checkAt > 0);
    assert.deepEqual(tickPuzzle(s, 100 + VAULT_LOCK_MS - 1), []);
    const ev = tickPuzzle(s, 100 + VAULT_LOCK_MS);
    assert.deepEqual(types(ev), ['puzzleStrike']);
    assert.deepEqual(ev[0].wrong, [2]);
    assert.equal(V.slots[2].value, null);
    assert.notEqual(V.slots[0].value, null, 'right slots stay');
    puzzleInput(s, pidOf(s, V.slots[2].setter), { a: 'set', s: 2, v: V.slots[2].answer }, 5000);
    assert.deepEqual(types(tickPuzzle(s, 5000 + VAULT_LOCK_MS)), ['puzzleSolved']);
    assert.equal(s.puzzle.status, 'solved');
});

test('vault: changing a slot during the lock pause restarts it', () => {
    const s = squad();
    startPuzzle(s, 'vault', 0, seededRng());
    const V = s.puzzle.vault;
    V.slots.forEach((x, i) => puzzleInput(s, pidOf(s, x.setter), { a: 'set', s: i, v: x.answer }, 100));
    puzzleInput(s, pidOf(s, V.slots[1].setter), { a: 'set', s: 1, v: (V.slots[1].answer + 1) % 6 }, 2000);
    assert.equal(V.checkAt, 2000 + VAULT_LOCK_MS);
});

test('three strikes fail the puzzle; so does the clock', () => {
    const s = squad();
    startPuzzle(s, 'vault', 0, seededRng());
    const V = s.puzzle.vault;
    let t = 0;
    for (let k = 0; k < 3; k++) {
        V.slots.forEach((x, i) => puzzleInput(s, pidOf(s, x.setter), { a: 'set', s: i, v: (x.answer + 1) % 6 }, t));
        tickPuzzle(s, t + VAULT_LOCK_MS);
        t += 10000;
    }
    assert.equal(s.puzzle.status, 'failed');

    const s2 = squad();
    startPuzzle(s2, 'reactor', 0, seededRng());
    assert.deepEqual(types(tickPuzzle(s2, s2.puzzle.endsAt)), ['puzzleFailed']);
});

test('works with a partial squad: two classes share all four vault slots', () => {
    const s = squad(['WARRIOR', 'MEDIC', 'WARRIOR']);
    assert.deepEqual(presentClasses(s), ['WARRIOR', 'MEDIC']);
    startPuzzle(s, 'vault', 0, seededRng());
    for (const x of s.puzzle.vault.slots) { assert.notEqual(x.holder, x.setter); assert.ok(['WARRIOR', 'MEDIC'].includes(x.setter)); }
    const r = squad(['GUARDIAN']);
    startPuzzle(r, 'reactor', 0, seededRng());
    assert.ok(r.puzzle.reactor.rounds[0].every(c => c === 'GUARDIAN'));
});

test('reactor: Tacticians hold the intel; right presses advance, wrong presses reset with a strike', () => {
    const s = squad();
    startPuzzle(s, 'reactor', 0, seededRng());
    const R = s.puzzle.reactor;
    assert.equal(R.holder, 'TACTICIAN');
    const seq = R.rounds[0];
    for (let k = 1; k < seq.length; k++) assert.notEqual(seq[k], seq[k - 1], 'no class twice running in a full squad');
    let t = 0;
    puzzleInput(s, pidOf(s, seq[0]), { a: 'press' }, t += 2000);
    puzzleInput(s, pidOf(s, seq[1]), { a: 'press' }, t += 2000);
    assert.equal(R.progress, 2);
    const wrong = ['WARRIOR', 'GUARDIAN', 'MEDIC', 'TACTICIAN'].find(c => c !== seq[2] && c !== seq[1]);
    const ev = puzzleInput(s, pidOf(s, wrong), { a: 'press' }, t += 2000);
    assert.deepEqual(types(ev), ['puzzleStrike']);
    assert.equal(R.progress, 0);
});

test('reactor: a classmate double-tapping the step they just did is ignored', () => {
    const s = squad(['WARRIOR', 'WARRIOR', 'GUARDIAN', 'MEDIC', 'TACTICIAN']);
    startPuzzle(s, 'reactor', 0, seededRng());
    const R = s.puzzle.reactor;
    const first = R.rounds[0][0];
    const mates = Object.values(s.players).filter(p => p.cls === first);
    puzzleInput(s, mates[0].id, { a: 'press' }, 1000);
    assert.deepEqual(puzzleInput(s, (mates[1] || mates[0]).id, { a: 'press' }, 1000 + REACTOR_DEBOUNCE_MS - 1), []);
    assert.equal(R.progress, 1);
    assert.equal(s.puzzle.strikes, 0);
});

test('reactor: two rounds, the second longer, then solved', () => {
    const s = squad();
    startPuzzle(s, 'reactor', 0, seededRng());
    const R = s.puzzle.reactor;
    assert.equal(R.rounds[1].length, R.rounds[0].length + 2);
    let t = 0;
    for (const seq of R.rounds) for (const c of seq) puzzleInput(s, pidOf(s, c), { a: 'press' }, t += 1500);
    assert.equal(s.puzzle.status, 'solved');
});

test('solving: full heal and the reward carries into the next boss', () => {
    const s = squad();
    s.players.p0.hp = 10; s.players.p1.status = 'down'; s.players.p1.hp = 0;
    startPuzzle(s, 'reactor', 0, seededRng());
    s.puzzle.status = 'solved';
    const ev = applyPuzzleOutcome(s);
    assert.equal(ev[0].solved, true);
    assert.equal(s.players.p0.hp, s.players.p0.maxHp);
    assert.equal(s.players.p1.status, 'alive');
    startBoss(s, 'raider', 0);
    assert.equal(s.boss.mods.dmg, 1.2);
    assert.equal(s.nextMods, null);
});

test('failing: no heal, the fallen get up on 25%, and the next boss is reinforced', () => {
    const s = squad();
    s.players.p0.hp = 500; s.players.p1.status = 'down'; s.players.p1.hp = 0;
    s.players.p2.ult = 80;
    startPuzzle(s, 'vault', 0, seededRng());
    tickPuzzle(s, s.puzzle.endsAt);
    applyPuzzleOutcome(s);
    assert.equal(s.players.p0.hp, 500);
    assert.equal(s.players.p1.hp, Math.round(s.players.p1.maxHp * 0.25));
    assert.equal(s.players.p2.ult, 80);
    startBoss(s, 'raider', 0);
    const plain = squad(); startBoss(plain, 'raider', 0);
    assert.ok(Math.abs(s.boss.maxHp / plain.boss.maxHp - 1.25) < 0.001);
});
