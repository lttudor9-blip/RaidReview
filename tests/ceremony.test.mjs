// End ceremony: the raid rank and who gets which award.
import test from 'node:test';
import assert from 'node:assert/strict';
import { raidRank, pickAwards, ceremonyData } from '../next/js/host/ceremony.js';

const base = { won: true, accuracy: 85, livesLeft: 3, maxLives: 3, callsMet: 9, callsMissed: 1, puzzlesSolved: 2, puzzles: 2, difficulty: 'regular' };

test('a sharp squad that never wiped earns an S', () => {
    assert.equal(raidRank(base).letter, 'S');
});

test('wipes, missed role calls and failed puzzles pull the rank down', () => {
    const rough = raidRank({ ...base, accuracy: 62, livesLeft: 1, callsMet: 3, callsMissed: 7, puzzlesSolved: 0 });
    assert.ok(['C', 'D'].includes(rough.letter), rough.letter);
    assert.ok(raidRank({ ...base, livesLeft: 1 }).score < raidRank(base).score);
});

test('a lost raid has no rank', () => {
    assert.equal(raidRank({ ...base, won: false }), null);
});

const player = (id, cls, stats) => ({ id, name: id.toUpperCase(), cls, stats: { dmg: 0, heal: 0, shields: 0, saves: 0, correct: 0, wrong: 0, revives: 0, bestStreak: 0, roleCalls: 0, ults: 0, ...stats } });

test('awards spread around the room: one per student, and only for real contributions', () => {
    const ps = [
        player('a', 'WARRIOR', { dmg: 9000, correct: 20, bestStreak: 12 }),
        player('b', 'MEDIC', { heal: 3000, revives: 2, correct: 5 }),
        player('c', 'GUARDIAN', { shields: 6, saves: 2, correct: 4 })
    ];
    const aw = pickAwards(ps);
    assert.equal(new Set(aw.map(a => a.pid)).size, aw.length, 'nobody wins twice');
    assert.equal(aw.find(a => a.id === 'mvp').pid, 'a');
    assert.equal(aw.find(a => a.id === 'lifesaver').pid, 'b');
    assert.equal(aw.find(a => a.id === 'wall').pid, 'c');
    assert.ok(!aw.some(a => a.id === 'caller'), 'no role calls answered, no Clutch Caller award');
});

test('ceremony data: class lines skip stats that stayed at zero', () => {
    const H = {
        engine: { players: { a: player('a', 'WARRIOR', { dmg: 5000, correct: 3 }), b: player('b', 'MEDIC', { correct: 4 }) }, puzzleLog: [], raidLives: 3, difficulty: 'regular', boss: null, perks: {} },
        counts: {}, heroes: [], byClass: {}, stageIdx: 3, stages: [1, 2, 3, 4]
    };
    const D = ceremonyData(H, true);
    const medic = D.classes.find(c => c.cls === 'MEDIC');
    assert.ok(!/\b0 /.test(medic.line), medic.line);
    assert.ok(D.totals.every(t => t.v > 0));
});
