// The end-of-raid ceremony on the projector. It's the payoff for the whole
// raid, so it plays in beats the class can cheer for:
//
//   title    VICTORY (or RAID FAILED) slams in over every class crest
//   rank     the squad's totals count up, then the RAID RANK stamps down
//   classes  what each class did for the squad
//   awards   one award at a time, drum-roll style; the winner's own
//            Chromebook lights up at the same moment
//   (then the results page)
//
// Each beat is published as live/ending so student screens play along.
// The teacher can skip ahead at any time.

import { CLASSES, CLASS_IDS } from '../content/classes.js';
import { BOSSES } from '../content/raid.js';
import { AudioEngine as Audio } from '../audio.js';
import { mount, esc, fmtNum, flash, shake } from '../ui.js';
import { crest } from '../content/crests.js';
import { confetti } from '../student/juice.js';

export const AWARDS = [
    { id: 'mvp', title: 'RAID MVP', icon: '⚔️', stat: p => p.stats.dmg, fmt: v => `${fmtNum(v)} damage` },
    { id: 'lifesaver', title: 'LIFESAVER', icon: '💚', stat: p => p.stats.heal + p.stats.revives * 500, fmt: (v, p) => `${fmtNum(p.stats.heal)} healed · ${p.stats.revives} revives` },
    { id: 'wall', title: 'WALL OF STEEL', icon: '🛡️', stat: p => (p.stats.saves || 0) * 3 + p.stats.shields, fmt: (v, p) => `${p.stats.saves || 0} clutch saves · ${p.stats.shields} shields` },
    { id: 'caller', title: 'CLUTCH CALLER', icon: '📣', stat: p => p.stats.roleCalls, fmt: v => `${v} role calls answered` },
    { id: 'brain', title: 'BIG BRAIN', icon: '🧠', stat: p => p.stats.correct, fmt: (v, p) => `${v} correct · ${accuracy(p)}% accuracy` },
    { id: 'fire', title: 'ON FIRE', icon: '🔥', stat: p => p.stats.bestStreak, fmt: v => `${v} right in a row`, min: 5 }
];

export function accuracy(p) {
    const n = p.stats.correct + p.stats.wrong;
    return n ? Math.round((p.stats.correct / n) * 100) : 0;
}

// Each student wins at most one award, so they spread around the room
export function pickAwards(players) {
    const used = new Set(), out = [];
    for (const a of AWARDS) {
        const best = players.filter(p => !used.has(p.id)).sort((x, y) => a.stat(y) - a.stat(x))[0];
        if (!best || a.stat(best) <= 0 || (a.min && a.stat(best) < a.min)) continue;
        used.add(best.id);
        out.push({ id: a.id, title: a.title, icon: a.icon, pid: best.id, name: best.name, cls: best.cls, stat: a.fmt(a.stat(best), best) });
    }
    return out;
}

// The squad's grade. Built from things the class controls: accuracy, staying
// alive (raid lives), answering role calls, and cracking the puzzles.
export function raidRank({ won, accuracy: acc, livesLeft, maxLives, callsMet, callsMissed, puzzlesSolved, puzzles, difficulty }) {
    if (!won) return null;
    const calls = callsMet + callsMissed;
    let score = acc * 0.45
        + (livesLeft / Math.max(1, maxLives)) * 25
        + (calls ? callsMet / calls : 0.6) * 15
        + (puzzles ? puzzlesSolved / puzzles : 0.6) * 15;
    if (difficulty === 'heroic') score += 8;
    if (difficulty === 'elementary') score -= 5;
    const letter = score >= 86 ? 'S' : score >= 74 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';
    return { letter, score: Math.round(score) };
}

const RANK_LINES = { S: 'LEGENDARY SQUAD', A: 'ELITE SQUAD', B: 'SOLID SQUAD', C: 'THEY SURVIVED', D: 'BARELY MADE IT' };
const RANK_COLORS = { S: '#ffb020', A: '#c45cff', B: '#3fa7ff', C: '#2ed573', D: '#a0a4b8' };
export { RANK_LINES, RANK_COLORS };

