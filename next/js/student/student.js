// STUDENT — the phone / Chromebook controller.
//
// Answers are checked locally for instant feedback, then sent to the host as
// intents; the host applies the real rules and publishes everyone's state.

import { CLASSES, CLASS_IDS, SYNERGY_MULT, STREAK_BONUS } from '../content/classes.js';
import { BOSSES, DIFFICULTY } from '../content/raid.js';
import { questionDeck, shuffled } from '../content/questions.js';
import { playerIdFor, joinRoom, chooseClass, sendIntent, listenRoom, lookupRoom } from '../net/room.js';
import { AudioEngine as Audio } from '../audio.js';
import { mount, esc, $, toast, flash, shake, fmtNum, pct } from '../ui.js';
import { damageNumber, textPop, hitMarker, slam, streakName, unlock, unlockedList, ACHIEVEMENTS, achievementDesc, confetti } from './juice.js';

const S = {
    code: null, pid: null, room: null, me: null, live: {},
    screen: null, local: 'question',     // question | feedback | action | target
    q: null, deck: null, ability: null, fxSeq: 0, tutorialDone: false,
    lastCallId: null, myMissed: {}
};

export async function startStudent({ name, room }) {
    Audio.init();
    if (!name || !room) return renderJoin(name, room);
    return join(name.trim().slice(0, 16), String(room).trim());
}

// ================================================================= join

function renderJoin(name = '', room = '') {
    mount(`
    <div class="screen center">
        <div class="stack" style="width:min(420px,100%)">
            <div class="display" style="font-size:2rem">RAID REVIEW</div>
            <div class="muted">Enter the code on the projector</div>
            <input class="field code" id="j-room" inputmode="numeric" maxlength="6" placeholder="000000" value="${esc(room)}">
            <input class="field" id="j-name" maxlength="16" placeholder="Your name" value="${esc(name)}">
            <button class="btn gold big" id="j-go">JOIN RAID</button>
            <div id="j-err" class="muted" style="color:#ff6b81;min-height:1.4em"></div>
        </div>
    </div>`);
    const go = async () => {
        const r = $('#j-room').value.trim(), n = $('#j-name').value.trim().replace(/[<>]/g, '');
        if (!/^\d{6}$/.test(r)) return ($('#j-err').textContent = 'The code is 6 digits.');
        if (!n) return ($('#j-err').textContent = 'Type your name.');
        $('#j-go').disabled = true;
        const err = await join(n.slice(0, 16), r);
        if (err) { $('#j-err').textContent = err; $('#j-go').disabled = false; }
    };
    $('#j-go').onclick = go;
    $('#j-name').onkeydown = e => { if (e.key === 'Enter') go(); };
    (room ? $('#j-name') : $('#j-room')).focus();
}

async function join(name, code) {
    S.code = code;
    S.pid = playerIdFor(code);
    const res = await joinRoom(code, S.pid, name);
    if (res.error) {
        if (!document.getElementById('j-go')) renderJoin(name, code);
        return res.error;
    }
    S.questions = res.room.questions || [];
    S.deck = questionDeck(S.questions.length);
    listenRoom(code, onRoom);
    return null;
}

// ================================================================= sync

function onRoom(room) {
    if (!room) return;
    S.room = room;
    S.live = room.live || {};
    S.me = room.players?.[S.pid] || null;
    if (room.kicked?.[S.pid]) return show('kicked');
    if (!S.me) return; // our node was removed (kicked) or not written yet
    playFx();

    const cls = S.me.profile?.cls;
    const st = S.live.status;
    if (!cls) return show('classes');
    if (st === 'victory' || st === 'defeat' || S.live.stage?.kind === 'end') return show('end');
    if (!S.live.stage) return show(S.tutorialDone ? 'waiting' : 'tutorial');
    if (!S.me.pub) return show('waiting'); // host hasn't added us yet
    show('game');
}

function show(screen) {
    if (S.screen !== screen) {
        S.screen = screen;
        ({ kicked: renderKicked, classes: renderClasses, tutorial: renderTutorial, waiting: renderWaiting, game: renderGameShell, end: renderEnd })[screen]();
    } else if (screen === 'classes') updateClassCounts();
    else if (screen === 'waiting') updateWaiting();
    if (screen === 'game') updateGame();
}

// ================================================================= class select

function renderClasses() {
    mount(`
    <div class="screen center" style="justify-content:flex-start">
        <div class="display" style="font-size:1.6rem;margin:10px 0 4px">CHOOSE YOUR CLASS</div>
        <div class="muted" style="margin-bottom:14px">Your squad is strongest with all four classes. Pick what the team needs!</div>
        <div class="class-grid">${CLASS_IDS.map(id => {
            const c = CLASSES[id], a = c.abilities;
            return `<button class="class-card" data-cls="${id}" data-pick="${id}">
                <div class="role">${c.role}</div><h3>${c.name.toUpperCase()}</h3>
                <div class="muted"><i>${esc(c.tagline)}</i></div>
                <ul><li><b>${a.special.name}</b> — ${esc(a.special.desc)}</li><li><b>★ ${a.ult.name}</b> — ${esc(a.ult.desc)}</li><li>${esc(c.passive)}</li></ul>
                <div class="count" data-count="${id}"></div>
            </button>`;
        }).join('')}</div>
    </div>`);
    document.querySelector('.class-grid').onclick = e => {
        const card = e.target.closest('[data-pick]');
        if (!card) return;
        Audio.ensureCtx(); Audio.sfxBuff();
        chooseClass(S.code, S.pid, card.dataset.pick);
    };
    updateClassCounts();
}

