// HOST — the teacher's projector screen and the one true copy of the game.
//
// Students send intents into their own player node; the host feeds them through
// the rules engine, runs the boss clock, and writes the results back. The
// director walks the raid's stage timeline: intro → fight → outro → next stage.

import { createRaid, addPlayer, removePlayer, answer, act, tick, startBoss, restoreBetweenStages, shiftTime, synergyLevel } from '../rules/engine.js';
import { CLASSES, CLASS_IDS, SYNERGY_MULT } from '../content/classes.js';
import { BOSSES, FORMATS, DIFFICULTY } from '../content/raid.js';
import { createRoom, listenRoom, updateRoom } from '../net/room.js';
import { AudioEngine as Audio } from '../audio.js';
import { mount, esc, $, floater, flash, shake, fmtNum, fmtClock, pct, toast } from '../ui.js';
import { renderResults } from './results.js';

const CALLSIGN_A = ['SHADOW', 'IRON', 'GHOST', 'STORM', 'CRIMSON', 'STEEL', 'FROST', 'VOID', 'NEON', 'SILENT', 'RAPID', 'RAZOR', 'COSMIC', 'ROGUE', 'APEX', 'DUSK', 'EMBER', 'COBALT', 'SOLAR', 'ONYX'];
const CALLSIGN_B = ['VIPER', 'PHOENIX', 'WOLF', 'HAWK', 'TITAN', 'PHANTOM', 'STRIKER', 'BLADE', 'WRAITH', 'SURGE', 'FANG', 'NOVA', 'COBRA', 'RAVEN', 'SPECTER', 'RAPTOR', 'CIPHER', 'BOLT', 'SENTRY', 'COMET'];
const TICK_MS = 250;

export async function startHost({ questions, title, hostUid }) {
    const H = {
        code: null, questions, title,
        settings: { difficulty: 'regular', format: 'standard', shuffle: true, callsigns: false, locked: false },
        engine: null, room: null,
        stageIdx: -1, stage: null,          // { kind, id, phase, t0 }
        processed: new Set(), pending: {}, last: {},
        qlog: {}, feed: [], fx: [], fxSeq: 0,
        paused: false, pausedAt: 0, ended: false,
        boss: null, ui: {}, assists: { strike: true, rally: true },
        callsignsUsed: new Set(), names: {},
        counts: {}, // event tally, for the end screen and debugging
        pfx: {},    // per-student effect channels
        callouts: {}
    };
    H.engine = createRaid({ difficulty: H.settings.difficulty });
    H.code = await createRoom({ hostUid, title, questions, settings: H.settings });
    window.__rrHost = H; // handy for debugging from the console

    listenRoom(H.code, room => { if (room) onRoom(H, room); });
    renderLobby(H);
    setInterval(() => loop(H), TICK_MS);
    return H;
}

// ================================================================= room sync

function displayName(H, pid, profileName) {
    if (!H.settings.callsigns) return profileName;
    if (!H.names[pid]) {
        let n;
        for (let i = 0; i < 50; i++) {
            n = `${CALLSIGN_A[Math.floor(Math.random() * 20)]} ${CALLSIGN_B[Math.floor(Math.random() * 20)]}`;
            if (!H.callsignsUsed.has(n)) break;
        }
        H.callsignsUsed.add(n);
        H.names[pid] = n;
    }
    return H.names[pid];
}

function onRoom(H, room) {
    H.room = room;
    const players = room.players || {};
    const inLobby = !H.stage;
    // join / leave / class changes
    for (const [pid, node] of Object.entries(players)) {
        const prof = node.profile;
        if (!prof || !prof.cls || !CLASSES[prof.cls]) continue;
        const existing = H.engine.players[pid];
        if (!existing) {
            addPlayer(H.engine, pid, { name: displayName(H, pid, prof.name), cls: prof.cls });
            if (!inLobby) logFeed(H, `<b>${esc(H.engine.players[pid].name)}</b> joined the raid`);
        } else if (inLobby && existing.cls !== prof.cls) {
            removePlayer(H.engine, pid);
            addPlayer(H.engine, pid, { name: displayName(H, pid, prof.name), cls: prof.cls });
        }
    }
    if (inLobby) {
        for (const pid of Object.keys(H.engine.players)) if (!players[pid]) removePlayer(H.engine, pid);
        renderLobbySquad(H);
    }
    // intents, oldest first
    for (const [pid, node] of Object.entries(players)) {
        if (!node.intents) continue;
        for (const key of Object.keys(node.intents).sort()) {
            const id = pid + '/' + key;
            if (H.processed.has(id)) continue;
            H.processed.add(id);
            H.pending[`players/${pid}/intents/${key}`] = null;
            applyIntent(H, pid, node.intents[key]);
        }
    }
}

