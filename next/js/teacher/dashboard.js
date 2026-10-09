// Teacher dashboard: your BattleSets, search, and launching a raid.

import { listSets, saveSet, deleteSet, newSetId, launch, DEMO_SET } from './sets.js';
import { questionIssues } from './importer.js';
import { crest } from '../content/crests.js';
import { CLASS_IDS } from '../content/classes.js';
import { esc, toast } from '../ui.js';

let sets = [];
let filter = { q: '', sort: 'recent' };

function ago(t) {
    if (!t) return 'built in';
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
    return new Date(t).toLocaleDateString();
}

export async function renderDashboard(root, user) {
    root.innerHTML = `
    <div class="dash">
        <div class="dash-hero">
            <div>
                <div class="label">WELCOME BACK${user.email ? ', ' + esc(user.email.split('@')[0].toUpperCase()) : ''}</div>
                <div class="dash-title">YOUR BATTLESETS</div>
                <div class="muted">Pick a set and hit LAUNCH. Students join with the code on your projector.</div>
            </div>
            <div class="dash-hero-actions">
                <a class="btn gold big" href="#/new">+ NEW BATTLESET</a>
            </div>
        </div>
        <div class="dash-tools">
            <input class="field" id="d-q" placeholder="Search your sets…" value="${esc(filter.q)}">
            <div class="seg" id="d-sort">${[['recent', 'RECENT'], ['az', 'A–Z'], ['size', 'MOST QUESTIONS']].map(([k, l]) => `<button data-v="${k}" class="${filter.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div class="dash-grid" id="d-grid"><div class="muted">Loading your sets…</div></div>
    </div>`;
    document.getElementById('d-q').oninput = e => { filter.q = e.target.value; drawGrid(user); };
    document.getElementById('d-sort').onclick = e => {
        const v = e.target.dataset?.v; if (!v) return;
        filter.sort = v;
        document.querySelectorAll('#d-sort button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
        drawGrid(user);
    };
    try { sets = await listSets(user.uid); }
    catch (e) { sets = []; toast('Couldn\'t load your sets. Check your connection.'); }
    drawGrid(user);
}

function drawGrid(user) {
    const grid = document.getElementById('d-grid');
    if (!grid) return;
    const q = filter.q.trim().toLowerCase();
    let list = sets.filter(s => !q || s.title.toLowerCase().includes(q) || (s.subject || '').toLowerCase().includes(q));
    list.sort(filter.sort === 'az' ? (a, b) => a.title.localeCompare(b.title)
        : filter.sort === 'size' ? (a, b) => b.questions.length - a.questions.length
        : (a, b) => (b.modified || 0) - (a.modified || 0));
    const cards = list.map(s => setCard(s)).join('');
    const demo = !q || 'ancient egypt demo'.includes(q) ? setCard(DEMO_SET) : '';
    grid.innerHTML = (cards || demo)
        ? `<a class="set-card new" href="#/new"><div class="new-plus">+</div><div class="set-title">NEW BATTLESET</div><div class="muted">Type, paste, or import questions</div></a>${cards}${demo}`
        : `<div class="muted">No sets match "${esc(filter.q)}".</div>`;
    grid.onclick = e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const set = b.dataset.id === DEMO_SET.id ? DEMO_SET : sets.find(s => s.id === b.dataset.id);
        if (!set) return;
        const act = b.dataset.act;
        if (act === 'launch') openLaunch(set);
        if (act === 'edit') location.hash = `#/edit/${encodeURIComponent(set.id)}`;
        if (act === 'copy') copySet(user, set);
        if (act === 'delete') removeSet(user, set);
    };
}

function setCard(s) {
    const mc = s.questions.filter(q => q.type !== 'tf').length, tf = s.questions.length - mc;
    const issues = s.questions.filter(q => questionIssues(q).length).length;
    return `<div class="set-card">
        <div class="set-top"><span class="chip">${esc((s.subject || 'GENERAL').toUpperCase())}</span>${s.builtin ? '<span class="chip gold">DEMO</span>' : ''}${issues ? `<span class="chip" style="color:#ff6b81" title="Some questions need fixing">⚠ ${issues} TO FIX</span>` : ''}</div>
        <div class="set-title">${esc(s.title)}</div>
        <div class="set-meta">${s.questions.length} questions · ${mc} multiple choice${tf ? ` · ${tf} true/false` : ''}</div>
        <div class="set-meta">${s.builtin ? 'Built-in example set' : 'Edited ' + ago(s.modified)}</div>
        <div class="set-actions">
            <button class="btn go" data-act="launch" data-id="${esc(s.id)}" ${s.questions.length ? '' : 'disabled'}>▶ LAUNCH</button>
            ${s.builtin ? `<button class="btn" data-act="copy" data-id="${esc(s.id)}">COPY & EDIT</button>`
                : `<button class="btn" data-act="edit" data-id="${esc(s.id)}">EDIT</button><button class="btn ghost icon" data-act="copy" data-id="${esc(s.id)}" title="Duplicate">⧉</button><button class="btn ghost icon danger" data-act="delete" data-id="${esc(s.id)}" title="Delete">🗑</button>`}
        </div>
    </div>`;
}

async function copySet(user, set) {
    const copy = { ...JSON.parse(JSON.stringify(set)), id: newSetId(), title: set.builtin ? set.title.replace(' (Demo)', '') : set.title + ' (copy)', builtin: false, created: Date.now() };
    await saveSet(user.uid, copy);
    location.hash = `#/edit/${encodeURIComponent(copy.id)}`;
}

async function removeSet(user, set) {
    if (!confirm(`Delete "${set.title}"? This can't be undone.`)) return;
    await deleteSet(user.uid, set.id);
    sets = sets.filter(s => s.id !== set.id);
    drawGrid(user);
    toast('Set deleted');
}

// ================================================================= launch

export function openLaunch(set) {
    const m = document.getElementById('auth');
    m.innerHTML = `<div class="modal-box wide">
        <button class="modal-x" id="l-x">×</button>
        <div class="label" style="text-align:center">LAUNCHING</div>
        <div class="modal-title">${esc(set.title)}</div>
        <div class="muted" style="text-align:center;margin-bottom:16px">${set.questions.length} questions. Pick a game mode; you'll set difficulty and raid length in the lobby.</div>
        <div class="launch-grid">
            <button class="launch-card raid" data-game="raid">
                <div class="row" style="justify-content:center;gap:4px">${CLASS_IDS.map(c => crest(c, { size: 40 })).join('')}</div>
                <div class="launch-name">RAID REVIEW</div>
                <div class="muted">Co-op boss raid. The whole class vs. the bosses. <b class="gold">New version</b></div>
            </button>
            <button class="launch-card dz" data-game="darkzone">
                <div class="launch-icon">⚔</div>
                <div class="launch-name">DARK ZONE</div>
                <div class="muted">Team vs. team PvP battle.</div>
            </button>
        </div>
        <button class="modal-link-btn" data-game="classic">Use the classic Raid Review instead</button>
    </div>`;
    m.hidden = false;
    m.onclick = e => {
        if (e.target === m || e.target.id === 'l-x') { m.hidden = true; return; }
        const g = e.target.closest('[data-game]');
        if (g) launch(set, g.dataset.game);
    };
}