function updateClassCounts() {
    const counts = Object.fromEntries(CLASS_IDS.map(c => [c, 0]));
    for (const n of Object.values(S.room?.players || {})) if (n.profile?.cls) counts[n.profile.cls]++;
    for (const c of CLASS_IDS) {
        const el = document.querySelector(`[data-count="${c}"]`);
        if (el) el.innerHTML = counts[c] ? `${counts[c]} in the squad` : '<span class="gold">NEEDED — nobody yet!</span>';
    }
}

// ================================================================= tutorial (30 seconds, hands-on)

function renderTutorial() {
    const c = CLASSES[S.me.profile.cls];
    const steps = [
        () => `<div class="label">STEP 1 OF 3 · ANSWER TO POWER UP</div>
            <div class="question">Every right answer lets you act. Try it: what is 3 + 4?</div>
            <div class="answers" id="t-ans">${['5', '7', '9', '12'].map((a, i) => `<button class="answer" data-i="${i}">${a}</button>`).join('')}</div>`,
        () => `<div class="label">STEP 2 OF 3 · CHOOSE YOUR MOVE</div>
            <div class="muted">After a right answer you pick one action. Your <b>special</b> recharges after 2 more right answers; your <b class="gold">★ ultimate</b> charges as you answer.</div>
            <div class="act-grid" id="t-act">${actionButtons(c, { armed: true, cd: 0, ult: 100 }, false)}</div>`,
        () => `<div class="label">STEP 3 OF 3 · ROLE CALLS</div>
            <div class="callout mine">${c.name.toUpperCase()}S: USE YOUR SPECIAL!</div>
            <div class="muted" style="text-align:center">When the boss winds up a big attack, it calls on one class. If you're that class, answer a question and hit your <b>${c.abilities.special.name}</b> before the timer runs out. Your special is always ready during your role call. Enough of you answering stops the attack cold.</div>
            <button class="btn go big" id="t-done">I'M READY</button>`
    ];
    let i = 0;
    const draw = () => {
        mount(`<div class="screen" data-cls="${c.id}"><div class="stu-main" style="justify-content:center">
            <div class="row"><span class="display" style="color:var(--cls)">${c.name.toUpperCase()}</span><span class="grow"></span><button class="btn ghost" id="t-skip" style="min-height:40px">SKIP</button></div>
            ${steps[i]()}</div></div>`);
        $('#t-skip').onclick = finish;
        if (i === 0) $('#t-ans').onclick = e => {
            const b = e.target.closest('.answer'); if (!b) return;
            if (b.dataset.i === '1') { b.classList.add('right'); Audio.sfxCorrect(); setTimeout(() => { i = 1; draw(); }, 600); }
            else { b.classList.add('wrong'); $('#t-ans').children[1].classList.add('right'); Audio.sfxWrong(); toast('Wrong answers cost a little HP, and you see the right one. Try again!'); setTimeout(draw, 1400); }
        };
        if (i === 1) $('#t-act').onclick = e => { const b = e.target.closest('.action'); if (!b) return; Audio.sfxHit(); i = 2; draw(); };
        if (i === 2) $('#t-done').onclick = finish;
    };
    const finish = () => { S.tutorialDone = true; S.screen = null; onRoom(S.room); };
    draw();
}

function renderWaiting() {
    const c = CLASSES[S.me.profile.cls];
    mount(`<div class="screen center" data-cls="${c.id}">
        <div class="label">YOU ARE A</div>
        <div class="display" style="font-size:2.6rem;color:var(--cls)">${c.name.toUpperCase()}</div>
        <div class="muted" style="margin:8px 0 22px">${esc(c.tagline)}</div>
        <div class="display" style="font-size:1.1rem;animation:pulse 1.4s infinite">WAITING FOR YOUR TEACHER TO START…</div>
        <div class="muted" id="w-count" style="margin-top:12px"></div>
        <button class="btn ghost" id="w-change" style="margin-top:22px">CHANGE CLASS</button>
    </div>`);
    $('#w-change').onclick = () => chooseClass(S.code, S.pid, null);
    updateWaiting();
}
function updateWaiting() {
    const el = $('#w-count');
    if (el) el.textContent = `${Object.values(S.room?.players || {}).filter(n => n.profile?.cls).length} raiders ready`;
}

function renderKicked() {
    mount(`<div class="screen center"><div class="display" style="font-size:1.6rem">YOU WERE REMOVED FROM THIS ROOM</div><div class="muted">Ask your teacher if this was a mistake.</div></div>`);
}

// ================================================================= game (Chromebook-first)

// Host clock: every countdown uses the host's time, so a Chromebook with a
// wrong clock still shows the right seconds.
const hostNow = () => Date.now() + (S.clockOffset || 0);