function applyIntent(H, pid, it) {
    if (!it || !H.engine.players[pid] || H.ended) return;
    const now = Date.now();
    if (it.t === 'a') {
        const q = H.questions[it.q];
        if (!q) return;
        const correct = it.p === q.correct;
        logQuestion(H, pid, it.q, it.p, correct);
        handle(H, answer(H.engine, pid, correct, now));
    } else if (it.t === 'c') {
        // student callout: NEED HEALS / SHIELD ME / ULT READY
        if (!['heal', 'shield', 'ult'].includes(it.k)) return;
        H.callouts[pid] = { k: it.k, at: now };
        logFeed(H, `<b>${nameOf(H, pid)}</b>: ${{ heal: 'NEED HEALS!', shield: 'SHIELD ME!', ult: 'ULTIMATE READY!' }[it.k]}`);
    } else if (it.t === 'x') {
        if (H.paused || H.stage?.phase !== 'fight') return;
        handle(H, act(H.engine, pid, { ability: it.ab, target: it.tg || null }, now));
    }
}

function logQuestion(H, pid, qi, picked, correct) {
    const log = (H.qlog[pid] ||= {});
    const e = (log[`q${qi}`] ||= { r: 0, w: 0, m: {} });
    if (correct) e.r++;
    else { e.w++; e.m[`a${picked}`] = (e.m[`a${picked}`] || 0) + 1; }
}

// ================================================================= main loop

function loop(H) {
    const now = Date.now();
    if (H.stage?.phase === 'fight' && !H.paused && !H.ended) {
        handle(H, tick(H.engine, now));
    }
    flush(H);
    if (H.stage?.phase === 'fight') renderFight(H, now);
}

const clean = v => JSON.parse(JSON.stringify(v, (k, x) => (x === Infinity ? 9e15 : x)));

function flush(H) {
    if (!H.code) return;
    const out = H.pending;
    H.pending = {};
    const e = H.engine;
    const live = {
        status: e.status, raidLives: e.raidLives, regroupUntil: e.regroupUntil,
        stage: H.stage, stageCount: H.stages ? H.stages.length : 0, stageIdx: H.stageIdx,
        boss: e.boss, team: e.team, paused: H.paused, fx: H.fx,
        clock: Date.now() // students sync their countdowns to the host's clock
    };
    for (const [k, v] of Object.entries(live)) setIfChanged(H, out, `live/${k}`, v);
    for (const p of Object.values(e.players)) {
        const pub = { id: p.id, name: p.name, cls: p.cls, hp: p.hp, maxHp: p.maxHp, lives: p.lives, status: p.status, ult: p.ult, cd: p.cd, streak: p.streak, armed: p.armed, shield: p.shield, infected: p.infected, revive: p.revive, callout: H.callouts[p.id] || null };
        setIfChanged(H, out, `players/${p.id}/pub`, pub);
        setIfChanged(H, out, `players/${p.id}/stats`, p.stats);
        if (H.qlog[p.id]) setIfChanged(H, out, `players/${p.id}/qlog`, H.qlog[p.id]);
        if (H.pfx[p.id]) setIfChanged(H, out, `players/${p.id}/fx`, H.pfx[p.id]);
    }
    if (Object.keys(out).length) updateRoom(H.code, out).catch(err => console.error('write failed', err));
}

function setIfChanged(H, out, path, value) {
    const v = value === undefined ? null : clean(value);
    const s = JSON.stringify(v);
    if (H.last[path] === s) return;
    H.last[path] = s;
    out[path] = v;
}

// ================================================================= events → visuals

// Team-wide moments every Chromebook reacts to
const TEAM_FX = new Set(['infectionSpread', 'roleCallSuccess', 'roleCallFailed', 'combo', 'synergy', 'rally', 'wipe', 'regrouped', 'domeBlock', 'dome', 'massHeal', 'interrupt', 'phase', 'enrage', 'windup', 'attack', 'bossDefeated', 'breach', 'expose']);
// Personal moments go to each involved student's own channel (players/{pid}/fx),
// so a busy room never pushes someone's damage number out of the shared list
const PERSONAL_KEYS = ['pid', 'target', 'by'];

function nameOf(H, pid) { return esc(H.engine.players[pid]?.name || '?'); }

