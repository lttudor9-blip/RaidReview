// STUDENT — the phone / Chromebook controller.
//
// Answers are checked locally for instant feedback, then sent to the host as
// intents; the host applies the real rules and publishes everyone's state.

import { CLASSES, CLASS_IDS } from '../content/classes.js';
import { BOSSES, DIFFICULTY } from '../content/raid.js';
import { questionDeck, shuffled } from '../content/questions.js';
import { playerIdFor, joinRoom, chooseClass, sendIntent, listenRoom, lookupRoom } from '../net/room.js';
import { AudioEngine as Audio } from '../audio.js';
import { mount, esc, $, toast, flash, shake, fmtNum, pct } from '../ui.js';

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
            <div class="actions" id="t-act">${actionButtons(c, { armed: true, cd: 0, ult: 100 }, false)}</div>`,
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

// ================================================================= game

function renderGameShell() {
    const cls = S.me.profile.cls;
    mount(`
    <div class="screen" data-cls="${cls}" id="g">
        <div class="stu-top">
            <div class="stu-name" id="g-name"></div>
            <div class="label" id="g-status"></div>
            <div class="stu-bars">
                <div><div class="label">HP</div><div class="bar hp" id="g-hp"><i></i></div></div>
                <div><div class="label">★ ULTIMATE</div><div class="bar ult" id="g-ult"><i></i></div></div>
            </div>
        </div>
        <div class="stu-boss" id="g-boss"></div>
        <div class="stu-main" id="g-main"></div>
    </div>`);
    S.local = 'question';
    S.q = null;
    renderMain();
}

function inFight() { return S.live.stage?.phase === 'fight' && !S.live.paused && S.live.status === 'boss' && !(S.live.regroupUntil > Date.now()); }
function myCall() {
    const call = S.live.boss?.attack?.call;
    return call && !call.done && call.cls === S.me.pub.cls ? call : null;
}

function updateGame() {
    const pub = S.me.pub, c = CLASSES[pub.cls];
    $('#g-name').textContent = `${pub.name} · ${c.name.toUpperCase()}`;
    $('#g-status').innerHTML = `${'♥'.repeat(Math.max(0, pub.lives))}${pub.shield ? ' <span style="color:#4a6cff">◆ SHIELD</span>' : ''}${pub.infected ? ' <span style="color:#7bed9f">☣ INFECTED</span>' : ''}${pub.streak >= 3 ? ` <span class="gold">🔥${pub.streak}</span>` : ''}`;
    const hp = $('#g-hp'); hp.querySelector('i').style.width = pct(pub.hp, pub.maxHp) + '%'; hp.classList.toggle('low', pub.hp / pub.maxHp < 0.35);
    $('#g-ult').querySelector('i').style.width = pub.ult + '%';

    const b = S.live.boss, atk = b?.attack, call = atk?.call;
    let strip = '';
    if (b && S.live.stage?.kind === 'boss') {
        strip = `<span style="color:${BOSSES[b.id].color}">${esc(b.name)}</span><div class="bar grow" style="height:8px"><i style="width:${pct(b.hp, b.maxHp)}%;background:#ff4757"></i></div><span>${Math.ceil(pct(b.hp, b.maxHp))}%</span>`;
    }
    $('#g-boss').innerHTML = strip;

    // role-call change re-renders the action panel so the special can light up
    const callId = call && !call.done ? `${atk.id}-${atk.startedAt}` : null;
    if (callId !== S.lastCallId) {
        S.lastCallId = callId;
        if (callId && call.cls === pub.cls) { Audio.sfxCountdown(); navigator.vibrate && navigator.vibrate([120, 60, 120]); }
        if (S.local === 'action') renderMain();
    }
    renderMain(true);
}

// Main panel. `soft` = only re-render if the situation changed (avoid wiping taps).
function renderMain(soft) {
    if (soft && situationKey() === S.lastKey) { updateBanner(); return; }
    const main = $('#g-main');
    if (!main) return;
    drawMain(main);
    S.lastKey = situationKey(); // after drawing, so a freshly dealt question isn't redrawn under a finger
}

function drawMain(main) {
    const pub = S.me.pub;

    const stage = S.live.stage;
    if (S.live.paused) return void (main.innerHTML = card('PAUSED', 'Eyes on your teacher.'));
    if (S.live.regroupUntil > Date.now()) return void (main.innerHTML = card('SQUAD WIPED', 'Regroup! Talk it through: who needs to do what next time?', '#ff4757'));
    if (stage?.kind === 'boss' && stage.phase === 'intro') return void (main.innerHTML = card(BOSSES[stage.id].name, 'Get ready…', BOSSES[stage.id].color));
    if (stage?.kind === 'boss' && stage.phase === 'outro') return void (main.innerHTML = card('BOSS DOWN!', 'Nice work, squad.', '#2ed573'));
    if (stage?.kind === 'rest') return void (main.innerHTML = card('SUPPLY DROP', 'You got patched up. Next boss incoming!', '#ffa502'));
    if (!inFight()) return void (main.innerHTML = card('STAND BY', ''));

    if (S.local === 'action' && pub.status === 'alive') return renderActions(main);
    if (S.local === 'target') return renderTargets(main);
    if (S.local === 'feedback') return;
    renderQuestion(main);
}

function situationKey() {
    const st = S.live.stage || {};
    return [st.kind, st.id, st.phase, S.live.paused, S.live.regroupUntil > Date.now(), S.local, S.me.pub.status, S.q?.i ?? -1].join('|');
}

function card(title, sub, color = '#fff') {
    return `<div class="panel" style="margin:auto;text-align:center;padding:28px 18px;width:100%">
        <div class="display" style="font-size:clamp(1.6rem,7vw,2.4rem);color:${color}">${esc(title)}</div>
        <div class="muted" style="margin-top:8px">${esc(sub)}</div></div>`;
}

function banner() {
    const pub = S.me.pub;
    if (pub.status === 'down') {
        const need = DIFFICULTY[S.room.meta.difficulty || 'regular'].reviveNeed;
        return `<div class="callout">YOU'RE DOWN — answer ${need} in a row to reboot (${pub.revive}/${need}) or get a Medic!</div>`;
    }
    if (pub.status === 'out') return `<div class="callout" style="border-color:#9fd0ff;color:#9fd0ff;background:none">SPIRIT MODE: your right answers power the team rally (${S.live.team?.rally || 0}%)</div>`;
    const call = S.live.boss?.attack?.call;
    if (call && !call.done) {
        if (call.cls === pub.cls) return `<div class="callout mine">BOSS CALLS ${CLASSES[pub.cls].name.toUpperCase()}S! Answer, then hit ${esc(CLASSES[pub.cls].abilities.special.name.toUpperCase())}!</div>`;
        if (call.cls === 'ALL' && !call.who[pub.cls]) return `<div class="callout mine">EVERY CLASS NEEDED — ${CLASSES[pub.cls].name.toUpperCase()}S HAVEN'T ACTED YET!</div>`;
        if (call.cls === 'ANY') return `<div class="callout">EVERYONE: ACT NOW TO STOP ${esc(S.live.boss.attack.name)}!</div>`;
    }
    return '';
}
function updateBanner() {
    const el = $('#g-banner');
    if (el) el.innerHTML = banner();
}