function renderGameShell() {
    const cls = S.me.profile.cls;
    mount(`
    <div class="sg" data-cls="${cls}" id="g">
        <div class="sg-main">
            <div class="sg-hud">
                <div class="sg-who"><span class="n" id="h-name"></span><span class="c">${CLASSES[cls].name.toUpperCase()} · <span id="h-lives"></span></span></div>
                <div class="hudbar hp" id="h-hp"><i></i><div class="t"><span>HP</span><span id="h-hpt"></span></div></div>
                <div class="hudbar ult" id="h-ult"><i></i><div class="t"><span>★ ULT</span><span id="h-ultt"></span></div></div>
                <div class="streakbox" id="h-streak"><div class="k">🔥 0</div><div class="m">STREAK</div></div>
                <button class="iconbtn" id="h-mute" title="Sound">${Audio.isMuted() ? '🔇' : '🔊'}</button>
            </div>
            <div class="sg-banners" id="banners"></div>
            <div class="sg-stage">
                <div class="sg-bossline" id="bossline"></div>
                <div class="sg-center" id="center"></div>
                <div class="layer" id="dmg-layer"></div>
                <div id="slam"></div>
            </div>
            <div class="sg-controls" id="controls"></div>
        </div>
        <aside class="sg-squad">
            <div class="sq-head"><div class="label">SQUAD</div><div class="label" id="sq-count"></div></div>
            <div class="sq-calls">
                <button data-call="heal">NEED HEALS</button>
                <button data-call="shield">SHIELD ME</button>
                <button data-call="ult" id="call-ult">ULT READY</button>
            </div>
            <div class="sq-list" id="squad"></div>
            <div class="sq-foot">
                <div class="synergy"><div class="label">SYNERGY</div><div class="pips" id="syn">${CLASS_IDS.map(c => `<div class="pip" data-cls="${c}">${c[0]}</div>`).join('')}</div><div class="mult" id="syn-mult">×1</div></div>
            </div>
        </aside>
    </div>
    <div class="vignette" id="vignette"></div>
    <div id="achv"></div>
    <div class="fs-tip">⚡ Press the full-screen key (or F11) for the best view ⚡</div>`);
    $('#h-mute').onclick = () => { const m = Audio.toggleMute(); $('#h-mute').textContent = m ? '🔇' : '🔊'; };
    document.querySelector('.sq-calls').onclick = e => {
        const k = e.target.dataset?.call;
        if (!k || e.target.disabled || hostNow() - (S.lastCallout || 0) < 6000) return;
        S.lastCallout = hostNow();
        sendIntent(S.code, S.pid, { t: 'c', k });
        toast('Callout sent to your squad');
    };
    $('#squad').onclick = e => {
        const card = e.target.closest('.sq-card.targetable');
        if (card && S.local === 'target') doAct(S.ability, card.dataset.id);
    };
    S.local = 'question';
    S.q = null;
    S.lastKey = null;
    S.prevUlt = S.me.pub.ult;
    drawControls();
}

function inFight() {
    return S.live.stage?.phase === 'fight' && !S.live.paused && S.live.status === 'boss' && !(S.live.regroupUntil > hostNow());
}
function myCall() {
    const call = S.live.boss?.attack?.call;
    return call && !call.done && call.cls === S.me.pub.cls ? call : null;
}
function streakBonusPct(streak, cls) {
    const t = STREAK_BONUS.find(s => streak >= s.at);
    return Math.round((t ? t.bonus : 0) * (cls === 'WARRIOR' ? 2 : 1) * 100);
}

function updateGame() {
    const pub = S.me.pub, c = CLASSES[pub.cls];
    const now = hostNow();
    if (S.live.clock) S.clockOffset = S.live.clock - Date.now();

    // HUD
    $('#h-name').textContent = pub.name;
    $('#h-lives').innerHTML = `<span style="color:#ff4757">${'♥'.repeat(Math.max(0, pub.lives))}</span>`;
    const hp = $('#h-hp');
    hp.querySelector('i').style.width = pct(pub.hp, pub.maxHp) + '%';
    hp.classList.toggle('low', pub.hp / pub.maxHp < 0.3);
    $('#h-hpt').textContent = `${fmtNum(pub.hp)} / ${fmtNum(pub.maxHp)}`;
    const ult = $('#h-ult');
    ult.querySelector('i').style.width = pub.ult + '%';
    ult.classList.toggle('ready', pub.ult >= 100);
    $('#h-ultt').textContent = pub.ult >= 100 ? 'READY!' : pub.ult + '%';
    if (pub.ult >= 100 && (S.prevUlt ?? 0) < 100 && pub.status === 'alive') { slam('ULTIMATE READY', { color: '#ffa502', sub: c.abilities.ult.name.toUpperCase() }); Audio.sfxAchievement(); }
    S.prevUlt = pub.ult;
    const streak = S.streak || 0;
    const bonus = streakBonusPct(streak, pub.cls);
    $('#h-streak').innerHTML = `<div class="k">🔥 ${streak}</div><div class="m">${bonus ? `+${bonus}% DMG` : 'STREAK'}</div>`;
    $('#h-streak').classList.toggle('hot', bonus > 0);
    $('#vignette').classList.toggle('on', pub.status === 'alive' && pub.hp / pub.maxHp < 0.3 && inFight());
    $('#call-ult').disabled = pub.ult < 100;

    // boss line
    const b = S.live.boss;
    $('#bossline').innerHTML = b && S.live.stage?.kind === 'boss'
        ? `<span style="color:${BOSSES[b.id].color}">${esc(b.name)}</span><div class="bar boss ${b.phase === 'DESPERATE' ? 'desperate' : b.phase === 'ENRAGED' ? 'enraged' : ''}" style="height:12px;border:0"><i style="width:${pct(b.hp, b.maxHp)}%"></i></div><span>${Math.ceil(pct(b.hp, b.maxHp))}%</span>`
        : '';

    $('#banners').innerHTML = banners(now);
    renderSquad(now);

    // a new role call for my class re-draws the action panel so the special lights up
    const atk = b?.attack, call = atk?.call;
    const callId = call && !call.done ? `${atk.id}-${atk.startedAt}` : null;
    if (callId !== S.lastCallId) {
        S.lastCallId = callId;
        if (callId && call.cls === pub.cls) { Audio.sfxCountdown(); navigator.vibrate && navigator.vibrate([120, 60, 120]); }
        if (S.local === 'action') S.lastKey = null;
    }
    drawControls(true);
}