// Everything the ceremony and the results page show, worked out once
export function ceremonyData(H, won) {
    const ps = Object.values(H.engine.players);
    const sum = k => ps.reduce((s, p) => s + (p.stats[k] || 0), 0);
    const correct = sum('correct'), wrong = sum('wrong');
    const acc = correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0;
    const log = H.engine.puzzleLog || [];
    const rank = raidRank({
        won, accuracy: acc, livesLeft: H.engine.raidLives, maxLives: 3,
        callsMet: H.counts.roleCallSuccess || 0, callsMissed: H.counts.roleCallFailed || 0,
        puzzlesSolved: log.filter(p => p.solved).length, puzzles: log.length, difficulty: H.engine.difficulty
    });
    const by = H.byClass || {};
    const dmgTotal = Math.max(1, sum('dmg'));
    const classes = CLASS_IDS.filter(c => ps.some(p => p.cls === c)).map(c => {
        const of = ps.filter(p => p.cls === c);
        const s = k => of.reduce((t, p) => t + (p.stats[k] || 0), 0);
        const ev = by[c] || {};
        // only what the class actually did (a row of zeros reads like a scolding)
        const parts = (n, one, many) => n > 0 ? [`${fmtNum(n)} ${n === 1 ? one : many}`] : [];
        const signature = {
            WARRIOR: [...parts(s('dmg'), 'damage', 'damage'), ...parts(ev.combo || 0, 'SHATTER combo', 'SHATTER combos')],
            GUARDIAN: [...parts(s('saves') + (ev.ricochet || 0), 'clutch save', 'clutch saves'), ...parts(s('shields'), 'shield', 'shields'), ...parts(ev.dome || 0, 'Iron Dome', 'Iron Domes')],
            MEDIC: [...parts(s('heal'), 'HP healed', 'HP healed'), ...parts(s('revives'), 'revive', 'revives'), ...parts(ev.cured || 0, 'cure', 'cures')],
            TACTICIAN: [...parts((ev.expose || 0) + (ev.breach || 0), 'expose', 'exposes & breaches'), ...parts(ev.interrupt || 0, 'interrupt', 'interrupts')]
        }[c];
        const fallback = [...parts(s('correct'), 'right answer', 'right answers'), ...parts(s('dmg'), 'damage', 'damage')];
        const line = (signature.length ? signature : fallback).slice(0, 2).join(' · ') || 'Held the line';
        return { cls: c, n: of.length, share: Math.round((s('dmg') / dmgTotal) * 100), line, roleCalls: s('roleCalls') };
    });
    const boss = H.engine.boss;
    return {
        won,
        bossName: boss ? BOSSES[boss.id]?.name || boss.name : '',
        bossLeft: boss && !won ? Math.ceil((boss.hp / boss.maxHp) * 100) : 0,
        stageReached: H.stageIdx + 1, stages: H.stages ? H.stages.length : 0,
        accuracy: acc, correct, answers: correct + wrong,
        // the four biggest things the squad did (skipping any that stayed at zero)
        totals: [
            { k: 'DAMAGE DEALT', v: sum('dmg') },
            { k: 'RIGHT ANSWERS', v: correct },
            { k: 'ROLE CALLS ANSWERED', v: H.counts.roleCallSuccess || 0 },
            { k: 'TEAMMATES REVIVED', v: sum('revives') },
            { k: 'HITS BLOCKED', v: H.counts.shieldBlock || 0 },
            { k: 'HERO MOMENTS', v: H.heroes.length },
            { k: 'ULTIMATES FIRED', v: sum('ults') },
            { k: 'UPGRADES UNLOCKED', v: Object.values(H.engine.perks || {}).reduce((t, l) => t + l.length, 0) }
        ].filter(t => t.v > 0).slice(0, 4),
        secs: H.raidStartedAt ? Math.round((Date.now() - H.raidStartedAt) / 1000) : 0,
        rank, classes, awards: pickAwards(ps)
    };
}

const AWARD_MS = 4200;
const BEATS = { title: 6000, rank: 8500, classes: 7500 };

export function runCeremony(H, won, done) {
    const D = ceremonyData(H, won);
    H.ceremony = D;
    let finished = false, timer = null;
    const publish = (step, extra = {}) => {
        // what student screens need (no stats they can't already see)
        H.ending = { step, won, rank: D.rank && step !== 'title' ? D.rank.letter : null, awards: D.awards.map(a => ({ id: a.id, title: a.title, icon: a.icon, pid: a.pid, name: a.name, cls: a.cls })), ...extra };
    };
    const finish = () => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        document.removeEventListener('keydown', onKey);
        publish('results', { shown: D.awards.length });
        done(D);
    };
    const onKey = e => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') next(); };
    document.addEventListener('keydown', onKey);

    const steps = ['title', ...(won ? ['rank'] : []), ...(D.classes.length > 1 ? ['classes'] : []), ...D.awards.map((_, i) => 'award' + i)];
    let i = -1;
    function next() {
        clearTimeout(timer);
        i++;
        if (i >= steps.length) return finish();
        const s = steps[i];
        if (s === 'title') showTitle(H, D);
        else if (s === 'rank') showRank(H, D);
        else if (s === 'classes') showClasses(H, D);
        else showAward(H, D, +s.slice(5));
        publish(s.startsWith('award') ? 'award' : s, s.startsWith('award') ? { shown: +s.slice(5) + 1 } : {});
        timer = setTimeout(next, s.startsWith('award') ? AWARD_MS : BEATS[s]);
    }

    mount(`<div class="cer" id="cer">
        <div class="cer-stage" id="cer-stage"></div>
        <button class="btn ghost cer-skip" id="cer-skip">SKIP TO RESULTS ▶▶</button>
        <button class="btn ghost cer-next" id="cer-next">NEXT ▶</button>
    </div>`);
    document.getElementById('cer-skip').onclick = finish;
    document.getElementById('cer-next').onclick = next;
    next();
}

