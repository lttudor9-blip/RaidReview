// Balance simulator: plays whole raids with simulated students.
// Run: node tests/sim/simulate.mjs
//
// Each simulated student answers a question every few seconds (accuracy and
// speed are parameters), then picks an action with a simple class policy.
// `teamwork` is the chance a student notices a role call / ally in trouble and
// responds — it stands in for how well the class communicates.

import { createRaid, addPlayer, answer, act, canAct, startBoss, tick, restoreBetweenStages, isWeak } from '../../next/js/rules/engine.js';
import { startPuzzle, applyPuzzleOutcome } from '../../next/js/rules/puzzles.js';
import { CLASS_IDS } from '../../next/js/content/classes.js';
import { FORMATS } from '../../next/js/content/raid.js';

function rngFrom(seed) {
    return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function choose(s, p, now, rng, teamwork) {
    const b = s.boss;
    const call = b.attack?.call;
    const allies = Object.values(s.players);
    const down = allies.filter(a => a.status === 'down');
    const hurt = allies.filter(a => a.status === 'alive' && a.hp / a.maxHp < 0.6).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp);
    const ok = ab => canAct(s, p.id, ab, now) === '';
    const listens = rng() < teamwork;
    const callForMe = call && !call.done && listens && (call.cls === p.cls || call.cls === 'ANY' || (call.cls === 'ALL' && !call.who[p.cls]));

    // the last stand is on the projector in giant letters; most students answer it
    if (b.lastStand && !b.lastStand.done && !b.lastStand.who[p.cls] && ok('ult') && rng() < 0.5 + teamwork * 0.5) return { ability: 'ult' };
    if (callForMe && call.cls === p.cls) {
        const target = p.cls === 'MEDIC' ? (down[0] || hurt[0] || p) : (s.players[b.attack.targets[0]] || p);
        if (ok('special')) return { ability: 'special', target: target.id };
    }
    // the projector says this class hits the weak spot: supports switch to attacking
    if (listens && isWeak(s, p, now) && p.cls !== 'WARRIOR' && !(p.cls === 'MEDIC' && down.length)) return { ability: 'basic' };
    switch (p.cls) {
        case 'WARRIOR':
            if (ok('ult') && (b.exposedUntil > now || !listens)) return { ability: 'ult' };
            return ok('special') ? { ability: 'special' } : { ability: 'basic' };
        case 'GUARDIAN': {
            if (callForMe && ok('ult') && call.cls !== 'ANY') return { ability: 'ult' };
            const target = [...(b.attack?.targets || []), ...(b.telegraph?.targets || [])].map(id => s.players[id]).find(a => a && !a.shield && a.status === 'alive')
                || allies.find(a => a.status === 'alive' && !a.shield);
            if ((callForMe || listens) && ok('special') && target) return { ability: 'special', target: target.id };
            if (ok('ult') && b.attack && listens) return { ability: 'ult' };
            return { ability: 'basic' };
        }
        case 'MEDIC':
            if (ok('ult') && (down.length >= 2 || hurt.length >= 3)) return { ability: 'ult' };
            if (ok('special') && listens && down.length) return { ability: 'special', target: down[0].id };
            if (ok('special') && (callForMe || (listens && hurt.length))) return { ability: 'special', target: (hurt[0] || p).id };
            return { ability: 'basic' };
        case 'TACTICIAN':
            if (ok('ult') && b.attack && (callForMe || listens)) return { ability: 'ult' };
            if (ok('special') && (callForMe || b.exposedUntil <= now)) return { ability: 'special' };
            return { ability: 'basic' };
    }
}

