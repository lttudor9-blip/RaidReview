// The boss arc: warm-up stagger, the infection boss, the final boss's last stand,
// and the teacher's chaos toolbar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaid, addPlayer, answer, act, startBoss, tick, chaos, CHAOS } from '../next/js/rules/engine.js';
import { BOSSES } from '../next/js/content/raid.js';

const rng = () => 0.5;
const ALL4 = ['WARRIOR', 'GUARDIAN', 'MEDIC', 'TACTICIAN'];
function raid(boss, classes = ALL4) {
    const s = createRaid();
    classes.forEach((cls, i) => addPlayer(s, `p${i}`, { name: `P${i}`, cls }));
    startBoss(s, boss, 0);
    s.boss.cds = Object.fromEntries(Object.keys(s.boss.cds).map(k => [k, Infinity])); // no surprise attacks
    return s;
}
const types = ev => ev.map(e => e.type);

test('bosses get tougher one after another, and the warm-up is short', () => {
    const hp = ['raider', 'enforcer', 'construct', 'omega'].map(id => BOSSES[id].hpPerPlayer);
    assert.deepEqual([...hp].sort((a, b) => a - b), hp);
    assert.ok(hp[0] * 3 < hp[3]);
});

test('warm-up boss staggers at half health: stunned and exposed for everyone', () => {
    const s = raid('raider');
    s.boss.hp = s.boss.maxHp * 0.49;
    const ev = tick(s, 1000, rng);
    assert.ok(types(ev).includes('stagger'));
    assert.ok(s.boss.stunUntil > 1000 && s.boss.exposedUntil > 1000);
    assert.ok(!types(tick(s, 1250, rng)).includes('stagger'), 'only once');
});

test('infected students stop charging their ultimate until cured', () => {
    const s = raid('construct');
    s.players.p0.infected = 99999;
    answer(s, 'p0', true, 0);
    assert.equal(s.players.p0.ult, 0);
    answer(s, 'p2', true, 0); // medic
    act(s, 'p2', { ability: 'special', target: 'p0' }, 0);
    assert.equal(s.players.p0.infected, 0);
    answer(s, 'p0', true, 1);
    assert.ok(s.players.p0.ult > 0);
});

test('a Guardian shield quarantines the virus instead of catching it', () => {
    const s = raid('construct', ['WARRIOR', 'GUARDIAN']);
    s.players.p0.infected = 1000;
    s.players.p1.shield = true; s.players.p1.shieldBy = 'p1';
    const ev = tick(s, 1000, rng);
    assert.ok(types(ev).includes('quarantine'));
    assert.equal(s.players.p1.infected, 0);
    assert.equal(s.players.p1.shield, false);
});

test('too many infected at once triggers a system overload on everyone', () => {
    const s = raid('construct');
    for (const id of ['p0', 'p1']) s.players[id].infected = 99999;
    const ev = tick(s, 1000, rng);
    assert.ok(types(ev).includes('overload'));
    assert.ok(s.players.p3.hp < s.players.p3.maxHp);
});

test('final boss last stand: every class fires its ultimate and the annihilation is stopped', () => {
    const s = raid('omega');
    s.boss.beatsDone = { 0: true };
    s.boss.hp = s.boss.maxHp * 0.24;
    const ev = tick(s, 1000, rng);
    assert.ok(types(ev).includes('lastStand'));
    assert.ok(Object.values(s.players).every(p => p.ult === 100), 'ultimates charged');
    let won = [];
    for (const [i, id] of ['p0', 'p1', 'p2', 'p3'].entries()) { answer(s, id, true, 2000 + i); won = won.concat(act(s, id, { ability: 'ult' }, 2000 + i)); }
    assert.ok(types(won).includes('lastStandWon'));
    assert.ok(won.some(e => e.type === 'hero' && e.kind === 'lastStandSquad'));
});

test('final boss last stand: miss a class and the annihilation lands', () => {
    const s = raid('omega');
    s.boss.beatsDone = { 0: true };
    s.boss.hp = s.boss.maxHp * 0.24;
    tick(s, 1000, rng);
    answer(s, 'p0', true, 2000); act(s, 'p0', { ability: 'ult' }, 2000);
    const ev = tick(s, s.boss.lastStand.endsAt, rng);
    assert.ok(types(ev).includes('lastStandFailed'));
    assert.ok(Object.values(s.players).some(p => p.status !== 'alive' || p.hp < p.maxHp * 0.3));
});

test('chaos mode: each tool has its own cooldown; reward boosts only that class', () => {
    const s = raid('raider');
    assert.ok(types(chaos(s, 'meteor', 1000)).includes('chaos'));
    assert.ok(s.players.p0.hp < s.players.p0.maxHp);
    assert.deepEqual(chaos(s, 'meteor', 2000), [], 'meteor on cooldown');
    assert.ok(chaos(s, 'meteor', 1000 + CHAOS.meteor.cd).length, 'ready again');
    chaos(s, 'reward', 1000, { cls: 'MEDIC' });
    assert.equal(s.players.p2.ult, 35);
    assert.equal(s.players.p0.ult, 0);
    s.players.p1.shield = true;
    chaos(s, 'drain', 1000);
    assert.equal(s.players.p1.shield, false);
    chaos(s, 'patient', 1000, {}, rng);
    assert.ok(Object.values(s.players).some(p => p.infected));
});