function handle(H, events) {
    for (const ev of events) {
        H.counts[ev.type] = (H.counts[ev.type] || 0) + 1;
        if (TEAM_FX.has(ev.type)) {
            H.fx.push({ s: ++H.fxSeq, ...ev });
            if (H.fx.length > 25) H.fx.shift();
        }
        for (const pid of new Set(PERSONAL_KEYS.map(k => ev[k]).filter(Boolean))) {
            if (!H.engine.players[pid]) continue;
            const list = (H.pfx[pid] ||= []);
            list.push({ s: ++H.fxSeq, ...ev });
            if (list.length > 10) list.shift();
        }
        visual(H, ev);
    }
}

function visual(H, ev) {
    const boss = H.boss;
    const layer = H.ui.fx;
    const cls = pid => H.engine.players[pid]?.cls;
    const color = pid => CLASSES[cls(pid)]?.color || '#fff';
    switch (ev.type) {
        case 'hit': {
            boss && boss.hit(ev.amount, { crit: ev.crit || !!ev.combo || ev.ability === 'ult' });
            floater(layer, (ev.crit ? 'CRIT ' : '') + fmtNum(ev.amount), { color: color(ev.pid), size: ev.ability === 'ult' ? '3.4rem' : ev.crit ? '2.6rem' : '1.9rem', x: 30 + Math.random() * 40, y: 30 + Math.random() * 30 });
            Audio.sfxHit(ev.amount);
            if (ev.ability === 'ult') { flash(color(ev.pid), 0.35); shake(H.ui.arena); }
            break;
        }
        case 'ult': logFeed(H, `<b style="color:${color(ev.pid)}">${nameOf(H, ev.pid)}</b> unleashed <b>${esc(ev.name)}</b>!`); Audio.sfxUltimate(); break;
        case 'combo': floater(layer, ev.name + '!', { color: '#ffa502', size: '4.5rem', y: 38 }); flash('#ffa502', 0.4); logFeed(H, `<b class="gold">${esc(ev.name)}</b> combo by ${nameOf(H, ev.pid)}`); break;
        case 'synergy': floater(layer, `SYNERGY ×${ev.mult}`, { color: '#ffa502', size: '2.6rem', y: 72 }); if (ev.level === 4) { Audio.sfxStreak(); logFeed(H, '<b class="gold">FULL SYNERGY</b> — all four classes in the fight!'); } break;
        case 'heal': if (ev.amount > 0) logFeed(H, `${nameOf(H, ev.pid)} healed ${nameOf(H, ev.target)}`); Audio.sfxHeal(); break;
        case 'shield': logFeed(H, `${nameOf(H, ev.pid)} shielded ${nameOf(H, ev.target)}`); Audio.sfxShield(); break;
        case 'expose': floater(layer, 'EXPOSED', { color: CLASSES.TACTICIAN.color, size: '2.4rem', y: 25 }); Audio.sfxBuff(); break;
        case 'dome': floater(layer, 'IRON DOME', { color: CLASSES.GUARDIAN.color, size: '3rem', y: 75 }); break;
        case 'massHeal': floater(layer, 'FIELD HOSPITAL', { color: CLASSES.MEDIC.color, size: '3rem', y: 75 }); break;
        case 'breach': case 'interrupt':
            if (ev.type === 'interrupt') { boss && boss.cancelWindUp(); floater(layer, 'INTERRUPTED!', { color: CLASSES.TACTICIAN.color, size: '3.2rem', y: 30 }); logFeed(H, `${nameOf(H, ev.pid)} <b>interrupted</b> the boss!`); }
            break;
        case 'revive': logFeed(H, ev.by ? `${nameOf(H, ev.by)} <b>revived</b> ${nameOf(H, ev.pid)}` : `${nameOf(H, ev.pid)} rebooted`); break;
        case 'down': logFeed(H, `<b style="color:#ff4757">${nameOf(H, ev.pid)} is down!</b>`); break;
        case 'eliminated': logFeed(H, `${nameOf(H, ev.pid)} is out — now a spirit`); break;
        case 'windup': {
            boss && boss.windUp(ev.landsAt - Date.now());
            logFeed(H, `<b style="color:#ff4757">${esc(ev.name)}</b> incoming`);
            if (ev.call) Audio.sfxCountdown();
            break;
        }
        case 'attack': boss && boss.release(); flash('#ff2a3d', 0.25); shake(H.ui.arena); break;
        case 'roleCallSuccess':
            boss && boss.cancelWindUp(); boss && boss.hit(ev.reflect, { crit: true });
            floater(layer, 'BLOCKED! ' + fmtNum(ev.reflect) + ' REFLECTED', { color: '#2ed573', size: '2.6rem', y: 35 });
            Audio.sfxPuzzleSolve(); logFeed(H, '<b style="color:#2ed573">Role call answered!</b> Attack stopped.');
            break;
        case 'roleCallFailed': logFeed(H, '<b style="color:#ff4757">Role call missed</b>'); break;
        case 'domeBlock': boss && boss.release(); floater(layer, 'DOME HOLDS', { color: CLASSES.GUARDIAN.color, size: '2.6rem', y: 70 }); break;
        case 'infected': logFeed(H, `${nameOf(H, ev.pid)} is <b style="color:#7bed9f">infected</b> — Medics!`); break;
        case 'infectionSpread': logFeed(H, `The virus spread to ${nameOf(H, ev.pid)}`); break;
        case 'cured': logFeed(H, `${nameOf(H, ev.pid)} cured ${nameOf(H, ev.target)}`); break;
        case 'rally': floater(layer, 'SPIRIT RALLY', { color: '#9fd0ff', size: '3rem', y: 70 }); logFeed(H, 'The fallen rallied the team: +20% HP'); break;
        case 'phase':
            boss && boss.setPhase(ev.phase);
            Audio.setPhase(ev.phase);
            floater(layer, `BOSS ${ev.phase}!`, { color: ev.phase === 'DESPERATE' ? '#ff4757' : '#ffa502', size: '3.6rem', y: 50 });
            flash(ev.phase === 'DESPERATE' ? '#ff4757' : '#ffa502', 0.3);
            break;
        case 'enrage': floater(layer, 'TIME\'S UP — BOSS ENRAGED', { color: '#ff4757', size: '3rem', y: 50 }); boss && boss.setPhase('ENRAGED'); break;
        case 'wipe': showWipe(H, ev); break;
        case 'regrouped': hideOverlay(H); Audio.setPhase(H.engine.boss?.phase || 'NORMAL'); break;
        case 'bossDefeated': onBossDefeated(H); break;
        case 'raidDefeat': endRaid(H, false); break;
    }
}

