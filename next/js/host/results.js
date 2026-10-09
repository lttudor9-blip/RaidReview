// End-of-raid results on the projector: awards, scoreboard, and the
// teacher's report of the most-missed questions (with a one-click re-run).

import { CLASSES } from '../content/classes.js';
import { mount, esc, fmtNum } from '../ui.js';
import { crest } from '../content/crests.js';
import { heroColor } from '../content/heroes.js';

const AWARDS = [
    { title: 'RAID MVP', stat: p => p.stats.dmg, fmt: v => `${fmtNum(v)} damage` },
    { title: 'LIFESAVER', stat: p => p.stats.heal + p.stats.revives * 500, fmt: (v, p) => `${fmtNum(p.stats.heal)} healed · ${p.stats.revives} revives` },
    { title: 'WALL OF STEEL', stat: p => (p.stats.saves || 0) * 3 + p.stats.shields, fmt: (v, p) => `${p.stats.saves || 0} clutch saves · ${p.stats.shields} shields` },
    { title: 'CLUTCH CALLER', stat: p => p.stats.roleCalls, fmt: v => `${v} role calls answered` },
    { title: 'BIG BRAIN', stat: p => p.stats.correct, fmt: (v, p) => `${v} correct · ${accuracy(p)}% accuracy` },
    { title: 'ON FIRE', stat: p => p.stats.bestStreak, fmt: v => `${v} in a row`, min: 5 }
];

function accuracy(p) {
    const n = p.stats.correct + p.stats.wrong;
    return n ? Math.round((p.stats.correct / n) * 100) : 0;
}

export function missedQuestions(H) {
    return H.questions.map((q, i) => {
        let r = 0, w = 0; const picks = {};
        for (const log of Object.values(H.qlog)) {
            const e = log[`q${i}`]; if (!e) continue;
            r += e.r; w += e.w;
            for (const [k, n] of Object.entries(e.m)) picks[k] = (picks[k] || 0) + n;
        }
        const top = Object.entries(picks).sort((a, b) => b[1] - a[1])[0];
        return { i, q, r, w, total: r + w, pct: r + w ? Math.round((w / (r + w)) * 100) : 0, topWrong: top ? q.answers[+top[0].slice(1)] : null };
    }).filter(x => x.w > 0).sort((a, b) => b.pct - a.pct || b.w - a.w);
}