function banners(now) {
    const pub = S.me.pub, out = [];
    const b = S.live.boss, atk = b?.attack, call = atk?.call;
    const secs = t => Math.max(0, Math.ceil((t - now) / 1000));
    const clsName = CLASSES[pub.cls].name.toUpperCase();
    if (pub.status === 'down') {
        const need = DIFFICULTY[S.room.meta.difficulty || 'regular'].reviveNeed;
        out.push(`<div class="banner big danger">YOU'RE DOWN! Answer ${need} in a row to reboot (${pub.revive}/${need}), or call a Medic!</div>`);
    } else if (pub.status === 'out') {
        out.push(`<div class="banner" style="--bc:#9fd0ff">👻 SPIRIT MODE: your right answers power the team rally <span class="bt">${S.live.team?.rally || 0}%</span></div>`);
    }
    if (atk && inFight()) {
        if (call && !call.done && call.cls === pub.cls) out.push(`<div class="banner big" style="--bc:${CLASSES[pub.cls].color}">BOSS CALLS ${clsName}S! Answer, then hit ${esc(CLASSES[pub.cls].abilities.special.name.toUpperCase())} <span class="bt">${secs(atk.landsAt)}s</span></div>`);
        else if (call && !call.done && call.cls === 'ALL' && !call.who[pub.cls]) out.push(`<div class="banner big" style="--bc:#ffa502">EVERY CLASS NEEDED: ${clsName}S HAVEN'T ACTED YET! <span class="bt">${secs(atk.landsAt)}s</span></div>`);
        else if (call && !call.done && call.cls === 'ANY') out.push(`<div class="banner big" style="--bc:#ffa502">EVERYONE: ACT NOW TO STOP ${esc(atk.name)} <span class="bt">${secs(atk.landsAt)}s</span></div>`);
        else if (call && call.done) out.push(`<div class="banner" style="--bc:#2ed573">✔ ROLE CALL ANSWERED: ${esc(atk.name)} WILL BE BLOCKED</div>`);
        if ((atk.targets || []).includes(S.pid) && pub.status === 'alive' && !(call && call.done)) {
            out.push(`<div class="banner big danger">⚠ YOU'RE TARGETED: ${esc(atk.name)}${pub.shield ? ' (your shield will block it)' : ' — Guardians can shield you!'} <span class="bt">${secs(atk.landsAt)}s</span></div>`);
        } else if (!call) out.push(`<div class="banner danger">⚠ ${esc(atk.name)} INCOMING <span class="bt">${secs(atk.landsAt)}s</span></div>`);
    }
    if (pub.infected && pub.status === 'alive') out.push(`<div class="banner" style="--bc:#7bed9f">☣ INFECTED: it spreads soon. Ask a Medic to heal you! <span class="bt">${secs(pub.infected)}s</span></div>`);
    if (b && b.exposedUntil > now) out.push(`<div class="banner" style="--bc:${CLASSES.TACTICIAN.color}">BOSS EXPOSED: everyone deals +25% <span class="bt">${secs(b.exposedUntil)}s</span></div>`);
    if (S.live.team?.dome > now) out.push(`<div class="banner" style="--bc:${CLASSES.GUARDIAN.color}">◆ IRON DOME: the squad is invulnerable <span class="bt">${secs(S.live.team.dome)}s</span></div>`);
    if (b && b.stunUntil > now) out.push(`<div class="banner" style="--bc:${CLASSES.TACTICIAN.color}">BOSS STUNNED <span class="bt">${secs(b.stunUntil)}s</span></div>`);
    return out.join('');
}

function renderSquad(now) {
    const list = Object.values(S.room.players || {}).map(n => n.pub && { ...n.pub, callout: n.pub.callout }).filter(Boolean);
    const targeting = S.local === 'target' ? CLASSES[S.me.pub.cls].abilities[S.ability] : null;
    const atk = S.live.boss?.attack;
    const targeted = new Set(atk?.targets || []);
    list.sort((a, b) => (b.id === S.pid) - (a.id === S.pid) || CLASS_IDS.indexOf(a.cls) - CLASS_IDS.indexOf(b.cls));
    $('#sq-count').textContent = `${list.filter(p => p.status === 'alive').length}/${list.length} UP`;
    $('#squad').innerHTML = list.map(p => {
        const valid = targeting && (p.status === 'alive' || (targeting.kind === 'heal' && p.status === 'down'));
        const co = p.callout && now - p.callout.at < 8000 ? p.callout.k : null;
        return `<button class="sq-card ${p.id === S.pid ? 'me' : ''} ${p.status !== 'alive' ? p.status : ''} ${targeting ? (valid ? 'targetable' : 'disabled') : ''}" data-cls="${p.cls}" data-id="${p.id}">
            <div class="s"></div>
            <div style="min-width:0">
                <div class="nm"><span>${esc(p.name)}${p.id === S.pid ? ' (you)' : ''}</span>${co ? `<span class="callout-badge ${co}">${{ heal: 'HEALS', shield: 'SHIELD', ult: 'ULT' }[co]}</span>` : ''}</div>
                <div class="bar hp ${p.hp / p.maxHp < 0.35 ? 'low' : ''}"><i style="width:${pct(p.hp, p.maxHp)}%"></i></div>
                <div class="tags">${p.status === 'down' ? '<b style="color:#ff4757">DOWN</b>' : p.status === 'out' ? '<span>👻 SPIRIT</span>' : ''}${targeted.has(p.id) && p.status === 'alive' ? '<b style="color:#ff4757">TARGETED</b>' : ''}${p.shield ? '<span style="color:#7d95ff">◆ SHIELD</span>' : ''}${p.infected ? '<b style="color:#7bed9f">☣</b>' : ''}${p.ult >= 100 ? '<span class="gold">★ ULT</span>' : ''}</div>
            </div></button>`;
    }).join('');
    const syn = S.live.team?.syn || {};
    let n = 0;
    document.querySelectorAll('#syn .pip').forEach(p => { const on = now - (syn[p.dataset.cls] || -1e12) <= 10000; if (on) n++; p.classList.toggle('on', on); });
    $('#syn-mult').textContent = '×' + SYNERGY_MULT[Math.max(1, n)];
}