function logFeed(H, html) {
    H.feed.push(html);
    if (H.feed.length > 40) H.feed.shift();
    const el = H.ui.feed;
    if (el) { const d = document.createElement('div'); d.innerHTML = html; el.prepend(d); while (el.children.length > 12) el.lastChild.remove(); }
}

// ================================================================= director

function beginRaid(H) {
    if (!Object.keys(H.engine.players).length) return toast('Wait for at least one student to pick a class');
    Audio.init(); Audio.ensureCtx();
    H.engine.difficulty = H.settings.difficulty;
    // re-roll player HP for the chosen difficulty
    for (const p of Object.values(H.engine.players)) {
        const maxHp = Math.round(CLASSES[p.cls].hp * DIFFICULTY[H.settings.difficulty].playerHp);
        p.maxHp = maxHp; p.hp = maxHp;
    }
    H.stages = FORMATS[H.settings.format].stages;
    updateRoom(H.code, { 'meta/locked': true, 'meta/difficulty': H.settings.difficulty, 'meta/format': H.settings.format, 'meta/shuffle': H.settings.shuffle }).catch(() => {});
    enterStage(H, 0);
}

function enterStage(H, i) {
    H.stageIdx = i;
    const spec = H.stages[i];
    if (!spec) return endRaid(H, true);
    if (spec.startsWith('boss:')) {
        const id = spec.slice(5);
        H.stage = { kind: 'boss', id, phase: 'intro', t0: Date.now() };
        H.assists = { strike: true, rally: true };
        showBossIntro(H, id, () => {
            handle(H, startBoss(H.engine, id, Date.now()));
            H.stage = { kind: 'boss', id, phase: 'fight', t0: Date.now() };
            renderFightScreen(H);
            Audio.setPhase('NORMAL');
        });
    } else {
        // Raid stages between bosses arrive in the next milestone; for now a supply drop.
        H.stage = { kind: 'rest', id: 'supply', phase: 'rest', t0: Date.now() };
        handle(H, restoreBetweenStages(H.engine));
        showOverlay(H, `<div class="label">BETWEEN BOSSES</div><div class="big gold">SUPPLY DROP</div><div class="sub">Everyone is patched up. Get ready.</div>`);
        setTimeout(() => { hideOverlay(H); enterStage(H, i + 1); }, 6000);
    }
}

