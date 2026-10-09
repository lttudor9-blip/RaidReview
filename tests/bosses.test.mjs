// The boss arc: warm-up stagger, the infection boss, the final boss's last stand,
// and the teacher's chaos toolbar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaid, addPlayer, answer, act, canAct, startBoss, tick, chaos, CHAOS, isWeak } from '../next/js/rules/engine.js';
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
// mark every scripted beat done except the ones of `kind`
const skipBeatsBut = (s, kind) => { s.boss.beatsDone = Object.fromEntries(BOSSES[s.boss.id].beats.map((b, i) => [i, b.kind !== kind]).filter(([, v]) => v)); };
// launch one of the boss's attacks right now
function fire(s, id, now) {
    s.boss.cds[id] = now;
    for (const k of Object.keys(s.boss.cds)) if (k !== id) s.boss.cds[k] = Infinity;
    s.boss.telegraph = null;
    return tick(s, now, rng);
}

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
    skipBeatsBut(s, 'lastStand');
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
    skipBeatsBut(s, 'lastStand');
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

test('weak spot: one class deals triple damage, and it moves to another class', () => {
    const s = raid('raider');
    tick(s, 0, rng);
    const w = s.boss.weak;
    assert.ok(w && ALL4.includes(w.cls));
    const weakP = Object.values(s.players).find(p => p.cls === w.cls);
    const other = Object.values(s.players).find(p => p.cls !== w.cls);
    const hit = pid => { answer(s, pid, true, 10); return act(s, pid, { ability: 'basic' }, 10).find(e => e.type === 'hit'); };
    const a = hit(weakP.id), b = hit(other.id);
    assert.ok(a.weak && !b.weak);
    assert.ok(isWeak(s, weakP, 10));
    const ev = tick(s, w.until + 1, rng);
    assert.ok(types(ev).includes('weakShift'));
    assert.notEqual(s.boss.weak.cls, w.cls, 'the weak spot moved');
});

test('a one-class raid gets no weak spot', () => {
    const s = raid('raider', ['WARRIOR', 'WARRIOR']);
    tick(s, 0, rng);
    assert.equal(s.boss.weak, null);
});

test('sniper mark: a shield blocks it and ricochets damage into the boss', () => {
    const s = raid('enforcer');
    fire(s, 'snipe', 1000);
    const atk = s.boss.attack;
    assert.equal(atk.kind, 'mark');
    const t = s.players[atk.targets[0]];
    t.shield = 1; t.shieldBy = 'p1';
    const hp = s.boss.hp;
    const ev = tick(s, atk.landsAt, rng);
    assert.ok(types(ev).includes('ricochet'));
    assert.ok(s.boss.hp < hp);
    assert.equal(t.hp, t.maxHp);
});

test('sniper mark: unshielded, it nearly takes the target out', () => {
    const s = raid('enforcer');
    fire(s, 'snipe', 1000);
    const t = s.players[s.boss.attack.targets[0]];
    tick(s, s.boss.attack.landsAt, rng);
    assert.ok(t.status !== 'alive' || t.hp < t.maxHp * 0.3); // small rooms soften every boss hit
});

test('silence: a class can only basic-attack until a Medic cleanses it', () => {
    const s = raid('construct');
    fire(s, 'silence', 1000);
    const atk = s.boss.attack;
    const ev = tick(s, atk.landsAt, rng);
    assert.ok(types(ev).includes('silenced'));
    const p = s.players[atk.targets[0]];
    answer(s, p.id, true, atk.landsAt + 10);
    assert.equal(canAct(s, p.id, 'special', atk.landsAt + 10), 'silenced');
    assert.equal(canAct(s, p.id, 'basic', atk.landsAt + 10), '');
    const medic = Object.values(s.players).find(x => x.cls === 'MEDIC' && x.id !== p.id);
    if (medic) {
        answer(s, medic.id, true, atk.landsAt + 20);
        act(s, medic.id, { ability: 'special', target: p.id }, atk.landsAt + 20);
        assert.equal(canAct(s, p.id, 'special', atk.landsAt + 30), '');
    }
});

test('repair drones: Warriors shoot them down, or the boss heals', () => {
    const s = raid('construct');
    s.boss.hp = s.boss.maxHp * 0.6;
    fire(s, 'drones', 1000);
    const hp = s.boss.hp;
    const ev = tick(s, s.boss.attack.landsAt, rng);
    assert.ok(types(ev).includes('bossRepair'));
    assert.ok(s.boss.hp > hp);

    const s2 = raid('construct');
    s2.boss.hp = s2.boss.maxHp * 0.6;
    fire(s2, 'drones', 1000);
    answer(s2, 'p0', true, 1100); act(s2, 'p0', { ability: 'special' }, 1100); // the Warrior
    const hp2 = s2.boss.hp;
    const ev2 = tick(s2, s2.boss.attack.landsAt, rng);
    assert.ok(types(ev2).includes('roleCallSuccess'));
    assert.ok(s2.boss.hp < hp2);
});

test('elemental shield: only its class can break it, and breaking it staggers the boss', () => {
    const s = raid('omega');
    skipBeatsBut(s, 'eshield');
    s.boss.hp = s.boss.maxHp * 0.84;
    const ev = tick(s, 1000, rng);
    assert.ok(types(ev).includes('eshield'));
    const sh = s.boss.eshield;
    const owner = Object.values(s.players).find(p => p.cls === sh.cls);
    const other = Object.values(s.players).find(p => p.cls !== sh.cls);
    answer(s, other.id, true, 1100);
    const r = act(s, other.id, { ability: 'basic' }, 1100).find(e => e.type === 'hit');
    assert.ok(r.resisted, 'other classes barely scratch it');
    sh.hp = 1;
    answer(s, owner.id, true, 1200);
    const br = act(s, owner.id, { ability: 'basic' }, 1200);
    assert.ok(types(br).includes('eshieldBreak'));
    assert.equal(s.boss.eshield, null);
    assert.ok(s.boss.stunUntil > 1200);
});

test('elemental shield: left up too long, it bursts on the squad', () => {
    const s = raid('omega');
    skipBeatsBut(s, 'eshield');
    s.boss.hp = s.boss.maxHp * 0.84;
    tick(s, 1000, rng);
    const ev = tick(s, s.boss.eshield.endsAt, rng);
    assert.ok(types(ev).includes('eshieldBurst'));
    assert.ok(Object.values(s.players).every(p => p.hp < p.maxHp));
});

test('chaos mode: silence, elemental shield and weak spot', () => {
    const s = raid('raider');
    tick(s, 0, rng);
    assert.ok(types(chaos(s, 'silence', 1000, {}, rng)).includes('silenced'));
    const before = s.boss.weak?.cls;
    const w = chaos(s, 'weak', 1000, {}, rng);
    assert.ok(types(w).includes('weakShift'));
    assert.notEqual(s.boss.weak.cls, before);
    assert.ok(types(chaos(s, 'eshield', 1000, {}, rng)).includes('eshield'));
    assert.ok(s.boss.eshield);
});
