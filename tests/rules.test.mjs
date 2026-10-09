// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaid, addPlayer, answer, act, startBoss, tick, synergyMult, canAct } from '../next/js/rules/engine.js';
import { BOSSES } from '../next/js/content/raid.js';

function seededRng(seed = 1) {
    return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function raid(classes = ['WARRIOR', 'GUARDIAN', 'MEDIC', 'TACTICIAN'], boss = 'raider') {
    const s = createRaid();
    classes.forEach((cls, i) => addPlayer(s, `p${i}`, { name: `P${i}`, cls }));
    startBoss(s, boss, 0);
    return s;
}

test('a correct answer arms one action; acting disarms', () => {
    const s = raid();
    assert.match(canAct(s, 'p0', 'basic', 0), /answer/);
    answer(s, 'p0', true, 0);
    assert.equal(canAct(s, 'p0', 'basic', 0), '');
    act(s, 'p0', { ability: 'basic' }, 0);
    assert.match(canAct(s, 'p0', 'basic', 0), /answer/);
});

test('wrong answers hurt but never knock a student out', () => {
    const s = raid();
    for (let i = 0; i < 50; i++) answer(s, 'p2', false, 0);
    assert.equal(s.players.p2.status, 'alive');
    assert.equal(s.players.p2.hp, 1);
});

test('synergy grows with each distinct class in the window', () => {
    const s = raid();
    assert.equal(synergyMult(s, 0), 1);
    for (const pid of ['p0', 'p1', 'p2', 'p3']) { answer(s, pid, true, 1000); act(s, pid, { ability: 'basic' }, 1000); }
    assert.equal(synergyMult(s, 1000), 1.5);
    assert.equal(synergyMult(s, 20000), 1); // window expired
});

test('Expose then Titan\'s Wrath triggers SHATTER and consumes the Expose', () => {
    const s = raid();
    s.players.p0.ult = 100;
    answer(s, 'p3', true, 0); act(s, 'p3', { ability: 'special' }, 0);
    answer(s, 'p0', true, 100);
    const ev = act(s, 'p0', { ability: 'ult' }, 100);
    assert.ok(ev.some(e => e.type === 'combo' && e.name === 'SHATTER'));
    assert.equal(s.boss.exposedUntil, 0);
});

test('special cooldown counts down on correct answers', () => {
    const s = raid();
    answer(s, 'p0', true, 0); act(s, 'p0', { ability: 'special' }, 0);
    answer(s, 'p0', true, 0);
    assert.match(canAct(s, 'p0', 'special', 0), /cooldown/);
    act(s, 'p0', { ability: 'basic' }, 0);
    answer(s, 'p0', true, 0);
    assert.equal(canAct(s, 'p0', 'special', 0), '');
});

test('a met role call negates the attack and reflects damage', () => {
    const s = raid(['WARRIOR', 'GUARDIAN', 'GUARDIAN', 'MEDIC']);
    const rng = seededRng(3);
    s.boss.cds = { saw: Infinity, slam: 0 };
    const w = tick(s, 0, rng);
    const wind = w.find(e => e.type === 'windup');
    assert.equal(wind.attack, 'slam');
    assert.equal(wind.call.cls, 'GUARDIAN');
    assert.equal(wind.call.need, 1);
    const hpBefore = s.boss.hp;
    answer(s, 'p1', true, 1000); act(s, 'p1', { ability: 'special', target: 'p0' }, 1000);
    const ev = tick(s, s.boss.attack.landsAt, rng);
    assert.ok(ev.some(e => e.type === 'roleCallSuccess'));
    assert.ok(s.boss.hp < hpBefore);
    assert.equal(s.players.p2.hp, s.players.p2.maxHp);
});

test('a missed role call lands the attack on everyone', () => {
    const s = raid();
    const rng = seededRng(5);
    s.boss.cds = { saw: Infinity, slam: 0 };
    tick(s, 0, rng);
    const ev = tick(s, s.boss.attack.landsAt, rng);
    assert.ok(ev.some(e => e.type === 'roleCallFailed'));
    assert.ok(Object.values(s.players).every(p => p.hp < p.maxHp));
});

test('role call for a missing class falls back to ANY', () => {
    const s = raid(['WARRIOR', 'WARRIOR', 'MEDIC']);
    s.boss.cds = { saw: Infinity, slam: 0 };
    const w = tick(s, 0, seededRng(1)).find(e => e.type === 'windup');
    assert.equal(w.call.cls, 'ANY');
});

test('shields block one hit; medics revive downed allies', () => {
    const s = raid();
    const p0 = s.players.p0;
    p0.shield = true;
    s.boss.attack = { id: 'saw', name: 'SAW SWING', kind: 'strike', targets: ['p0'], landsAt: 10, call: null };
    tick(s, 10, seededRng(1));
    assert.equal(p0.hp, p0.maxHp);
    assert.equal(p0.shield, false);
    p0.hp = 1;
    s.boss.attack = { id: 'saw', name: 'SAW SWING', kind: 'strike', targets: ['p0'], landsAt: 20, call: null };
    tick(s, 20, seededRng(1));
    assert.equal(p0.status, 'down');
    answer(s, 'p2', true, 30);
    act(s, 'p2', { ability: 'special', target: 'p0' }, 30);
    assert.equal(p0.status, 'alive');
    assert.equal(s.players.p2.stats.revives, 1);
});

test('downed students revive themselves by answering', () => {
    const s = raid();
    const p = s.players.p1;
    p.status = 'down'; p.hp = 0;
    answer(s, 'p1', true, 0); answer(s, 'p1', true, 0);
    assert.equal(p.status, 'down');
    answer(s, 'p1', false, 0); // a miss resets progress
    answer(s, 'p1', true, 0); answer(s, 'p1', true, 0); answer(s, 'p1', true, 0);
    assert.equal(p.status, 'alive');
});

test('a full wipe costs a raid life and regroups everyone', () => {
    const s = raid(['WARRIOR', 'MEDIC']);
    for (const p of Object.values(s.players)) { p.status = 'down'; p.hp = 0; }
    const ev = tick(s, 1000, seededRng(1));
    assert.ok(ev.some(e => e.type === 'wipe'));
    assert.equal(s.raidLives, 2);
    tick(s, s.regroupUntil, seededRng(1));
    assert.ok(Object.values(s.players).every(p => p.status === 'alive'));
});

test('three wipes lose the raid', () => {
    const s = raid(['WARRIOR']);
    let t = 0;
    for (let i = 0; i < 3; i++) {
        s.players.p0.status = 'down';
        t += 100000;
        tick(s, t, seededRng(1));
        if (s.regroupUntil) tick(s, s.regroupUntil, seededRng(1));
    }
    assert.equal(s.status, 'defeat');
});

test('boss HP scales with players but never below three', () => {
    const one = raid(['WARRIOR']);
    const ten = raid(Array(10).fill('MEDIC'));
    assert.equal(one.boss.maxHp, BOSSES.raider.hpPerPlayer * 3);
    assert.equal(ten.boss.maxHp, BOSSES.raider.hpPerPlayer * 10);
});

test('System Breach cancels a winding attack', () => {
    const s = raid();
    s.boss.cds = { saw: 0, slam: Infinity };
    tick(s, 0, seededRng(2));
    assert.ok(s.boss.attack);
    s.players.p3.ult = 100;
    answer(s, 'p3', true, 100);
    const ev = act(s, 'p3', { ability: 'ult' }, 100);
    assert.ok(ev.some(e => e.type === 'interrupt'));
    assert.equal(s.boss.attack, null);
    assert.equal(tick(s, 5000, seededRng(2)).filter(e => e.type === 'windup').length, 0); // stunned
});

import { restoreBetweenStages, shiftTime } from '../next/js/rules/engine.js';

test('between stages everyone is patched up and spirits return', () => {
    const s = raid();
    s.players.p0.status = 'out'; s.players.p0.lives = 0; s.players.p0.hp = 0;
    s.players.p1.hp = 10;
    restoreBetweenStages(s);
    assert.equal(s.players.p0.status, 'alive');
    assert.equal(s.players.p0.lives, 1);
    assert.ok(s.players.p0.hp > 0);
    assert.ok(s.players.p1.hp > 10);
});

test('pausing shifts boss timers so nothing fires early', () => {
    const s = raid();
    s.boss.cds = { saw: 0, slam: Infinity };
    tick(s, 0, seededRng(2));
    const lands = s.boss.attack.landsAt;
    shiftTime(s, 60000);
    assert.equal(s.boss.attack.landsAt, lands + 60000);
    assert.ok(tick(s, lands, seededRng(2)).every(e => e.type !== 'attack'));
});

test('a teammate\'s shield that blocks a boss hit counts as a save for the Guardian', () => {
    const s = raid();
    answer(s, 'p1', true, 0);
    act(s, 'p1', { ability: 'special', target: 'p0' }, 0);
    s.boss.attack = { id: 'saw', name: 'SAW SWING', kind: 'strike', targets: ['p0'], landsAt: 10, call: null };
    const ev = tick(s, 10, seededRng(1));
    const block = ev.find(e => e.type === 'shieldBlock');
    assert.equal(block.by, 'p1');
    assert.equal(s.players.p1.stats.saves, 1);
});

test('hero moment: Field Hospital pulls a squad back from the brink', () => {
    const s = raid(['MEDIC', 'WARRIOR', 'GUARDIAN', 'TACTICIAN']);
    for (const pid of ['p1', 'p2', 'p3']) { s.players[pid].status = 'down'; s.players[pid].hp = 0; }
    s.players.p0.ult = 100;
    answer(s, 'p0', true, 0);
    const ev = act(s, 'p0', { ability: 'ult' }, 0);
    const hero = ev.find(e => e.type === 'hero');
    assert.equal(hero.kind, 'squadSave');
    assert.deepEqual(hero.pids, ['p0']);
    assert.equal(hero.revived, 3);
});

test('hero moment: Tactician sets up the Warrior\'s SHATTER', () => {
    const s = raid();
    s.players.p3.ult = 100; s.players.p0.ult = 100;
    answer(s, 'p3', true, 0); act(s, 'p3', { ability: 'ult' }, 0);
    answer(s, 'p0', true, 500);
    const ev = act(s, 'p0', { ability: 'ult' }, 500);
    const hero = ev.find(e => e.type === 'hero' && e.kind === 'perfectCombo');
    assert.deepEqual(hero.pids, ['p3', 'p0']);
});

test('hero moment: final blow and flawless boss kill', () => {
    const s = raid();
    s.boss.hp = 10;
    answer(s, 'p0', true, 0);
    const ev = act(s, 'p0', { ability: 'basic' }, 0);
    assert.ok(ev.some(e => e.type === 'hero' && e.kind === 'finalBlow' && e.pids[0] === 'p0'));
    assert.ok(ev.some(e => e.type === 'hero' && e.kind === 'flawless'));
});

test('threat radar: the boss plans single-target attacks ahead and keeps its word', () => {
    const s = raid();
    s.boss.cds = { saw: 4000, slam: Infinity };
    tick(s, 0, seededRng(4));
    const plan = s.boss.telegraph;
    assert.ok(plan && plan.id === 'saw' && plan.targets.length >= 1);
    const ev = tick(s, 4000, seededRng(9));
    const wind = ev.find(e => e.type === 'windup');
    assert.deepEqual(wind.targets, plan.targets);
});