function onBossDefeated(H) {
    H.stage = { ...H.stage, phase: 'outro', t0: Date.now() };
    Audio.stopMusic(); Audio.sfxBossDeath();
    flash('#ffffff', 0.5);
    logFeed(H, `<b class="gold">${esc(BOSSES[H.stage.id].name)} DEFEATED</b>`);
    const done = () => {
        const last = H.stageIdx >= H.stages.length - 1;
        if (last) return endRaid(H, true);
        handle(H, restoreBetweenStages(H.engine));
        Audio.sfxWaveClear();
        const next = H.stages[H.stageIdx + 1];
        const nextBoss = next.startsWith('boss:') ? BOSSES[next.slice(5)] : null;
        showOverlay(H, `<div class="label">STAGE ${H.stageIdx + 1} OF ${H.stages.length} CLEARED</div>
            <div class="big" style="color:#2ed573">BOSS DOWN!</div>
            <div class="sub">Squad patched up: +40% HP, +15% ultimate charge${nextBoss ? `<br>Next: <b style="color:${nextBoss.color}">${esc(nextBoss.name)}</b>` : ''}</div>`);
        setTimeout(() => { hideOverlay(H); enterStage(H, H.stageIdx + 1); }, 5500);
    };
    if (H.boss) H.boss.die(() => setTimeout(done, 600)); else setTimeout(done, 1500);
}

function endRaid(H, won) {
    if (H.ended) return;
    H.ended = true;
    H.stage = { kind: 'end', id: won ? 'victory' : 'defeat', phase: 'end', t0: Date.now() };
    H.engine.status = won ? 'victory' : 'defeat';
    Audio.stopMusic();
    won ? Audio.sfxVictory() : Audio.sfxDefeat();
    flush(H);
    renderResults(H, won);
}

function togglePause(H) {
    if (H.stage?.phase !== 'fight') return;
    if (!H.paused) { H.paused = true; H.pausedAt = Date.now(); Audio.stopMusic(); showOverlay(H, '<div class="big">PAUSED</div><div class="sub">Eyes up front!</div>'); }
    else { shiftTime(H.engine, Date.now() - H.pausedAt); H.paused = false; hideOverlay(H); Audio.setPhase(H.engine.boss.phase); }
}

function teacherAssist(H, kind) {
    const b = H.engine.boss;
    if (!b || H.stage?.phase !== 'fight' || !H.assists[kind]) return;
    H.assists[kind] = false;
    if (kind === 'strike') {
        const amount = Math.round(b.maxHp * 0.06);
        b.hp = Math.max(1, b.hp - amount);
        visual(H, { type: 'hit', pid: null, amount, crit: true, ability: 'ult' });
        logFeed(H, `<b class="gold">Teacher air strike!</b> ${fmtNum(amount)} damage`);
    } else {
        for (const p of Object.values(H.engine.players)) p.ult = Math.min(100, p.ult + 25);
        floater(H.ui.fx, 'RALLY! +25% ULT', { color: '#ffa502', size: '3rem', y: 70 });
        logFeed(H, '<b class="gold">Teacher rally!</b> Everyone +25% ultimate');
    }
    renderControls(H);
}

// ================================================================= overlays

function overlayEl() {
    let o = document.getElementById('overlay');
    if (!o) { o = document.createElement('div'); o.id = 'overlay'; o.className = 'overlay'; document.body.appendChild(o); }
    return o;
}
function showOverlay(H, html) { const o = overlayEl(); o.innerHTML = html; o.hidden = false; return o; }
function hideOverlay(H) { const o = document.getElementById('overlay'); if (o) { o.hidden = true; o.innerHTML = ''; } if (H.cinBoss) { H.cinBoss.destroy(); H.cinBoss = null; } }

function showBossIntro(H, id, done) {
    const B = BOSSES[id];
    const o = showOverlay(H, `
        <div class="label">STAGE ${H.stageIdx + 1} OF ${H.stages.length}${H.stageIdx === H.stages.length - 1 ? ' — FINAL BOSS' : ''}</div>
        <div class="big" style="color:${B.color}">${esc(B.name)}</div>
        <div class="sub"><i>${esc(B.intro)}</i></div>
        <canvas></canvas>
        <div class="sub" style="font-size:1rem">Role calls this fight: ${[...new Set(B.attacks.filter(a => a.roleCall).map(a => a.roleCall))].map(c => c === 'ALL' ? 'EVERY CLASS' : CLASSES[c].name.toUpperCase() + 'S').join(' · ') || 'none'}</div>`);
    Audio.sfxBossIntro();
    if (window.BossRenderer) {
        H.cinBoss = window.BossRenderer.create(o.querySelector('canvas'), id, { backdrop: false });
        setTimeout(() => H.cinBoss && H.cinBoss.intro(1400), 700);
    }
    setTimeout(() => { hideOverlay(H); done(); }, 5200);
}

function showWipe(H, ev) {
    Audio.stopMusic(); Audio.sfxDefeat();
    showOverlay(H, `<div class="big" style="color:#ff4757">SQUAD WIPED</div>
        <div class="sub">Regroup! Talk it over: who needs to do what?<br>Raid lives left: <b>${'♥'.repeat(ev.raidLives)}</b></div>`);
}