// ---------------------------------------------------------------- questions

function nextQuestion() {
    const i = S.deck();
    const q = S.questions[i];
    const order = q.type === 'tf' || S.room.meta.shuffle === false ? q.answers.map((_, k) => k) : shuffled(q.answers.map((_, k) => k));
    S.q = { i, q, order, shownAt: Date.now() };
}

function renderQuestion(main) {
    if (!S.q) nextQuestion();
    const { q, order } = S.q;
    main.innerHTML = `<div id="g-banner">${banner()}</div>
        <div class="question">${esc(q.text)}</div>
        <div class="answers arming ${q.answers.length === 2 ? 'two' : ''}" id="g-ans">${order.map((orig, k) => `<button class="answer" data-k="${k}">${esc(q.answers[orig])}</button>`).join('')}</div>`;
    $('#g-ans').onclick = e => {
        const btn = e.target.closest('.answer');
        if (!btn || S.local !== 'question' || $('#g-ans').classList.contains('arming')) return;
        pick(+btn.dataset.k, btn);
    };
    // answers fade in and only become tappable once visible (stops auto-clickers
    // without silently eating a fast student's tap)
    setTimeout(() => { const g = $('#g-ans'); if (g) g.classList.remove('arming'); }, 400);
}

function pick(k, btn) {
    Audio.ensureCtx();
    const { i, q, order } = S.q;
    const picked = order[k];
    const correct = picked === q.correct;
    S.local = 'feedback';
    sendIntent(S.code, S.pid, { t: 'a', q: i, p: picked });
    const grid = $('#g-ans');
    grid.classList.add('locked');
    btn.classList.add(correct ? 'right' : 'wrong');
    if (!correct) {
        grid.children[order.indexOf(q.correct)].classList.add('right'); // learn from the miss
        S.myMissed[i] = (S.myMissed[i] || 0) + 1;
        Audio.sfxWrong(); shake($('#g'));
    } else Audio.sfxCorrect();
    const alive = S.me.pub.status === 'alive';
    setTimeout(() => {
        S.q = null;
        S.local = correct && alive ? 'action' : 'question';
        renderMain();
    }, correct ? 550 : 1700);
}