export function renderResults(H, won) {
    const ps = Object.values(H.engine.players);
    const used = new Set();
    const awards = [];
    for (const a of AWARDS) {
        const best = ps.filter(p => !used.has(p.id)).sort((x, y) => a.stat(y) - a.stat(x))[0];
        if (!best || a.stat(best) <= 0 || (a.min && a.stat(best) < a.min)) continue;
        used.add(best.id);
        awards.push({ ...a, p: best, value: a.stat(best) });
    }
    const missed = missedQuestions(H);
    const totalR = ps.reduce((s, p) => s + p.stats.correct, 0), totalW = ps.reduce((s, p) => s + p.stats.wrong, 0);
    const classAcc = totalR + totalW ? Math.round((totalR / (totalR + totalW)) * 100) : 0;

    mount(`
    <div class="screen center">
        <div class="results">
            <div style="text-align:center">
                <div class="display" style="font-size:clamp(3rem,8vw,6rem);color:${won ? '#2ed573' : '#ff4757'};animation:slam .8s both">${won ? 'RAID COMPLETE' : 'RAID FAILED'}</div>
                <div class="muted" style="font-size:1.3rem">${won ? 'Every boss defeated.' : `The squad made it to stage ${H.stageIdx + 1} of ${H.stages.length}.`} Class accuracy: <b class="gold">${classAcc}%</b> on ${totalR + totalW} answers.</div>
            </div>
            ${awards.length && ps.length > 1 ? `<div class="awards">${awards.map(a => `
                <div class="award" data-cls="${a.p.cls}" style="display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center">${crest(a.p.cls, { size: 64, glow: true })}<div><div class="aw-title">${a.title}</div><div class="aw-name">${esc(a.p.name)}</div><div class="aw-stat">${CLASSES[a.p.cls].name} · ${a.fmt(a.value, a.p)}</div></div></div>`).join('')}</div>` : ''}
            ${H.heroes.length ? `<div class="panel"><div class="label" style="margin-bottom:8px">★ HERO MOMENTS</div>${H.heroes.slice(0, 8).map(h => `
                <div class="missed-row" style="grid-template-columns:auto 1fr;align-items:center"><div style="display:flex;gap:4px">${h.pids.map(pid => H.engine.players[pid]).filter(Boolean).map(p => crest(p.cls, { size: 40 })).join('') || '★'}</div>
                <div><div class="display" style="font-size:1.15rem;color:${heroColor(h.kind)}">${esc(h.title)}</div><div class="muted">${esc(h.sub)}</div></div></div>`).join('')}</div>` : ''}
            <div class="panel">
                <div class="label" style="margin-bottom:8px">MOST MISSED QUESTIONS — WHAT TO RETEACH</div>
                ${missed.length ? missed.slice(0, 6).map(m => `
                    <div class="missed-row"><div class="pct">${m.pct}%</div><div>
                        <div style="font-weight:700;font-size:1.1rem">${esc(m.q.text)}</div>
                        <div class="muted">Answer: <span style="color:#2ed573">${esc(m.q.answers[m.q.correct])}</span>${m.topWrong ? ` · most picked wrong: <span style="color:#ff4757">${esc(m.topWrong)}</span>` : ''} · missed ${m.w} of ${m.total} tries</div>
                    </div></div>`).join('') : '<div class="muted">Nobody missed a question. Wow.</div>'}
            </div>
            <div class="panel">
                <div class="label" style="margin-bottom:6px">SCOREBOARD</div>
                <table class="board"><thead><tr><th>#</th><th>NAME</th><th>CLASS</th><th class="num">DAMAGE</th><th class="num">HEALED</th><th class="num">SHIELDS</th><th class="num">ROLE CALLS</th><th class="num">ACCURACY</th></tr></thead>
                <tbody>${[...ps].sort((a, b) => b.stats.dmg - a.stats.dmg).map((p, i) => `
                    <tr data-cls="${p.cls}"><td>${i + 1}</td><td style="font-weight:700;color:var(--cls)">${esc(p.name)}</td><td>${CLASSES[p.cls].name}</td>
                    <td class="num">${fmtNum(p.stats.dmg)}</td><td class="num">${fmtNum(p.stats.heal)}</td><td class="num">${p.stats.shields}</td><td class="num">${p.stats.roleCalls}</td><td class="num">${accuracy(p)}%</td></tr>`).join('')}</tbody></table>
            </div>
            <div class="row" style="justify-content:center;flex-wrap:wrap">
                ${missed.length ? `<button class="btn gold big" id="r-missed">RE-RAID THE ${Math.min(missed.length, 10)} MOST-MISSED</button>` : ''}
                <button class="btn primary big" id="r-again">NEW RAID, SAME QUESTIONS</button>
                <button class="btn ghost big" id="r-home">DASHBOARD</button>
            </div>
        </div>
    </div>`);

    const relaunch = (questions, title) => {
        try {
            localStorage.setItem('rr_launch_questions', JSON.stringify(questions));
            localStorage.setItem('rr_launch_set_title', title);
        } catch (e) { /* storage blocked */ }
        location.href = 'play.html?host=1';
    };
    const btnMissed = document.getElementById('r-missed');
    if (btnMissed) btnMissed.onclick = () => relaunch(missed.slice(0, 10).map(m => m.q), `${H.title} — Missed`);
    document.getElementById('r-again').onclick = () => relaunch(H.questions, H.title);
    document.getElementById('r-home').onclick = () => { location.href = 'index.html'; };
}