// ================================================================= lobby

function renderLobby(H) {
    const joinUrl = `${location.host}${location.pathname.replace(/play\.html$/, '')}`;
    mount(`
    <div class="lobby">
        <div class="lobby-main">
            <div>
                <div class="label">JOIN AT <span class="gold">${esc(joinUrl)}</span> WITH CODE</div>
                <div class="join-code" id="join-code">${H.code}</div>
            </div>
            <div class="row"><div class="display" style="font-size:1.4rem">${esc(H.title)}</div><span class="chip gold">${H.questions.length} QUESTIONS</span></div>
            <div class="squad" id="squad"></div>
            <div class="muted" id="lobby-hint">Students: join with the code, then pick a class. A mix of all four classes is strongest.</div>
        </div>
        <div class="lobby-side">
            <div class="stack"><div class="label">DIFFICULTY</div><div class="seg" id="seg-diff">${Object.values(DIFFICULTY).map(d => `<button data-v="${d.id}">${d.label.toUpperCase()}</button>`).join('')}</div><div class="muted" id="diff-desc" style="font-size:0.9rem"></div></div>
            <div class="stack"><div class="label">RAID LENGTH</div><div class="seg" id="seg-format">${Object.entries(FORMATS).map(([k, f]) => `<button data-v="${k}">${f.name.split(' ')[0].toUpperCase()}</button>`).join('')}</div><div class="muted" id="format-desc" style="font-size:0.9rem"></div></div>
            <label class="toggle"><span>Shuffle answer order</span><input type="checkbox" id="t-shuffle"></label>
            <label class="toggle"><span>Callsign names (hide real names)</span><input type="checkbox" id="t-callsigns"></label>
            <label class="toggle"><span>Lock lobby</span><input type="checkbox" id="t-lock"></label>
            <div class="grow"></div>
            <div class="muted" id="ready-count"></div>
            <button class="btn go big" id="btn-start">START RAID</button>
        </div>
    </div>`);
    const s = H.settings;
    const seg = (id, key, descId, describe) => {
        const el = $(id);
        const paint = () => { el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === s[key])); $(descId).textContent = describe(s[key]); };
        el.addEventListener('click', e => { const v = e.target.dataset?.v; if (!v) return; s[key] = v; paint(); });
        paint();
    };
    seg('#seg-diff', 'difficulty', '#diff-desc', v => DIFFICULTY[v].desc);
    seg('#seg-format', 'format', '#format-desc', v => FORMATS[v].desc);
    const tog = (id, key, onChange) => { const el = $(id); el.checked = !!s[key]; el.addEventListener('change', () => { s[key] = el.checked; onChange && onChange(); }); };
    tog('#t-shuffle', 'shuffle', () => updateRoom(H.code, { 'meta/shuffle': s.shuffle }));
    tog('#t-callsigns', 'callsigns', () => {
        for (const p of Object.values(H.engine.players)) p.name = displayName(H, p.id, H.room?.players?.[p.id]?.profile?.name || p.name);
        renderLobbySquad(H);
    });
    tog('#t-lock', 'locked', () => updateRoom(H.code, { 'meta/locked': s.locked }));
    $('#btn-start').addEventListener('click', () => beginRaid(H));
    $('#squad').addEventListener('click', e => {
        const pid = e.target.dataset?.pid;
        if (pid && confirm(`Remove ${e.target.textContent} from the room?`)) {
            updateRoom(H.code, { [`kicked/${pid}`]: true, [`players/${pid}`]: null });
            removePlayer(H.engine, pid);
            renderLobbySquad(H);
        }
    });
    renderLobbySquad(H);
}

function renderLobbySquad(H) {
    const el = $('#squad');
    if (!el) return;
    const ps = Object.values(H.engine.players);
    const waiting = Object.values(H.room?.players || {}).filter(n => n.profile && !n.profile.cls).length;
    el.innerHTML = CLASS_IDS.map(c => {
        const list = ps.filter(p => p.cls === c);
        return `<div class="squad-col" data-cls="${c}"><h4><span>${CLASSES[c].name.toUpperCase()}S</span><span>${list.length}</span></h4>
            <div class="names">${list.map(p => `<span data-pid="${p.id}" title="Click to remove" style="cursor:pointer">${esc(p.name)}</span>`).join('')}</div></div>`;
    }).join('');
    const classes = new Set(ps.map(p => p.cls)).size;
    $('#ready-count').innerHTML = `<b>${ps.length}</b> ready${waiting ? ` · ${waiting} choosing a class` : ''}${ps.length && classes < 4 ? ` · <span class="gold">only ${classes} of 4 classes — synergy needs all four</span>` : ''}`;
}