// ---------------------------------------------------------------- actions

function actionButtons(c, pub, live = true) {
    const call = live ? myCall() : null;
    const callAll = live && S.live.boss?.attack?.call;
    const a = c.abilities;
    const spReady = pub.cd <= 0 || !!call;
    const ultReady = pub.ult >= 100;
    const tag = (txt) => `<span class="a-tag">${txt}</span>`;
    return `
        <button class="action" data-ab="basic"><span class="a-icon">${c.id[0]}</span><span><div class="a-name">${esc(a.basic.name.toUpperCase())}</div><div class="a-desc">${esc(a.basic.desc)}</div></span>${tag('')}</button>
        <button class="action special ${call || (callAll && callAll.cls === 'ALL' && !callAll.done && !callAll.who[c.id]) ? 'called' : ''}" data-ab="special" ${spReady ? '' : 'disabled'}><span class="a-icon">✦</span><span><div class="a-name">${esc(a.special.name.toUpperCase())}</div><div class="a-desc">${esc(a.special.desc)}</div></span>${tag(spReady ? (call ? 'CALLED!' : 'READY') : `${pub.cd} MORE`)}</button>
        <button class="action ult" data-ab="ult" ${ultReady ? '' : 'disabled'}><span class="a-icon" style="background:#ffa502">★</span><span><div class="a-name">${esc(a.ult.name.toUpperCase())}</div><div class="a-desc">${esc(a.ult.desc)}</div></span>${tag(ultReady ? 'READY' : pub.ult + '%')}</button>`;
}

function renderActions(main) {
    const pub = S.me.pub, c = CLASSES[pub.cls];
    main.innerHTML = `<div id="g-banner">${banner()}</div>
        <div class="label" style="text-align:center">CORRECT! CHOOSE YOUR MOVE</div>
        <div class="actions" id="g-act">${actionButtons(c, pub)}</div>`;
    $('#g-act').onclick = e => {
        const b = e.target.closest('.action');
        if (!b || b.disabled) return;
        const ab = b.dataset.ab;
        const def = c.abilities[ab];
        if (def.target === 'ally') { S.ability = ab; S.local = 'target'; renderMain(); return; }
        doAct(ab, null);
    };
}

function renderTargets(main) {
    const pub = S.me.pub, c = CLASSES[pub.cls];
    const def = c.abilities[S.ability];
    const call = S.live.boss?.attack;
    const targeted = new Set(call?.targets || []);
    const allies = Object.values(S.room.players || {}).map(n => n.pub).filter(Boolean)
        .filter(p => p.status === 'alive' || (def.kind === 'heal' && p.status === 'down'))
        .sort((a, b) => (b.status === 'down') - (a.status === 'down') || targeted.has(b.id) - targeted.has(a.id) || a.hp / a.maxHp - b.hp / b.maxHp);
    main.innerHTML = `<div class="label" style="text-align:center">${esc(def.name.toUpperCase())}: PICK A TEAMMATE</div>
        <div class="targets" id="g-tg">${allies.map(p => `
            <button class="target ${p.status === 'down' ? 'down' : ''}" data-cls="${p.cls}" data-id="${p.id}">
                <div class="t-name">${esc(p.name)}${p.id === S.pid ? ' (you)' : ''}</div>
                <div class="bar hp ${p.hp / p.maxHp < 0.35 ? 'low' : ''}" style="height:6px;margin:6px 0"><i style="width:${pct(p.hp, p.maxHp)}%"></i></div>
                <div class="a-tag">${p.status === 'down' ? '<b style="color:#ff4757">DOWN — REVIVE</b>' : targeted.has(p.id) ? '<b style="color:#ff4757">TARGETED</b>' : ''}${p.shield ? ' ◆' : ''}${p.infected ? ' <b style="color:#7bed9f">☣</b>' : ''}</div>
            </button>`).join('')}</div>
        <button class="btn ghost" id="g-back">BACK</button>`;
    $('#g-tg').onclick = e => { const t = e.target.closest('.target'); if (t) doAct(S.ability, t.dataset.id); };
    $('#g-back').onclick = () => { S.local = 'action'; renderMain(); };
}

