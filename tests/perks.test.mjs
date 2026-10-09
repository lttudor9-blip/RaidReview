// The upgrade vote after each boss, and what the upgrades do in a fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaid, addPlayer, answer, act, startBoss, tick, hasPerk } from '../next/js/rules/engine.js';
import { offerPerks, castVote, tally, winners, allVoted, grantPerk, perksOf } from '../next/js/rules/perks.js';
import { PERKS } from '../next/js/content/perks.js';

const rng = () => 0.3;
function squad(classes = ['WARRIOR', 'GUARDIAN', 'MEDIC', 'TACTICIAN', 'WARRIOR']) {
    const s = createRaid();
    classes.forEach((cls, i) => addPlayer(s, `p${i}`, { name: `P${i}`, cls }));
    return s;
}

test('every class present gets three upgrades from its own pool', () => {
    const s = squad(['WARRIOR', 'MEDIC']);
    const o = offerPerks(s, rng);
    assert.deepEqual(Object.keys(o).sort(), ['MEDIC', 'WARRIOR']);
    for (const [cls, ids] of Object.entries(o)) { assert.equal(ids.length, 3); for (const id of ids) assert.equal(PERKS[id].cls, cls); }
});

test('owned upgrades are never offered again', () => {
    const s = squad(['WARRIOR']);
    grantPerk(s, 'WARRIOR', 'w_fury'); grantPerk(s, 'WARRIOR', 'w_bloodlust');
    const o = offerPerks(s, rng);
    assert.ok(!o.WARRIOR.includes('w_fury') && !o.WARRIOR.includes('w_bloodlust'));
    assert.equal(o.WARRIOR.length, 3);
});

test('students can only vote for their own class, and the majority wins', () => {
    const s = squad();
    const vote = { offers: offerPerks(s, rng), votes: {} };
    const [a, b] = vote.offers.WARRIOR;
    assert.equal(castVote(vote, s, 'p0', vote.offers.MEDIC[0]), false, 'not your class');
    castVote(vote, s, 'p0', a); castVote(vote, s, 'p4', a);
    assert.equal(tally(vote, s).WARRIOR[a], 2);
    castVote(vote, s, 'p4', b); // changed their mind
    assert.equal(tally(vote, s).WARRIOR[a], 1);
    castVote(vote, s, 'p4', a);
    assert.equal(winners(vote, s, rng).WARRIOR, a);
    assert.equal(allVoted(vote, s), false);
    for (const [pid, cls] of [['p1', 'GUARDIAN'], ['p2', 'MEDIC'], ['p3', 'TACTICIAN']]) castVote(vote, s, pid, vote.offers[cls][0]);
    assert.equal(allVoted(vote, s), true);
});

test('HP upgrades apply at once and to late joiners', () => {
    const s = squad(['MEDIC']);
    const before = s.players.p0.maxHp;
    grantPerk(s, 'MEDIC', 'm_vitality');
    assert.equal(s.players.p0.maxHp, before + Math.round(before * 0.25));
    addPlayer(s, 'late', { name: 'L', cls: 'MEDIC' });
    assert.equal(s.players.late.maxHp, Math.round(before * 1.25));
    assert.deepEqual(perksOf(s, 'MEDIC'), ['m_vitality']);
});

test('Aegis shields block two hits; Spiked Shield strikes the boss back', () => {
    const s = squad(['GUARDIAN', 'WARRIOR']);
    grantPerk(s, 'GUARDIAN', 'g_aegis'); grantPerk(s, 'GUARDIAN', 'g_spikes');
    startBoss(s, 'raider', 0);
    answer(s, 'p0', true, 0); act(s, 'p0', { ability: 'special', target: 'p1' }, 0);
    assert.equal(s.players.p1.shield, 2);
    const hp = s.boss.hp;
    s.boss.cds = { saw: 0, slam: Infinity };
    s.boss.telegraph = { id: 'saw', name: 'SAW SWING', targets: ['p1'], at: 0 };
    tick(s, 1, rng); tick(s, 60000, rng);
    assert.equal(s.players.p1.shield, 1, 'one hit left');
    assert.equal(s.players.p1.hp, s.players.p1.maxHp);
    assert.ok(s.boss.hp < hp, 'spikes hit back');
});

test('damage, heal and Expose upgrades change the numbers', () => {
    const s = squad(['WARRIOR', 'MEDIC', 'TACTICIAN']);
    startBoss(s, 'raider', 0);
    s.boss.cds = { saw: Infinity, slam: Infinity };
    answer(s, 'p0', true, 0); const plain = act(s, 'p0', { ability: 'basic' }, 0).find(e => e.type === 'hit').amount;
    grantPerk(s, 'WARRIOR', 'w_bloodlust');
    answer(s, 'p0', true, 1); const buffed = act(s, 'p0', { ability: 'basic' }, 1).find(e => e.type === 'hit').amount;
    assert.ok(buffed > plain * 1.15);
    grantPerk(s, 'TACTICIAN', 't_deepscan'); grantPerk(s, 'TACTICIAN', 't_weakpoint');
    answer(s, 'p2', true, 100); act(s, 'p2', { ability: 'special' }, 100);
    assert.equal(s.boss.exposedUntil, 100 + 16000);
    assert.equal(s.boss.exposeBonus, 0.4);
    grantPerk(s, 'MEDIC', 'm_overflow');
    s.players.p0.hp = 100;
    answer(s, 'p1', true, 200); act(s, 'p1', { ability: 'special', target: 'p0' }, 200);
    assert.equal(s.players.p0.hp, 100 + Math.round(s.players.p0.maxHp * 0.45));
    assert.ok(hasPerk(s, 'm_overflow') && !hasPerk(s, 'm_splash'));
});