// ---------------------------------------------------------------- controls (question / actions / targeting)

function situationKey() {
    const st = S.live.stage || {};
    return [st.kind, st.id, st.phase, S.live.paused, S.live.regroupUntil > hostNow(), S.local, S.me.pub.status, S.q?.i ?? -1].join('|');
}

function drawControls(soft) {
    if (soft && situationKey() === S.lastKey) return;
    const box = $('#controls'), center = $('#center');
    if (!box) return;
    drawControlsInto(box, center);
    S.lastKey = situationKey(); // after drawing, so a freshly dealt question isn't redrawn under a finger
}

function bigCard(center, title, sub, color = '#fff') {
    center.innerHTML = `<div class="display" style="font-size:clamp(2rem,5vw,3.4rem);color:${color};animation:slam .6s both">${esc(title)}</div><div class="muted" style="margin-top:6px;font-size:1.1rem">${esc(sub)}</div>`;
}

function drawControlsInto(box, center) {
    const pub = S.me.pub;
    const stage = S.live.stage || {};
    center.innerHTML = '';
    box.style.display = '';
    const idle = (title, sub, color) => { bigCard(center, title, sub, color); box.innerHTML = ''; box.style.display = 'none'; };

    if (S.live.paused) return idle('PAUSED', 'Eyes on your teacher.');
    if (S.live.regroupUntil > hostNow()) return idle('SQUAD WIPED', 'Regroup! Talk it out: who needs to do what next time?', '#ff4757');
    if (stage.kind === 'boss' && stage.phase === 'intro') {
        S.stageSnap = { ...(S.me.stats || {}) }; S.downThisBoss = false; S.achvAtStart = unlockedList().length;
        return idle(BOSSES[stage.id].name, 'GET READY…', BOSSES[stage.id].color);
    }
    if ((stage.kind === 'boss' && stage.phase === 'outro') || stage.kind === 'rest') return waveClear(box, center);
    if (!inFight()) return idle('STAND BY', '');

    if (S.local === 'action' && pub.status === 'alive') return drawActions(box);
    if (S.local === 'target') return drawTargeting(box);
    if (S.local === 'feedback') return;
    drawQuestion(box);
}

function waveClear(box, center) {
    box.innerHTML = ''; box.style.display = 'none';
    const now = S.me.stats || {}, was = S.stageSnap || {};
    const d = k => (now[k] || 0) - (was[k] || 0);
    const newAchv = unlockedList().slice(S.achvAtStart || 0);
    if (!S.clearedShown) { S.clearedShown = true; confetti(90); Audio.sfxWaveClear(); if (!S.downThisBoss && S.stageSnap) unlock('untouchable'); }
    const rest = S.live.stage.kind === 'rest';
    center.innerHTML = `<div class="clear-card">
        <div class="display" style="font-size:clamp(2.2rem,5vw,3.6rem);color:#2ed573;animation:slam .6s both">${rest ? 'SUPPLY DROP' : 'BOSS DOWN!'}</div>
        <div class="muted">${rest ? 'Patched up. Next boss incoming!' : 'Squad patched up: +40% HP, +15% ultimate. Your fight:'}</div>
        ${rest ? '' : `<div class="clear-stats">
            <div class="panel"><div class="label">DAMAGE</div><div class="v gold">${fmtNum(d('dmg'))}</div></div>
            <div class="panel"><div class="label">RIGHT</div><div class="v">${d('correct')}/${d('correct') + d('wrong')}</div></div>
            <div class="panel"><div class="label">HEALED · SHIELDS</div><div class="v">${fmtNum(d('heal'))} · ${d('shields')}</div></div>
            <div class="panel"><div class="label">ROLE CALLS</div><div class="v">${d('roleCalls')}</div></div>
        </div>
        ${newAchv.length ? `<div style="margin-top:12px">${newAchv.map(id => `<span class="chip gold" style="margin:3px">🏆 ${ACHIEVEMENTS[id]}</span>`).join('')}</div>` : ''}`}
    </div>`;
}

function nextQuestion() {
    const i = S.deck();
    const q = S.questions[i];
    const order = q.type === 'tf' || S.room.meta.shuffle === false ? q.answers.map((_, k) => k) : shuffled(q.answers.map((_, k) => k));
    S.q = { i, q, order, shownAt: Date.now() };
}

function drawQuestion(box) {
    S.clearedShown = false;
    if (!S.q) nextQuestion();
    const { q, order } = S.q;
    const pub = S.me.pub;
    const kicker = pub.status === 'down' ? 'ANSWER TO REBOOT' : pub.status === 'out' ? 'ANSWER TO POWER THE RALLY' : 'ANSWER TO ATTACK';
    box.innerHTML = `<div class="qbox"><div class="label">${kicker}</div><div class="qt">${esc(q.text)}</div></div>
        <div class="answers arming ${q.answers.length === 2 ? 'two' : ''}" id="g-ans">${order.map((orig, k) => `<button class="answer" data-k="${k}">${esc(q.answers[orig])}</button>`).join('')}</div>`;
    $('#g-ans').onclick = e => {
        const btn = e.target.closest('.answer');
        if (!btn || S.local !== 'question' || $('#g-ans').classList.contains('arming')) return;
        pick(+btn.dataset.k, btn);
    };
    // answers fade in and only become tappable once visible (stops auto-clickers
    // without silently eating a fast student's tap)
    setTimeout(() => { const g = $('#g-ans'); if (g) { g.classList.remove('arming'); S.q && (S.q.armedAt = Date.now()); } }, 400);
}