function doAct(ab, target) {
    sendIntent(S.code, S.pid, { t: 'x', ab, tg: target || null });
    if (ab === 'ult') { Audio.sfxUltimate(); flash(CLASSES[S.me.pub.cls].color, 0.35); }
    else Audio.sfxHit();
    S.local = 'feedback';
    $('#g-main').innerHTML = card(ab === 'ult' ? CLASSES[S.me.pub.cls].abilities.ult.name.toUpperCase() + '!' : 'NICE!', '', CLASSES[S.me.pub.cls].color);
    setTimeout(() => { S.local = 'question'; renderMain(); }, 700);
}

// ---------------------------------------------------------------- personal effects from the host

function playFx() {
    const list = S.live.fx || [];
    const me = S.pid;
    for (const ev of list) {
        if (ev.s <= S.fxSeq) continue;
        S.fxSeq = ev.s;
        if (S.screen !== 'game') continue;
        const by = id => esc(S.room.players?.[id]?.pub?.name || 'A teammate');
        switch (ev.type) {
            case 'rejected': if (ev.pid === me) toast({ 'no fight': 'Too late, that fight is over!', 'target is down': 'They went down. Pick someone else next time', 'target is out': 'They are out of lives', 'regrouping': 'Regrouping, hold on!' }[ev.reason] || 'That move didn\'t go through'); break;
            case 'playerHit': if (ev.pid === me) { flash('#ff2a3d', 0.4); shake($('#g')); navigator.vibrate && navigator.vibrate(150); toast(`−${fmtNum(ev.amount)} HP`); } break;
            case 'shieldBlock': if (ev.pid === me) toast('◆ Your shield blocked a hit!'); break;
            case 'shield': if (ev.target === me && ev.pid !== me) toast(`◆ ${by(ev.pid)} shielded you`); break;
            case 'heal': if (ev.target === me && ev.pid !== me) { flash('#2ed573', 0.25); toast(`+ ${by(ev.pid)} healed you`); } break;
            case 'revive': if (ev.pid === me) { flash('#2ed573', 0.4); toast(ev.by ? `${by(ev.by)} revived you!` : 'Rebooted! Back in the fight'); S.local = 'question'; S.q = null; S.lastKey = null; } break;
            case 'down': if (ev.pid === me) { flash('#ff2a3d', 0.6); toast('You went down!'); S.local = 'question'; S.q = null; S.lastKey = null; } break;
            case 'eliminated': if (ev.pid === me) { toast('Out of lives: your answers now power the team rally'); S.local = 'question'; S.lastKey = null; } break;
            case 'infected': if (ev.pid === me) toast('☣ You are infected! Ask a Medic for a heal'); break;
            case 'cured': if (ev.target === me) toast(`${by(ev.pid)} cured you`); break;
            case 'roleCallSuccess': if (Object.values(ev.call?.who || {}).includes(me)) { Audio.sfxPuzzleSolve(); toast('You helped stop the attack!'); } break;
            case 'combo': toast(`${ev.name}! (${by(ev.pid)})`); break;
            case 'synergy': if (ev.level === 4) toast('FULL SYNERGY ×1.5 — all four classes!'); break;
            case 'rally': toast('Spirit rally! +20% HP'); break;
            case 'phase': toast(`Boss ${ev.phase}!`); break;
        }
    }
}

// ================================================================= end

function renderEnd() {
    const pub = S.me?.pub, st = S.me?.stats;
    const won = S.live.status === 'victory';
    const acc = st ? Math.round((st.correct / Math.max(1, st.correct + st.wrong)) * 100) : 0;
    const missed = Object.keys(S.myMissed).map(i => S.questions[i]).filter(Boolean);
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
        ${missed.length ? `<div class="panel" style="width:min(520px,100%);margin-top:12px;text-align:left"><div class="label" style="margin-bottom:6px">REVIEW THESE</div>
            ${missed.map(q => `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${esc(q.text)}</b><div style="color:#2ed573">${esc(q.answers[q.correct])}</div></div>`).join('')}</div>` : ''}
    </div>`);
}