const stage = () => document.getElementById('cer-stage');

function showTitle(H, D) {
    const ring = D.classes.map(c => `<div class="cer-crest" style="--cls:${CLASSES[c.cls].color}">${crest(c.cls, { size: 120, glow: true })}</div>`).join('');
    stage().innerHTML = D.won
        ? `<div class="cer-kicker">${esc(D.bossName)} DESTROYED</div>
           <div class="cer-title win">VICTORY</div>
           <div class="cer-crests">${ring}</div>
           <div class="cer-sub">Every boss defeated${D.secs ? ` in ${Math.floor(D.secs / 60)}:${String(D.secs % 60).padStart(2, '0')}` : ''}. That was ALL of you.</div>`
        : `<div class="cer-kicker">THE SQUAD FELL AT STAGE ${D.stageReached} OF ${D.stages}</div>
           <div class="cer-title lose">RAID FAILED</div>
           <div class="cer-crests">${ring}</div>
           <div class="cer-sub">${D.bossLeft && D.bossLeft <= 30 ? `SO CLOSE: ${esc(D.bossName)} had only ${D.bossLeft}% left!` : `${esc(D.bossName)} survived with ${D.bossLeft}% left.`} Talk it over and run it back.</div>`;
    if (D.won) { flash('#ffffff', 0.7); Audio.stinger('bossDown'); setTimeout(() => { confetti(220); Audio.stinger('hero'); }, 500); }
    else { flash('#ff2a3d', 0.4); }
}

function showRank(H, D) {
    const r = D.rank;
    stage().innerHTML = `<div class="cer-kicker">THE RAID IN NUMBERS</div>
        <div class="cer-totals">${D.totals.map((t, i) => `<div class="cer-total"><div class="v" data-to="${t.v}">0</div><div class="k">${t.k}</div></div>`).join('')}</div>
        <div class="cer-acc">CLASS ACCURACY <b>${D.accuracy}%</b> on ${D.answers} answers</div>
        <div class="cer-rank" id="cer-rank" hidden style="--rc:${RANK_COLORS[r.letter]}"><div class="k">RAID RANK</div><div class="l">${r.letter}</div><div class="t">${RANK_LINES[r.letter]}</div></div>`;
    countUp(stage().querySelectorAll('.cer-total .v'), 2600);
    Audio.sfxBuff();
    setTimeout(() => {
        const el = document.getElementById('cer-rank');
        if (!el) return;
        el.hidden = false;
        flash(RANK_COLORS[r.letter], 0.5); shake(document.getElementById('cer'));
        Audio.stinger(r.letter === 'S' || r.letter === 'A' ? 'hero' : 'combo');
        if (r.letter === 'S') confetti(160);
    }, 3400);
}

function showClasses(H, D) {
    stage().innerHTML = `<div class="cer-kicker">EVERY CLASS CARRIED</div>
        <div class="cer-classes">${D.classes.map((c, i) => `
            <div class="cer-class" style="--cls:${CLASSES[c.cls].color};animation-delay:${i * 0.35}s">
                ${crest(c.cls, { size: 96, glow: true })}
                <div class="n">${CLASSES[c.cls].name.toUpperCase()}S <span>×${c.n}</span></div>
                <div class="line">${esc(c.line)}</div>
                <div class="share"><i style="width:${c.share}%"></i></div>
                <div class="sk">${c.share}% of the damage${c.roleCalls ? ` · ${c.roleCalls} role call${c.roleCalls === 1 ? '' : 's'}` : ''}</div>
            </div>`).join('')}</div>`;
    Audio.stinger('combo');
}

function showAward(H, D, i) {
    const a = D.awards[i];
    stage().innerHTML = `<div class="cer-kicker">AWARD ${i + 1} OF ${D.awards.length}</div>
        <div class="cer-award-title">${a.icon} ${esc(a.title)}</div>
        <div class="cer-drum">AND IT GOES TO…</div>
        <div class="cer-award" id="cer-award" hidden style="--cls:${CLASSES[a.cls].color}">
            ${crest(a.cls, { size: 130, glow: true })}
            <div><div class="nm">${esc(a.name)}</div><div class="cl">${CLASSES[a.cls].name.toUpperCase()}</div><div class="st">${esc(a.stat)}</div></div>
        </div>`;
    Audio.stinger('telegraph');
    setTimeout(() => {
        const el = document.getElementById('cer-award');
        if (!el) return;
        el.hidden = false;
        const drum = stage().querySelector('.cer-drum'); if (drum) drum.style.opacity = '0.35';
        flash(CLASSES[a.cls].color, 0.45);
        Audio.stinger('hero'); confetti(70);
    }, 1500);
}

function countUp(els, ms) {
    const t0 = performance.now();
    const step = t => {
        const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
        els.forEach(el => { el.textContent = fmtNum(Math.round(+el.dataset.to * e)); });
        if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}