function pick(k, btn) {
    Audio.ensureCtx();
    const { i, q, order } = S.q;
    const picked = order[k];
    const correct = picked === q.correct;
    const pub = S.me.pub;
    const layer = $('#dmg-layer');
    S.local = 'feedback';
    sendIntent(S.code, S.pid, { t: 'a', q: i, p: picked });
    const grid = $('#g-ans');
    grid.classList.add('locked');
    btn.classList.add(correct ? 'right' : 'wrong');
    if (correct) {
        S.streak = (S.streak || 0) + 1;
        S.correctCount = (S.correctCount || 0) + 1;
        Audio.sfxCorrect();
        hitMarker(layer);
        textPop(layer, 'CORRECT!', '#2ed573', 1.8);
        const name = streakName(S.streak);
        if (name) { slam(name, { sub: `${S.streak} IN A ROW · +${streakBonusPct(S.streak, pub.cls)}% DAMAGE` }); Audio.sfxStreak(); shake($('#g')); }
        if (S.streak >= 5) unlock('streak5');
        if (S.streak >= 10) unlock('streak10');
        if (S.streak >= 20) unlock('streak20');
        if (S.correctCount >= 10) unlock('scholar');
        if (S.correctCount >= 25) unlock('brainiac');
        if (S.correctCount >= 50) unlock('encyclopedia');
        if (Date.now() - (S.q.armedAt || S.q.shownAt) < 3000) unlock('quick');
        if (pub.status === 'alive' && pub.hp / pub.maxHp < 0.2) unlock('clutch');
        if (pub.status === 'out') unlock('spirit');
    } else {
        if ((S.streak || 0) >= 3) textPop(layer, 'STREAK LOST', '#ff6b81', 1.6);
        S.streak = 0;
        grid.children[order.indexOf(q.correct)].classList.add('right'); // learn from the miss
        S.myMissed[i] = (S.myMissed[i] || 0) + 1;
        textPop(layer, 'WRONG', '#ff4757', 2);
        Audio.sfxWrong(); shake($('#g'));
    }
    const alive = pub.status === 'alive';
    setTimeout(() => {
        S.q = null;
        S.local = correct && alive ? 'action' : 'question';
        S.lastKey = null;
        drawControls();
    }, correct ? 500 : 1700);
}

function actionButtons(c, pub, live = true) {
    const call = live ? myCall() : null;
    const callAll = live && S.live.boss?.attack?.call;
    const a = c.abilities;
    const spReady = pub.cd <= 0 || !!call;
    const ultReady = pub.ult >= 100;
    const calledAll = callAll && callAll.cls === 'ALL' && !callAll.done && !callAll.who[c.id];
    return `
        <button class="action" data-ab="basic"><span class="a-icon">${c.id[0]}</span><span><div class="a-name">${esc(a.basic.name.toUpperCase())}</div><div class="a-desc">${esc(a.basic.desc)}</div></span><span class="a-tag"></span></button>
        <button class="action special ${call || calledAll ? 'called' : ''}" data-ab="special" ${spReady ? '' : 'disabled'}><span class="a-icon">✦</span><span><div class="a-name">${esc(a.special.name.toUpperCase())}</div><div class="a-desc">${esc(a.special.desc)}</div></span><span class="a-tag">${spReady ? (call ? 'CALLED!' : 'READY') : `${pub.cd} MORE`}</span></button>
        ${ultReady || !live ? `<button class="action ult" data-ab="ult" ${ultReady ? '' : 'disabled'}><span class="a-icon" style="background:#ffa502">★</span><span><div class="a-name">${esc(a.ult.name.toUpperCase())}</div><div class="a-desc">${esc(a.ult.desc)}</div></span><span class="a-tag">READY</span></button>`
            : `<div class="ult-charging">★ ${esc(a.ult.name.toUpperCase())} CHARGING… ${pub.ult}%</div>`}`;
}

function drawActions(box) {
    const pub = S.me.pub, c = CLASSES[pub.cls];
    box.innerHTML = `<div class="label" style="text-align:center">CORRECT! CHOOSE YOUR MOVE</div>
        <div class="act-grid" id="g-act">${actionButtons(c, pub)}</div>`;
    $('#g-act').onclick = e => {
        const b = e.target.closest('.action');
        if (!b || b.disabled) return;
        const ab = b.dataset.ab;
        if (c.abilities[ab].target === 'ally') { S.ability = ab; S.local = 'target'; S.lastKey = null; drawControls(); renderSquad(hostNow()); return; }
        doAct(ab, null);
    };
}

