// Fair play: rate limits and intent checks the projector applies to every Chromebook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuard, allow, validIntent, capBatch, cleanName, isFlagged, LIMITS } from '../next/js/rules/guard.js';

const ctx = { questions: [{ answers: ['a', 'b', 'c', 'd'] }, { answers: ['True', 'False'] }], players: { p1: {}, p2: {} } };

test('a real student answering every few seconds is never blocked', () => {
    const G = createGuard();
    for (let i = 0; i < 40; i++) assert.ok(allow(G, 'p1', { t: 'a' }, i * 3000).ok, `answer ${i}`);
    assert.equal(isFlagged(G, 'p1'), false);
});

test('answers faster than a person can are blocked, and repeat offenders are flagged', () => {
    const G = createGuard();
    let ok = 0, flagged = false;
    for (let i = 0; i < 30; i++) { const r = allow(G, 'p1', { t: 'a' }, i * 100); if (r.ok) ok++; flagged ||= !!r.flagged; }
    assert.ok(ok <= 3, `${ok} got through`);
    assert.ok(flagged && isFlagged(G, 'p1'));
    assert.equal(isFlagged(G, 'p2'), false, 'only the spammer is flagged');
});

test('a quick burst is fine, a sustained machine pace is not', () => {
    const G = createGuard();
    let ok = 0;
    for (let i = 0; i < 60; i++) if (allow(G, 'p1', { t: 'a' }, i * 1100).ok) ok++; // one every 1.1s for a minute
    assert.ok(ok <= LIMITS.answerBurst + Math.ceil(66000 / LIMITS.answerRefillMs), `${ok} answers in 66s`);
});

test('malformed or out-of-range intents are rejected', () => {
    assert.ok(validIntent({ t: 'a', q: 0, p: 3, n: 'abc' }, ctx));
    assert.ok(!validIntent({ t: 'a', q: 1, p: 2 }, ctx), 'true/false has two answers');
    assert.ok(!validIntent({ t: 'a', q: 9, p: 0 }, ctx));
    assert.ok(!validIntent({ t: 'a', q: '0', p: 0 }, ctx));
    assert.ok(!validIntent({ t: 'x', ab: 'nuke' }, ctx));
    assert.ok(validIntent({ t: 'x', ab: 'special', tg: 'p2' }, ctx));
    assert.ok(!validIntent({ t: 'x', ab: 'special', tg: 'ghost' }, ctx));
    assert.ok(!validIntent('hello', ctx));
    assert.ok(!validIntent({ t: 'v', perk: { evil: 1 } }, ctx));
});

test('a flood of intents in one update is cut down and flagged', () => {
    const G = createGuard();
    const keys = Array.from({ length: 100 }, (_, i) => 'k' + i);
    let r;
    for (let i = 0; i < LIMITS.flagAfter; i++) r = capBatch(G, 'p1', keys);
    assert.equal(r.keep.length, LIMITS.maxIntentsPerBatch);
    assert.ok(isFlagged(G, 'p1'));
});

test('names are cleaned: no markup, trimmed, never empty', () => {
    assert.equal(cleanName('  <b>Ana</b>  '), 'bAna/b');
    assert.equal(cleanName(''), 'Student');
    assert.equal(cleanName('x'.repeat(40)).length, 16);
});