// ================================================================= fight screen

function renderFightScreen(H) {
    const B = BOSSES[H.stage.id];
    mount(`
    <div class="host">
        <div class="host-main">
            <div class="host-head">
                <div class="boss-title" style="color:${B.color}">${esc(B.name)}</div>
                <span class="chip" id="phase-chip">NORMAL</span>
                <div class="grow"></div>
                <div class="label">ROOM <span class="gold" style="font-size:1.2rem">${H.code}</span></div>
            </div>
            <div class="bar boss" id="boss-bar"><i style="width:100%"></i><div class="bar-text" id="boss-hp-text"></div></div>
            <div class="arena" id="arena">
                <canvas id="boss-canvas"></canvas>
                <div class="fx-layer" id="fx-layer"></div>
                <div class="rolecall" id="rolecall" hidden></div>
            </div>
            <div class="warning-strip" id="warning"></div>
            <div class="host-foot">
                <div class="timer" id="timer">0:00</div>
                <div class="synergy" style="justify-content:center">
                    <div class="label">SYNERGY</div>
                    <div class="pips" id="syn-pips">${CLASS_IDS.map(c => `<div class="pip" data-cls="${c}" title="${CLASSES[c].name}">${c[0]}</div>`).join('')}</div>
                    <div class="mult" id="syn-mult">×1</div>
                </div>
                <div class="label" id="raid-lives"></div>
            </div>
        </div>
        <div class="host-side">
            <div class="side-head"><div class="label">SQUAD</div><div class="label" id="alive-count"></div></div>
            <div class="vitals" id="vitals"></div>
            <div class="feed" id="feed"></div>
            <div class="host-controls" id="controls"></div>
        </div>
    </div>`);
    H.ui = { arena: $('#arena'), fx: $('#fx-layer'), feed: $('#feed'), bossBar: $('#boss-bar'), bossText: $('#boss-hp-text'), phase: $('#phase-chip'), timer: $('#timer'), rolecall: $('#rolecall'), warning: $('#warning'), pips: $('#syn-pips'), mult: $('#syn-mult'), vitals: $('#vitals'), lives: $('#raid-lives'), alive: $('#alive-count') };
    for (const html of H.feed.slice(-12)) { const d = document.createElement('div'); d.innerHTML = html; H.ui.feed.prepend(d); }
    if (H.boss) H.boss.destroy();
    H.boss = window.BossRenderer ? window.BossRenderer.create($('#boss-canvas'), H.stage.id) : null;
    if (H.boss) H.boss.intro(1200);
    renderControls(H);
}

function renderControls(H) {
    const el = $('#controls');
    if (!el) return;
    el.innerHTML = `
        <button class="btn" id="c-pause">${H.paused ? 'RESUME' : 'PAUSE'}</button>
        <button class="btn" id="c-strike" ${H.assists.strike ? '' : 'disabled'} title="Once per boss: 6% damage">AIR STRIKE</button>
        <button class="btn" id="c-rally" ${H.assists.rally ? '' : 'disabled'} title="Once per boss: +25% ultimate for everyone">RALLY</button>
        <button class="btn" id="c-sound">${Audio.isMuted() ? 'SOUND OFF' : 'SOUND ON'}</button>`;
    $('#c-pause').onclick = () => { togglePause(H); renderControls(H); };
    $('#c-strike').onclick = () => teacherAssist(H, 'strike');
    $('#c-rally').onclick = () => teacherAssist(H, 'rally');
    $('#c-sound').onclick = () => { Audio.toggleMute(); if (!Audio.isMuted()) Audio.setPhase(H.engine.boss?.phase || 'NORMAL'); renderControls(H); };
}