function drawTargeting(box) {
    const c = CLASSES[S.me.pub.cls], def = c.abilities[S.ability];
    const narrow = matchMedia('(max-width: 820px)').matches;
    if (!narrow) {
        box.innerHTML = `<div class="pick-prompt">${esc(def.name.toUpperCase())}: CLICK A TEAMMATE IN YOUR SQUAD ▶</div>
            <div class="muted" style="text-align:center">Down teammates and anyone TARGETED are listed first.${def.kind === 'heal' ? ' Healing a downed teammate revives them!' : ''}</div>
            <button class="btn ghost" id="g-back" style="align-self:center">BACK</button>`;
    } else {
        // small screens have no sidebar: pick from a grid instead
        const allies = Object.values(S.room.players || {}).map(n => n.pub).filter(p => p && (p.status === 'alive' || (def.kind === 'heal' && p.status === 'down')));
        box.innerHTML = `<div class="pick-prompt">${esc(def.name.toUpperCase())}: PICK A TEAMMATE</div>
            <div class="targets" id="g-tg">${allies.map(p => `<button class="target ${p.status === 'down' ? 'down' : ''}" data-cls="${p.cls}" data-id="${p.id}"><div class="t-name">${esc(p.name)}</div><div class="bar hp" style="height:6px;margin-top:6px"><i style="width:${pct(p.hp, p.maxHp)}%"></i></div></button>`).join('')}</div>
            <button class="btn ghost" id="g-back">BACK</button>`;
        $('#g-tg').onclick = e => { const t = e.target.closest('.target'); if (t) doAct(S.ability, t.dataset.id); };
    }
    $('#g-back').onclick = () => { S.local = 'action'; S.lastKey = null; drawControls(); renderSquad(hostNow()); };
}

function doAct(ab, target) {
    const c = CLASSES[S.me.pub.cls];
    sendIntent(S.code, S.pid, { t: 'x', ab, tg: target || null });
    if (ab === 'ult') { Audio.sfxUltimate(); flash(c.color, 0.35); }
    S.local = 'feedback';
    $('#controls').innerHTML = '';
    renderSquad(hostNow());
    setTimeout(() => { S.local = 'question'; S.lastKey = null; drawControls(); }, 650);
}

// ---------------------------------------------------------------- effects from the host

function playFx() {
    if (S.screen !== 'game') {
        // don't replay history when the game screen first opens
        S.fxSeq = Math.max(S.fxSeq, ...[...(S.live.fx || []), ...(S.me?.fx || [])].map(e => e.s), 0);
        return;
    }
    const all = [...(S.live.fx || []), ...(S.me?.fx || [])].filter(e => e.s > S.fxSeq).sort((a, b) => a.s - b.s);
    for (const ev of all) { S.fxSeq = Math.max(S.fxSeq, ev.s); effect(ev); }
}

function effect(ev) {
    const me = S.pid, layer = $('#dmg-layer');
    const pub = S.me.pub, c = CLASSES[pub.cls];
    const by = id => esc(S.room.players?.[id]?.pub?.name || 'A teammate');
    S.counters ||= { shields: 0, heals: 0, revives: 0, exposes: 0 };
    switch (ev.type) {
        case 'hit': if (ev.pid === me) {
            const legendary = !!ev.combo || ev.amount >= 8000;
            const t = damageNumber(layer, ev.amount, { crit: ev.crit, legendary, label: ev.combo ? ev.combo + '!' : ev.ability === 'ult' ? c.abilities.ult.name.toUpperCase() : '' });
            Audio.sfxHit(ev.amount);
            unlock('first_blood');
            if (ev.crit) unlock('crit');
            if (ev.amount >= 5000) unlock('heavy');
            if (ev.combo) { unlock('shatter'); slam(ev.combo + '!', { color: '#ff9d00', sub: fmtNum(ev.amount) + ' DAMAGE' }); }
            if (t && t.id === 'legendary') unlock('legendary');
        } break;
        case 'ult': if (ev.pid === me) { slam(c.abilities.ult.name.toUpperCase() + '!', { color: c.color }); unlock('ult'); } break;
        case 'heal':
            if (ev.pid === me && ev.target !== me) { textPop(layer, `+${fmtNum(ev.amount)} HEALED`, '#2ed573'); if (++S.counters.heals >= 3) unlock('medic'); }
            if (ev.target === me) { textPop(layer, `+${fmtNum(ev.amount)} HP`, '#2ed573', 2.4); flash('#2ed573', 0.2); if (ev.pid !== me) toast(`${by(ev.pid)} healed you`); }
            break;
        case 'shield':
            if (ev.pid === me) { textPop(layer, '◆ SHIELD UP', '#7d95ff'); if (++S.counters.shields >= 5) unlock('bodyguard'); }
            if (ev.target === me && ev.pid !== me) { textPop(layer, '◆ SHIELDED', '#7d95ff', 2.4); toast(`${by(ev.pid)} shielded you`); }
            break;
        case 'shieldBlock': if (ev.pid === me) { textPop(layer, 'BLOCKED!', '#7d95ff', 2.8); Audio.sfxShield(); } break;
        case 'playerHit': if (ev.pid === me) { textPop(layer, `−${fmtNum(ev.amount)}`, '#ff4757', 3); flash('#ff2a3d', 0.4); shake($('#g')); navigator.vibrate && navigator.vibrate(150); } break;
        case 'selfDamage': if (ev.pid === me) textPop(layer, `−${fmtNum(ev.amount)}`, '#ff6b81', 1.6); break;
        case 'revive':
            if (ev.pid === me) { slam('BACK IN THE FIGHT!', { color: '#2ed573', sub: ev.by ? `REVIVED BY ${by(ev.by)}` : 'REBOOTED' }); flash('#2ed573', 0.4); unlock('comeback'); S.local = 'question'; S.q = null; S.lastKey = null; }
            if (ev.by === me && ev.pid !== me) { textPop(layer, 'REVIVED!', '#2ed573', 2.8); if (++S.counters.revives >= 1) unlock('revive1'); if (S.counters.revives >= 3) unlock('revive3'); }
            break;
        case 'down': if (ev.pid === me) { S.downThisBoss = true; S.streak = 0; slam("YOU'RE DOWN!", { color: '#ff4757', sub: 'ANSWER TO REBOOT, OR CALL A MEDIC' }); flash('#ff2a3d', 0.6); S.local = 'question'; S.q = null; S.lastKey = null; } break;
        case 'eliminated': if (ev.pid === me) { S.downThisBoss = true; slam('OUT OF LIVES', { color: '#9fd0ff', sub: 'YOUR ANSWERS NOW POWER THE TEAM RALLY' }); S.local = 'question'; S.lastKey = null; } break;
        case 'infected': if (ev.pid === me) toast('☣ You are infected! Ask a Medic for a heal'); break;
        case 'cured': if (ev.target === me) toast(`${by(ev.pid)} cured you`); break;
        case 'expose': if (ev.pid === me) { textPop(layer, 'EXPOSED!', CLASSES.TACTICIAN.color, 2.6); if (++S.counters.exposes >= 3) unlock('weakpoint'); } break;
        case 'interrupt': if (ev.pid === me) { slam('INTERRUPTED!', { color: CLASSES.TACTICIAN.color, sub: 'YOU STOPPED THE ATTACK' }); unlock('interrupt'); } break;
        case 'roleCallProgress': if (ev.pid === me) { textPop(layer, 'CALL ANSWERED!', '#ffa502', 2.4); unlock('call'); } break;
        case 'roleCallSuccess':
            if (Object.values(ev.call?.who || {}).includes(me)) { slam('ATTACK STOPPED!', { color: '#2ed573', sub: `${fmtNum(ev.reflect)} REFLECTED BACK` }); Audio.sfxPuzzleSolve(); unlock('saver'); }
            else textPop(layer, 'ATTACK BLOCKED!', '#2ed573', 2);
            break;
        case 'combo': if (ev.pid !== me) textPop(layer, `${ev.name}! (${by(ev.pid)})`, '#ff9d00', 2); break;
        case 'synergy': if (ev.level === 4) { slam('FULL SYNERGY', { color: '#c45cff', sub: 'ALL FOUR CLASSES · ×1.5 DAMAGE' }); if (pub.status === 'alive') unlock('synergy'); } break;
        case 'phase': slam(`BOSS ${ev.phase}!`, { color: ev.phase === 'DESPERATE' ? '#ff4757' : '#ffa502' }); break;
        case 'enrage': slam('TIME\'S UP!', { color: '#ff4757', sub: 'THE BOSS IS ENRAGED' }); break;
        case 'rally': slam('SPIRIT RALLY', { color: '#9fd0ff', sub: '+20% HP FOR EVERYONE' }); break;
        case 'wipe': slam('SQUAD WIPED', { color: '#ff4757' }); break;
        case 'rejected': if (ev.pid === me) toast({ 'no fight': 'Too late, that fight is over!', 'target is down': 'They went down. Pick someone else', 'target is out': 'They are out of lives', 'regrouping': 'Regrouping, hold on!' }[ev.reason] || 'That move didn\'t go through'); break;
    }
}