export function simulateRaid({ students = 24, mix = null, accuracy = 0.75, answerSecs = 12, teamwork = 0.7, difficulty = 'regular', format = 'full', seed = 1 } = {}) {
    const rng = rngFrom(seed);
    const s = createRaid({ difficulty });
    const classes = mix || CLASS_IDS;
    for (let i = 0; i < students; i++) addPlayer(s, `p${i}`, { name: `S${i}`, cls: classes[i % classes.length] });
    const next = {};
    const stages = FORMATS[format].stages;
    let t = 0;
    const out = [], puzzles = [];
    for (const [si, spec] of stages.entries()) {
        if (spec.startsWith('puzzle')) {
            // a squad that communicates usually cracks it; one that doesn't usually fails
            startPuzzle(s, spec.split(':')[1] || 'vault', t, rng);
            const solved = rng() < Math.min(0.95, 0.2 + 0.8 * teamwork);
            s.puzzle.status = solved ? 'solved' : 'failed';
            applyPuzzleOutcome(s);
            puzzles.push(solved);
            t += 90000;
            continue;
        }
        if (si > 0 && !stages[si - 1].startsWith('puzzle')) restoreBetweenStages(s);
        const bossId = spec.slice(5);
        startBoss(s, bossId, t);
        const start = t;
        let wipes = 0, downs = 0, calls = 0, callsMet = 0, enraged = false;
        const dmgByClass = Object.fromEntries(CLASS_IDS.map(c => [c, 0]));
        for (const p of Object.values(s.players)) next[p.id] = t + rng() * answerSecs * 1000;
        while (!s.boss.defeatedAt && s.status === 'boss' && t - start < 20 * 60000) {
            t += 250;
            for (const e of tick(s, t, rng)) {
                if (e.type === 'wipe') wipes++;
                if (e.type === 'down' || e.type === 'eliminated') downs++;
                if (e.type === 'windup' && e.call) calls++;
                if (e.type === 'roleCallSuccess') callsMet++;
                if (e.type === 'enrage') enraged = true;
            }
            if (s.regroupUntil > t) continue;
            for (const p of Object.values(s.players)) {
                if (t < next[p.id]) continue;
                const correct = rng() < accuracy;
                answer(s, p.id, correct, t);
                let delay = answerSecs * 1000 * (0.5 + rng());
                if (correct && p.status === 'alive' && p.armed) {
                    const choice = choose(s, p, t, rng, teamwork);
                    for (const e of act(s, p.id, choice, t)) {
                        if (e.type === 'hit') dmgByClass[p.cls] += e.amount;
                        if (e.type === 'down' || e.type === 'eliminated') downs++;
                    }
                    delay += 1500;
                }
                next[p.id] = t + delay;
            }
        }
        out.push({ boss: bossId, secs: Math.round((t - start) / 1000), limit: Math.round((s.boss.endsAt - start) / 1000), won: !!s.boss.defeatedAt, wipes, downs, calls, callsMet, enraged, dmgByClass });
        if (s.status === 'defeat') break;
    }
    return { result: s.status === 'defeat' ? 'DEFEAT' : 'VICTORY', raidLivesLeft: s.raidLives, bosses: out, puzzles };
}

function summarize(label, runs) {
    const wins = runs.filter(r => r.result === 'VICTORY').length;
    const lives = runs.filter(r => r.result === 'VICTORY').map(r => r.raidLivesLeft);
    const lostAt = {};
    for (const r of runs) if (r.result === 'DEFEAT') { const b = r.bosses[r.bosses.length - 1].boss; lostAt[b] = (lostAt[b] || 0) + 1; }
    const byBoss = {};
    for (const r of runs) for (const b of r.bosses) {
        const x = byBoss[b.boss] ||= { n: 0, secs: 0, limit: 0, wipes: 0, downs: 0, calls: 0, met: 0, enraged: 0 };
        x.n++; x.secs += b.secs; x.limit += b.limit; x.wipes += b.wipes; x.downs += b.downs; x.calls += b.calls; x.met += b.callsMet; x.enraged += b.enraged ? 1 : 0;
    }
    console.log(`\n${label}: win ${wins}/${runs.length}` + (lives.length ? `  (wins with lives left: ${[1, 2, 3].map(n => `${n}♥ ${lives.filter(l => l === n).length}`).join(', ')})` : '') + (Object.keys(lostAt).length ? `  lost at: ${Object.entries(lostAt).map(([b, n]) => `${b} ${n}`).join(', ')}` : ''));
    for (const [id, x] of Object.entries(byBoss)) {
        console.log(`  ${id.padEnd(10)} ${String(Math.round(x.secs / x.n)).padStart(4)}s of ${String(Math.round(x.limit / x.n)).padStart(3)}s  wipes ${(x.wipes / x.n).toFixed(1)}  downs ${(x.downs / x.n).toFixed(1)}  role calls met ${x.calls ? Math.round(100 * x.met / x.calls) : 0}%  timer-enraged ${Math.round(100 * x.enraged / x.n)}%`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const N = +(process.env.SIM_RUNS || 40);
    const runs = cfg => Array.from({ length: N }, (_, i) => simulateRaid({ ...cfg, seed: i + 1 }));
    summarize('Typical class (24 students, mixed, 75% accuracy, good teamwork)', runs({}));
    summarize('Same class, so-so teamwork (45%)', runs({ teamwork: 0.45 }));
    summarize('Same class, poor teamwork (20%)', runs({ teamwork: 0.2 }));
    summarize('Warrior-heavy class (half Warriors)', runs({ mix: ['WARRIOR', 'GUARDIAN', 'WARRIOR', 'MEDIC', 'WARRIOR', 'TACTICIAN'] }));
    summarize('All Warriors', runs({ mix: ['WARRIOR'] }));
    summarize('Struggling class (55% accuracy, 15s answers)', runs({ accuracy: 0.55, answerSecs: 15 }));
    summarize('Small group (6 students)', runs({ students: 6 }));
    summarize('Elementary difficulty, 60% accuracy', runs({ difficulty: 'elementary', accuracy: 0.6, answerSecs: 15 }));
    summarize('Struggling class on Elementary (55%, 15s, so-so teamwork)', runs({ difficulty: 'elementary', accuracy: 0.55, answerSecs: 15, teamwork: 0.45 }));
    summarize('Heroic difficulty, strong class (85%)', runs({ difficulty: 'heroic', accuracy: 0.85 }));
}