function renderFight(H, now) {
    const e = H.engine, b = e.boss, ui = H.ui;
    if (!b || !ui.bossBar) return;
    if (H.boss) H.boss.setHealth(b.hp / b.maxHp);
    ui.bossBar.querySelector('i').style.width = pct(b.hp, b.maxHp) + '%';
    ui.bossBar.className = 'bar boss ' + (b.phase === 'DESPERATE' ? 'desperate' : b.phase === 'ENRAGED' || b.enraged ? 'enraged' : '');
    ui.bossText.textContent = `${fmtNum(b.hp)} / ${fmtNum(b.maxHp)}`;
    ui.phase.textContent = b.enraged && b.phase === 'NORMAL' ? 'ENRAGED' : b.phase;
    ui.phase.style.color = b.phase === 'DESPERATE' ? '#ff4757' : (b.phase === 'ENRAGED' || b.enraged) ? '#ffa502' : '#2ed573';

    const left = H.paused ? b.endsAt - H.pausedAt : b.endsAt - now;
    ui.timer.textContent = b.enraged ? 'ENRAGED' : fmtClock(left);
    ui.timer.classList.toggle('danger', b.enraged || left < 30000);

    // synergy
    const lvl = synergyLevel(e, now);
    ui.pips.querySelectorAll('.pip').forEach(p => p.classList.toggle('on', now - (e.team.syn[p.dataset.cls] || -1e12) <= 10000));
    ui.mult.textContent = '×' + SYNERGY_MULT[lvl];

    // role call / attack warning
    const atk = b.attack;
    const rc = ui.rolecall;
    if (atk && atk.call) {
        const call = atk.call;
        const have = Object.keys(call.who).length;
        const who = call.cls === 'ALL' ? 'EVERY CLASS' : call.cls === 'ANY' ? 'EVERYONE' : CLASSES[call.cls].name.toUpperCase() + 'S';
        const verb = call.cls === 'ALL' || call.cls === 'ANY' ? 'ACT NOW' : 'USE YOUR SPECIAL';
        rc.hidden = false;
        rc.className = 'rolecall' + (call.done ? ' met' : '');
        if (call.cls !== 'ALL' && call.cls !== 'ANY') rc.dataset.cls = call.cls; else delete rc.dataset.cls;
        rc.innerHTML = `<div class="rc-who">${who}: ${verb}!</div>
            <div class="rc-what">${call.done ? 'BLOCKED — HOLD ON!' : esc(call.text || '') + ' — STOP ' + esc(atk.name)}</div>
            <div class="rc-progress">${call.cls === 'ALL'
                ? CLASS_IDS.filter(c => Object.values(e.players).some(p => p.cls === c && p.status === 'alive')).map(c => `<div class="rc-dot ${call.who[c] ? 'on' : ''}" data-cls="${c}" style="--cls:${CLASSES[c].color};border-color:${CLASSES[c].color}"></div>`).join('')
                : Array.from({ length: call.need }, (_, i) => `<div class="rc-dot ${i < have ? 'on' : ''}"></div>`).join('')}</div>
            <div class="bar"><i style="width:${pct(atk.landsAt - now, atk.landsAt - atk.startedAt)}%"></i></div>`;
        ui.warning.textContent = '';
    } else {
        rc.hidden = true;
        ui.warning.textContent = atk ? `⚠ ${atk.name} IN ${Math.max(0, Math.ceil((atk.landsAt - now) / 1000))}s` : (b.stunUntil > now ? 'BOSS STUNNED' : b.exposedUntil > now ? 'BOSS EXPOSED: +25% DAMAGE' : '');
    }

    // vitals
    const targets = new Set(atk ? atk.targets : []);
    const ps = Object.values(e.players);
    ui.alive.textContent = `${ps.filter(p => p.status === 'alive').length}/${ps.length} UP`;
    ui.lives.innerHTML = `RAID LIVES <span style="color:#ff4757;font-size:1.3rem">${'♥'.repeat(Math.max(0, e.raidLives))}</span>${e.team.dome > now ? ' · <span style="color:#4a6cff">DOME</span>' : ''}`;
    ui.vitals.innerHTML = ps.sort((a, b2) => CLASS_IDS.indexOf(a.cls) - CLASS_IDS.indexOf(b2.cls)).map(p => `
        <div class="vital ${p.status !== 'alive' ? p.status : ''} ${targets.has(p.id) && p.status === 'alive' ? 'targeted' : ''}" data-cls="${p.cls}">
            <div class="stripe"></div>
            <div style="min-width:0"><div class="v-name">${esc(p.name)}</div><div class="bar hp ${p.hp / p.maxHp < 0.35 ? 'low' : ''}"><i style="width:${pct(p.hp, p.maxHp)}%"></i></div></div>
            <div class="v-tags">${H.callouts[p.id] && now - H.callouts[p.id].at < 8000 ? `<span class="callout-badge ${H.callouts[p.id].k}">${{ heal: 'HEALS', shield: 'SHIELD', ult: 'ULT' }[H.callouts[p.id].k]}</span>` : ''}${p.shield ? '<span title="Shielded" style="color:#4a6cff">◆</span>' : ''}${p.infected ? '<span title="Infected" style="color:#7bed9f">☣</span>' : ''}${p.ult >= 100 ? '<span title="Ultimate ready" class="gold">★</span>' : ''}${p.status === 'down' ? '<span style="color:#ff4757">DOWN</span>' : p.status === 'out' ? '<span class="muted">SPIRIT</span>' : ''}</div>
        </div>`).join('');
}