// ================================================================= end

function renderEnd() {
    const pub = S.me?.pub, st = S.me?.stats;
    const won = S.live.status === 'victory';
    const acc = st ? Math.round((st.correct / Math.max(1, st.correct + st.wrong)) * 100) : 0;
    const missed = Object.keys(S.myMissed).map(i => S.questions[i]).filter(Boolean);
    const achv = unlockedList();
    if (won) setTimeout(() => confetti(160), 300);
    mount(`<div class="screen center" data-cls="${pub?.cls || ''}" style="justify-content:flex-start">
        <div class="display" style="font-size:2.4rem;margin-top:20px;color:${won ? '#2ed573' : '#ff4757'}">${won ? 'VICTORY!' : 'RAID FAILED'}</div>
        <div class="muted">Look up at the projector for the awards.</div>
        ${st ? `<div class="panel" style="width:min(520px,100%);margin-top:16px;text-align:left;display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div><div class="label">ACCURACY</div><div class="display gold" style="font-size:1.6rem">${acc}%</div></div>
            <div><div class="label">BEST STREAK</div><div class="display" style="font-size:1.6rem">${st.bestStreak}</div></div>
            <div><div class="label">DAMAGE</div><div class="display" style="font-size:1.3rem">${fmtNum(st.dmg)}</div></div>
            <div><div class="label">HEALED / SHIELDS</div><div class="display" style="font-size:1.3rem">${fmtNum(st.heal)} / ${st.shields}</div></div>
            <div><div class="label">ROLE CALLS</div><div class="display" style="font-size:1.3rem">${st.roleCalls}</div></div>
            <div><div class="label">REVIVES GIVEN</div><div class="display" style="font-size:1.3rem">${st.revives}</div></div>
        </div>` : ''}
        ${achv.length ? `<div class="panel" style="width:min(520px,100%);margin-top:12px;text-align:left"><div class="label" style="margin-bottom:6px">ACHIEVEMENTS · ${achv.length} OF ${Object.keys(ACHIEVEMENTS).length}</div>
            ${achv.map(id => `<div style="padding:6px 0;border-top:1px solid var(--line)">🏆 <b class="gold">${ACHIEVEMENTS[id]}</b> <span class="muted">· ${esc(achievementDesc(id))}</span></div>`).join('')}</div>` : ''}
        ${missed.length ? `<div class="panel" style="width:min(520px,100%);margin-top:12px;text-align:left"><div class="label" style="margin-bottom:6px">REVIEW THESE</div>
            ${missed.map(q => `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${esc(q.text)}</b><div style="color:#2ed573">${esc(q.answers[q.correct])}</div></div>`).join('')}</div>` : ''}
    </div>`);
}
