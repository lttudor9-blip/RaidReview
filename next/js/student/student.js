// STUDENT — the phone / Chromebook controller.
//
// Answers are checked locally for instant feedback, then sent to the host as
// intents; the host applies the real rules and publishes everyone's state.

import { CLASSES, CLASS_IDS, SYNERGY_MULT, STREAK_BONUS } from '../content/classes.js';
import { BOSSES, DIFFICULTY, ESHIELD_LEAK } from '../content/raid.js';
import { questionDeck, shuffled } from '../content/questions.js';
import { playerIdFor, joinRoom, chooseClass, sendIntent, listenRoom, lookupRoom } from '../net/room.js';
import { AudioEngine as Audio } from '../audio.js';
import { mount, esc, $, toast, flash, shake, fmtNum, pct, setHTML, toggleFullscreen } from '../ui.js';
import { damageNumber, textPop, hitMarker, slam, streakName, unlock, unlockedList, ACHIEVEMENTS, achievementDesc, confetti } from './juice.js';
import { crest, CREST_NAMES } from '../content/crests.js';
import { abilityIcon, ABILITY_STAT, ULT_CALL } from '../content/abilityIcons.js';
import { heroText, heroColor } from '../content/heroes.js';
import { drawPuzzle, puzzleKey, puzzleTick } from './puzzle.js';
import { syncLoot } from './loot.js';

const S = {
    code: null, pid: null, room: null, me: null, live: {},
    screen: null, local: 'question',     // question | feedback | action | target
    q: null, deck: null, ability: null, fxSeq: 0, tutorialDone: false,
    lastCallId: null, myMissed: {}
};

export async function startStudent({ name, room }) {
    window.__rrStudent = S; // handy for debugging from the console
    Audio.init();
    // full screen: a button on every screen before the game (the game has one in its top bar)
    const fs = document.createElement('button');
    fs.className = 'fs-pill'; fs.type = 'button'; fs.textContent = '⛶ FULL SCREEN';
    fs.onclick = toggleFullscreen;
    document.body.appendChild(fs);
    const fsSync = () => { const on = !!(document.fullscreenElement || document.webkitFullscreenElement); fs.textContent = on ? '✕ EXIT FULL SCREEN' : '⛶ FULL SCREEN'; const b = document.getElementById('h-fs'); if (b) b.textContent = on ? '✕' : '⛶'; };
    document.addEventListener('fullscreenchange', fsSync); document.addEventListener('webkitfullscreenchange', fsSync);
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
        document.body.dataset.screen = screen;
        ({ kicked: renderKicked, classes: renderClasses, tutorial: renderTutorial, waiting: renderWaiting, game: renderGameShell, end: renderEnd })[screen]();
    } else if (screen === 'classes') updateClassCounts();
    else if (screen === 'waiting') updateWaiting();
    if (screen === 'game') updateGame();
}

// ================================================================= class select (hero select)

// A quick read on each class, like a hero-select screen (out of 5)
const CLASS_STATS = {
    WARRIOR: { DAMAGE: 5, DEFENSE: 2, SUPPORT: 1 },
    GUARDIAN: { DAMAGE: 2, DEFENSE: 5, SUPPORT: 3 },
    MEDIC: { DAMAGE: 1, DEFENSE: 2, SUPPORT: 5 },
    TACTICIAN: { DAMAGE: 3, DEFENSE: 1, SUPPORT: 4 }
};
const PICK_LINES = {
    WARRIOR: 'Biggest damage in the raid. Wait for a Tactician to Expose the boss, then drop your ultimate for SHATTER.',
    GUARDIAN: 'The wall. Your Threat Radar shows who\'s about to get hit, and your Shield blocks it. Answer GUARDIAN role calls.',
    MEDIC: 'The lifeline. See everyone\'s HP, heal whoever\'s lowest, and revive teammates who go down.',
    TACTICIAN: 'The brain. You see the boss\'s next move first. Expose it so the whole team hits harder, and call out what\'s coming.'
};

function renderClasses() {
    S.pendingClass = null;
    mount(`
    <div class="hs" id="hs">
        <div class="hs-head">
            <div class="label">ASSEMBLE YOUR SQUAD</div>
            <div class="hs-title">CHOOSE YOUR CLASS</div>
            <div class="muted">A squad with all four classes hits ×1.35 harder. Pick what your team needs!</div>
        </div>
        <div class="hs-grid" id="hs-grid">${CLASS_IDS.map(id => {
            const c = CLASSES[id], a = c.abilities, st = CLASS_STATS[id];
            return `<button class="hs-card" data-cls="${id}" data-pick="${id}">
                <div class="hs-skin"></div>
                <div class="hs-need" data-need="${id}"></div>
                <div class="hs-crest">${crest(id, { size: 118, glow: true })}</div>
                <div class="hs-role">${c.role.toUpperCase()} · ${CREST_NAMES[id].toUpperCase()}</div>
                <div class="hs-name">${c.name.toUpperCase()}</div>
                <div class="hs-tag">“${esc(c.tagline)}”</div>
                <div class="hs-stats">${Object.entries(st).map(([k, v]) => `<div class="hs-stat"><span>${k}</span><span class="pips5">${Array.from({ length: 5 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</span></div>`).join('')}</div>
                <div class="hs-abil">
                    <div class="hs-ab"><span class="k">BASIC</span><div><b>${esc(a.basic.name)}</b> ${esc(a.basic.desc)}</div></div>
                    <div class="hs-ab"><span class="k">SPECIAL</span><div><b>${esc(a.special.name)}</b> ${esc(a.special.desc)}</div></div>
                    <div class="hs-ab ult"><span class="k">★ ULT</span><div><b>${esc(a.ult.name)}</b> ${esc(a.ult.desc)}</div></div>
                </div>
                <div class="hs-job"><span class="k">YOUR JOB</span>${esc(PICK_LINES[id])}</div>
                <div class="hs-count" data-count="${id}"></div>
            </button>`;
        }).join('')}</div>
        <div class="hs-foot"><button class="hs-lock" id="hs-lock" disabled>PICK A CLASS</button></div>
    </div>`);
    $('#hs-grid').onclick = e => {
        const card = e.target.closest('[data-pick]');
        if (!card) return;
        Audio.ensureCtx(); Audio.sfxBuff();
        S.pendingClass = card.dataset.pick;
        document.querySelectorAll('.hs-card').forEach(c => c.classList.toggle('picked', c === card));
        $('#hs').classList.add('has-pick');
        $('#hs').dataset.cls = S.pendingClass;
        const lock = $('#hs-lock');
        lock.disabled = false;
        lock.dataset.cls = S.pendingClass;
        lock.innerHTML = `${crest(S.pendingClass, { size: 34 })} LOCK IN ${CLASSES[S.pendingClass].name.toUpperCase()}`;
    };
    $('#hs-lock').onclick = () => {
        const cls = S.pendingClass;
        if (!cls) return;
        lockInMoment(cls);
        chooseClass(S.code, S.pid, cls);
    };
    updateClassCounts();
}

function lockInMoment(cls) {
    const c = CLASSES[cls];
    const el = document.createElement('div');
    el.className = 'lockin';
    el.dataset.cls = cls;
    el.innerHTML = `<div class="li-crest">${crest(cls, { size: 'min(40vh, 300px)', glow: true })}</div><div class="li-k">LOCKED IN</div><div class="li-name">${c.name.toUpperCase()}</div>`;
    document.body.appendChild(el);
    Audio.sfxUltimate();
    flash(c.color, 0.4);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, 1500);
}

function updateClassCounts() {
    const counts = Object.fromEntries(CLASS_IDS.map(c => [c, []]));
    for (const n of Object.values(S.room?.players || {})) if (n.profile?.cls) counts[n.profile.cls].push(n.profile.name);
    for (const c of CLASS_IDS) {
        const el = document.querySelector(`[data-count="${c}"]`);
        const names = counts[c];
        // with call signs on, classmates' real names never show on anyone's screen
        const list = S.room?.meta?.callsigns ? '' : `: ${names.slice(0, 3).map(esc).join(', ')}${names.length > 3 ? '…' : ''}`;
        if (el) setHTML(el, names.length ? `<b>${names.length}</b> in the squad${list}` : 'Nobody yet');
        const need = document.querySelector(`[data-need="${c}"]`);
        if (need) need.textContent = names.length ? '' : 'NEEDED!';
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
        if (i === 1) $('#t-act').onclick = e => { const b = e.target.closest('[data-ab]'); if (!b) return; Audio.sfxHit(); i = 2; draw(); };
        if (i === 2) $('#t-done').onclick = finish;
    };
    const finish = () => { S.tutorialDone = true; S.screen = null; onRoom(S.room); };
    draw();
}

function renderWaiting() {
    const c = CLASSES[S.me.profile.cls];
    mount(`<div class="screen center" data-cls="${c.id}">
        ${crest(c.id, { size: 150, glow: true })}
        <div class="label" style="margin-top:14px">YOU ARE A</div>
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

// What each class is told its job is, on the class reveal
const ROLE_LINES = {
    WARRIOR: 'Hit like a truck. When a Tactician Exposes the boss, unleash your ultimate for SHATTER.',
    GUARDIAN: 'Watch your Threat Radar. Shield whoever the boss is about to hit before it lands.',
    MEDIC: 'Watch the vitals. Heal the lowest, cure infections, and revive anyone who goes down.',
    TACTICIAN: 'You see the boss\'s next move first. Call it out, and Expose the boss so everyone hits harder.'
};
const INTEL_TITLES = { WARRIOR: 'STRIKE WINDOW', GUARDIAN: 'THREAT RADAR', MEDIC: 'VITALS', TACTICIAN: 'BOSS INTEL' };

function renderGameShell() {
    const cls = S.me.profile.cls;
    mount(`
    <div class="sg" data-cls="${cls}" id="g">
        <div class="skin" aria-hidden="true"></div>
        <div class="sg-main">
            <div class="sg-hud">
                <div class="sg-who">${crest(cls, { size: 42 })}<div><span class="n" id="h-name"></span><span class="c">${CLASSES[cls].name.toUpperCase()} · <span id="h-lives"></span> <span id="h-streak-chip"></span></span></div></div>
                <div class="hudbar hp" id="h-hp"><i></i><div class="t"><span>HP</span><span id="h-hpt"></span></div></div>
                <div class="hudbar ult" id="h-ult"><i></i><div class="t"><span>★ ULT</span><span id="h-ultt"></span></div></div>
                <div class="sig" id="sig"></div>
                <button class="iconbtn" id="h-fs" title="Full screen">${document.fullscreenElement ? '✕' : '⛶'}</button>
                <button class="iconbtn" id="h-mute" title="Sound">${Audio.isMuted() ? '🔇' : '🔊'}</button>
            </div>
            <div class="sg-banners" id="banners"></div>
            <div class="sg-stage">
                <canvas id="stu-boss"></canvas>
                <div class="sg-bossline" id="bossline"></div>
                <div class="intel" id="intel"><div class="intel-h">${crest(cls, { size: 22 })} ${INTEL_TITLES[cls]} <span class="intel-only">${CLASSES[cls].name.toUpperCase()}S ONLY</span></div><div class="intel-b" id="intel-b"></div></div>
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
    <div class="edge" id="edge"></div>
    <div class="vignette" id="vignette"></div>
    <div id="achv"></div>
`);
    $('#h-fs').onclick = toggleFullscreen;
    $('#h-mute').onclick = () => { const m = Audio.toggleMute(); $('#h-mute').textContent = m ? '🔇' : '🔊'; };
    document.querySelector('.sq-calls').onclick = e => {
        const k = e.target.dataset?.call;
        if (!k || e.target.disabled || hostNow() - (S.lastCallout || 0) < 6000) return;
        S.lastCallout = hostNow();
        sendIntent(S.code, S.pid, { t: 'c', k });
        toast('Callout sent to your squad');
    };
    // pick a teammate on press (not click): one tap, even if the list refreshes mid-tap
    $('#squad').onpointerdown = e => {
        const card = e.target.closest('.sq-card.targetable');
        if (card && S.local === 'target') { e.preventDefault(); doAct(S.ability, card.dataset.id); }
    };
    $('#squad').onclick = e => {
        const card = e.target.closest('.sq-card.targetable');
        if (card && S.local === 'target') doAct(S.ability, card.dataset.id);
    };
    S.local = 'question';
    S.q = null;
    S.lastKey = null;
    S.prevUlt = S.me.pub.ult;
    S.bossR = null; S.bossId = null;
    drawControls();
    if (!S.revealed) classReveal(cls);
}

function classReveal(cls) {
    S.revealed = true;
    const c = CLASSES[cls];
    const el = document.createElement('div');
    el.className = 'class-reveal';
    el.dataset.cls = cls;
    el.innerHTML = `<div class="cr-crest">${crest(cls, { size: 'min(34vh, 260px)', glow: true })}</div>
        <div class="label">YOU ARE THE</div>
        <div class="cr-name">${c.name.toUpperCase()}</div>
        <div class="cr-tag"><i>${esc(c.tagline)}</i> · ${esc(CREST_NAMES[cls])}</div>
        <div class="cr-job">${esc(ROLE_LINES[cls])}</div>
        <div class="label" style="margin-top:14px">CLICK TO CONTINUE</div>`;
    document.body.appendChild(el);
    Audio.ensureCtx(); Audio.sfxBossIntro();
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 400); };
    el.onclick = close;
    setTimeout(close, 4200);
}

function edge(color) {
    const e = $('#edge');
    if (!e) return;
    e.style.setProperty('--ec', color);
    e.classList.remove('on'); void e.offsetWidth; e.classList.add('on');
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
const playersPub = () => Object.values(S.room.players || {}).map(n => n.pub).filter(Boolean);
const nameOf = id => esc(S.room.players?.[id]?.pub?.name || '?');

// ---------------------------------------------------------------- per-update rendering

function updateGame() {
    const pub = S.me.pub, c = CLASSES[pub.cls];
    if (S.live.clock && S.live.clock !== S.clockSeen) { S.clockSeen = S.live.clock; S.clockOffset = S.live.clock - Date.now(); }
    const now = hostNow();

    $('#h-name').textContent = pub.name;
    setHTML($('#h-lives'), `<span style="color:#ff4757">${'♥'.repeat(Math.max(0, pub.lives))}</span>`);
    const hp = $('#h-hp');
    hp.querySelector('i').style.width = pct(pub.hp, pub.maxHp) + '%';
    hp.classList.toggle('low', pub.hp / pub.maxHp < 0.3);
    $('#h-hpt').textContent = `${fmtNum(pub.hp)} / ${fmtNum(pub.maxHp)}`;
    const ult = $('#h-ult');
    ult.querySelector('i').style.width = pub.ult + '%';
    ult.classList.toggle('ready', pub.ult >= 100);
    $('#h-ultt').textContent = pub.ult >= 100 ? 'READY!' : pub.ult + '%';
    if (pub.ult >= 100 && (S.prevUlt ?? 0) < 100 && pub.status === 'alive') { slam('ULTIMATE READY', { color: '#ffa502', sub: c.abilities.ult.name.toUpperCase() }); edge('#ffa502'); Audio.sfxAchievement(); }
    S.prevUlt = pub.ult;
    const streak = S.streak || 0;
    setHTML($('#h-streak-chip'), streak >= 2 && pub.cls !== 'WARRIOR' ? `<span class="gold">🔥${streak}</span>` : '');
    $('#vignette').classList.toggle('on', pub.status === 'alive' && pub.hp / pub.maxHp < 0.3 && inFight());
    $('#call-ult').disabled = pub.ult < 100;

    const b = S.live.boss;
    setHTML($('#bossline'), b && S.live.stage?.kind === 'boss'
        ? `<span style="color:${BOSSES[b.id].color}">${esc(b.name)}</span><div class="bar boss ${b.phase === 'DESPERATE' ? 'desperate' : b.phase === 'ENRAGED' ? 'enraged' : ''}" style="height:12px;border:0"><i style="width:${pct(b.hp, b.maxHp)}%"></i></div><span>${Math.ceil(pct(b.hp, b.maxHp))}%</span>`
        : '');

    syncBoss();
    setHTML($('#sig'), signature(now));
    $('#intel').hidden = !inFight();
    if (inFight()) setHTML($('#intel-b'), intel(now));
    setHTML($('#banners'), banners(now));
    if (S.live.stage?.kind === 'puzzle') puzzleTick(S.live, now);
    const wasLoot = !!S.lootOpen;
    S.lootOpen = syncLoot({ live: S.live, cls: pub.cls, now, send: it => sendIntent(S.code, S.pid, it), local: (S.lootLocal ||= {}) });
    if (S.lootOpen && !wasLoot) { Audio.sfxAchievement(); confetti(40); }
    if (S.lootOpen && S.live.upgrade?.phase === 'reveal' && !S.lootRevealed) { S.lootRevealed = true; confetti(120); Audio.sfxPuzzleSolve(); }
    if (!S.lootOpen) S.lootRevealed = false;
    renderSquad(now);

    // a new role call for my class re-draws the action panel so the special lights up
    const atk = b?.attack, call = atk?.call;
    const callId = call && !call.done ? `${atk.id}-${atk.startedAt}` : null;
    if (callId !== S.lastCallId) {
        S.lastCallId = callId;
        if (callId && call.cls === pub.cls) { Audio.sfxCountdown(); edge(c.color); navigator.vibrate && navigator.vibrate([120, 60, 120]); }
        if (S.local === 'action') S.lastKey = null;
    }
    drawControls(true);
}

// The boss on your own screen: it flinches when YOU hit it.
function syncBoss() {
    const b = S.live.boss, st = S.live.stage;
    const want = b && st?.kind === 'boss' && st.phase !== 'intro' ? b.id : null;
    if (want !== S.bossId) {
        if (S.bossR) { S.bossR.destroy(); S.bossR = null; }
        S.bossId = want;
        const cv = $('#stu-boss');
        if (want && cv && window.BossRenderer) { S.bossR = window.BossRenderer.create(cv, want, { maxDpr: 1 }); S.bossR.intro(900); }
    }
    if (S.bossR && b) { S.bossR.setHealth(b.hp / b.maxHp); S.bossR.setPhase(b.enraged && b.phase === 'NORMAL' ? 'ENRAGED' : b.phase); }
}

// Class signature meter in the HUD
function signature(now) {
    const pub = S.me.pub, cls = pub.cls, streak = S.streak || 0;
    if (cls === 'WARRIOR') {
        const bonus = streakBonusPct(streak, cls);
        return `<div class="sig-h">RAGE <b>${bonus ? `+${bonus}% DMG` : ''}</b></div><div class="rage">${Array.from({ length: 8 }, (_, i) => `<i class="${i < Math.min(8, streak) ? 'on' : ''}"></i>`).join('')}</div>`;
    }
    if (cls === 'GUARDIAN') {
        const t = S.lastShield && S.room.players?.[S.lastShield]?.pub;
        return `<div class="sig-h">PROTECTING</div><div class="sig-v">${t ? `${esc(t.name)} ${t.shield ? '<span style="color:#7d95ff">◆ UP</span>' : '<span class="muted">(used)</span>'}` : '<span class="muted">nobody yet</span>'}</div>`;
    }
    if (cls === 'MEDIC') {
        const team = playersPub().filter(p => p.status !== 'out');
        const worst = team.sort((a, b) => (a.status === 'down' ? -1 : a.hp / a.maxHp) - (b.status === 'down' ? -1 : b.hp / b.maxHp))[0];
        const lvl = !worst ? 'calm' : worst.status === 'down' ? 'critical' : worst.hp / worst.maxHp < 0.35 ? 'alert' : 'calm';
        return `<div class="ecg ${lvl}"><svg viewBox="0 0 120 30" preserveAspectRatio="none"><polyline points="0,15 30,15 38,6 46,26 54,2 62,22 68,15 120,15"/></svg></div>
            <div class="sig-v">${worst ? (worst.status === 'down' ? `<b style="color:#ff4757">${esc(worst.name)} DOWN</b>` : `${esc(worst.name)} ${Math.round(pct(worst.hp, worst.maxHp))}%`) : ''}</div>`;
    }
    const b = S.live.boss;
    const exposed = b && b.exposedUntil > now;
    return `<div class="sig-h">EXPOSE</div><div class="sig-v">${exposed ? `<b style="color:#c9a2ff">ACTIVE ${Math.ceil((b.exposedUntil - now) / 1000)}s</b>` : pub.cd > 0 ? `ready in ${pub.cd}` : '<span style="color:#c9a2ff">READY</span>'}</div>`;
}

// Class-only intel: each class knows something the others don't, so they have to talk.
function intel(now) {
    const pub = S.me.pub, b = S.live.boss;
    if (!b) return '';
    const secs = t => Math.max(0, Math.ceil((t - now) / 1000));
    const atk = b.attack;
    if (pub.cls === 'TACTICIAN') {
        const attacks = BOSSES[b.id].attacks;
        const next = [...attacks].sort((x, y) => (b.cds[x.id] || 0) - (b.cds[y.id] || 0))[0];
        const callWho = a => a.roleCall ? (a.roleCall === 'ALL' ? 'EVERY CLASS' : CLASSES[a.roleCall].name.toUpperCase() + 'S') : null;
        let html = atk ? `<div class="iv danger">NOW: <b>${esc(atk.name)}</b> lands in ${secs(atk.landsAt)}s</div>` : '';
        if (next && (!atk || next.id !== atk.id)) {
            const w = callWho(next);
            html += `<div class="iv">NEXT: <b>${esc(next.name)}</b> in ~${secs(Math.max(now, b.cds[next.id] || now)) + (atk ? secs(atk.landsAt) : 0)}s</div>${w ? `<div class="iv hint">It calls <b>${w}</b>. Warn them now!</div>` : ''}`;
        }
        if (b.stunUntil > now) html += `<div class="iv">Stunned ${secs(b.stunUntil)}s</div>`;
        return html || '<div class="iv muted">Scanning…</div>';
    }
    if (pub.cls === 'GUARDIAN') {
        const tg = b.telegraph;
        let html = '';
        if (atk && atk.kind !== 'aoe') html += `<div class="iv danger">HITTING NOW: ${atk.targets.map(id => `<b>${nameOf(id)}</b>`).join(', ')} · ${secs(atk.landsAt)}s</div>`;
        if (tg) html += `<div class="iv warn">INCOMING: ${tg.targets.map(id => `<b>${nameOf(id)}</b>${S.room.players?.[id]?.pub?.shield ? ' ◆' : ''}`).join(', ')} in ~${secs(tg.at)}s</div><div class="iv hint">Shield them before it lands!</div>`;
        if (atk && atk.kind === 'aoe') html += `<div class="iv danger">${esc(atk.name)} hits EVERYONE in ${secs(atk.landsAt)}s</div>`;
        return html || '<div class="iv muted">No threats locked yet…</div>';
    }
    if (pub.cls === 'MEDIC') {
        const team = playersPub().filter(p => p.status !== 'out')
            .sort((a, x) => (x.status === 'down') - (a.status === 'down') || !!x.infected - !!a.infected || a.hp / a.maxHp - x.hp / x.maxHp).slice(0, 4);
        return team.map(p => `<div class="iv ${p.status === 'down' ? 'danger' : p.hp / p.maxHp < 0.35 ? 'warn' : ''}">${p.status === 'down' ? '✚ REVIVE' : `${Math.round(pct(p.hp, p.maxHp))}%`} <b>${esc(p.name)}</b>${p.infected ? ` <span style="color:#7bed9f">☣ ${secs(p.infected)}s</span>` : ''}${p.status === 'alive' ? ` <span class="muted">${fmtNum(p.hp)}/${fmtNum(p.maxHp)}</span>` : ''}</div>`).join('');
    }
    // WARRIOR
    if (b.exposedUntil > now) return `<div class="iv strike">STRIKE NOW! EXPOSED ${secs(b.exposedUntil)}s</div><div class="iv hint">${pub.ult >= 100 ? 'Your ultimate will SHATTER for 12,000+!' : 'Your Cleave crits for ×1.5!'}</div>`;
    if (b.stunUntil > now) return `<div class="iv strike">BOSS STUNNED ${secs(b.stunUntil)}s · HIT IT!</div>`;
    const tacts = playersPub().filter(p => p.cls === 'TACTICIAN' && p.status === 'alive');
    const ready = tacts.filter(p => p.ult >= 100);
    return `<div class="iv">Boss armored. Ask a Tactician to <b>Expose</b> it.</div>${ready.length ? `<div class="iv hint">${ready.map(p => `<b>${esc(p.name)}</b>`).join(', ')}'s System Breach is READY. Coordinate!</div>` : tacts.length ? `<div class="iv muted">Tacticians: ${tacts.map(p => esc(p.name)).join(', ')}</div>` : '<div class="iv muted">No Tacticians in the squad</div>'}`;
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
    const ls = b?.lastStand && { ...b.lastStand, who: b.lastStand.who || {}, need: b.lastStand.need || [] }; // Firebase drops the empty `who`
    if (ls && !ls.done && inFight() && pub.status === 'alive') {
        out.push(ls.who[pub.cls]
            ? `<div class="banner big" style="--bc:#2ed573">✔ ${clsName}S FIRED! Hold on: ${ls.need.filter(c => !ls.who[c]).map(c => CLASSES[c].name.toUpperCase() + 'S').join(', ') || 'everyone'} still needed <span class="bt">${secs(ls.endsAt)}s</span></div>`
            : `<div class="banner big danger">LAST STAND! ${clsName}S: ANSWER, THEN FIRE YOUR ULTIMATE! <span class="bt">${secs(ls.endsAt)}s</span></div>`);
    }
    const sh = inFight() ? b?.eshield : null, w = inFight() && b?.weak && b.weak.until > now ? b.weak : null;
    const live = pub.status === 'alive';
    if (sh && live) {
        const sc = CLASSES[sh.cls], shp = Math.round(pct(sh.hp, sh.maxHp));
        out.push(sh.cls === pub.cls
            ? `<div class="banner big" style="--bc:${sc.color}">🛡 ELEMENTAL SHIELD: ONLY ${clsName}S CAN BREAK IT! ATTACK! (${shp}% left) <span class="bt">${secs(sh.endsAt)}s</span></div>`
            : `<div class="banner" style="--bc:${sc.color}">🛡 ELEMENTAL SHIELD: your hits barely scratch it. Let the ${sc.name.toUpperCase()}S break it, keep them alive! <span class="bt">${secs(sh.endsAt)}s</span></div>`);
    } else if (w && live && w.cls === pub.cls) {
        out.push(`<div class="banner big" style="--bc:${CLASSES[pub.cls].color}">🎯 WEAK SPOT: ${clsName}S DEAL ×${w.mult} DAMAGE! Attack now <span class="bt">${secs(w.until)}s</span></div>`);
    }
    if (live && pub.silenced > now && inFight()) out.push(`<div class="banner big" style="--bc:#9fa8ff">🔇 SILENCED: basic attacks only. A Medic heal cleanses it <span class="bt">${secs(pub.silenced)}s</span></div>`);
    if (b && b.stunUntil > now && !ls && inFight() && !atk) out.push(`<div class="banner big" style="--bc:#ffb020">BOSS STAGGERED: EVERY CLASS HIT IT NOW! <span class="bt">${secs(b.stunUntil)}s</span></div>`);
    if (atk && inFight()) {
        if (call && !call.done && call.cls === pub.cls) out.push(`<div class="banner big" style="--bc:${CLASSES[pub.cls].color}">BOSS CALLS ${clsName}S! Answer, then hit ${esc(CLASSES[pub.cls].abilities.special.name.toUpperCase())} <span class="bt">${secs(atk.landsAt)}s</span></div>`);
        else if (call && !call.done && call.cls === 'ALL' && !(call.who || {})[pub.cls]) out.push(`<div class="banner big" style="--bc:#ffa502">EVERY CLASS NEEDED: ${clsName}S HAVEN'T ACTED YET! <span class="bt">${secs(atk.landsAt)}s</span></div>`);
        else if (call && !call.done && call.cls === 'ANY') out.push(`<div class="banner big" style="--bc:#ffa502">EVERYONE: ACT NOW TO STOP ${esc(atk.name)} <span class="bt">${secs(atk.landsAt)}s</span></div>`);
        else if (call && call.done) out.push(`<div class="banner" style="--bc:#2ed573">✔ ROLE CALL ANSWERED: ${esc(atk.name)} WILL BE BLOCKED</div>`);
        if ((atk.targets || []).includes(S.pid) && pub.status === 'alive' && !(call && call.done)) {
            const why = atk.kind === 'mark' ? (pub.shield ? ' (your shield will bounce it back!)' : ' — it can knock you out! GUARDIANS: SHIELD ME!')
                : atk.kind === 'silence' ? (pub.shield ? ' (your shield will block it)' : ' — you\'ll be stuck on basic attacks. Guardians can shield you!')
                : pub.shield ? ' (your shield will block it)' : ' — Guardians can shield you!';
            out.push(`<div class="banner big danger">⚠ YOU'RE TARGETED: ${esc(atk.name)}${why} <span class="bt">${secs(atk.landsAt)}s</span></div>`);
        } else if (!call) out.push(`<div class="banner danger">⚠ ${esc(atk.name)} INCOMING <span class="bt">${secs(atk.landsAt)}s</span></div>`);
    }
    if (pub.infected && pub.status === 'alive') out.push(`<div class="banner big" style="--bc:#7bed9f">☣ INFECTED: your ultimate is jammed and it spreads in <span class="bt">${secs(pub.infected)}s</span> — MEDIC! Guardians: shield the healthy to quarantine.</div>`);
    if (S.live.team?.dome > now) out.push(`<div class="banner" style="--bc:${CLASSES.GUARDIAN.color}">◆ IRON DOME: the squad is invulnerable <span class="bt">${secs(S.live.team.dome)}s</span></div>`);
    if (w && !sh && w.cls !== pub.cls) out.push(`<div class="banner" style="--bc:${CLASSES[w.cls].color}">🎯 WEAK SPOT: ${CLASSES[w.cls].name.toUpperCase()}S deal ×${w.mult} damage <span class="bt">${secs(w.until)}s</span></div>`);
    if (b && b.exposedUntil > now && pub.cls !== 'WARRIOR') out.push(`<div class="banner" style="--bc:${CLASSES.TACTICIAN.color}">BOSS EXPOSED: everyone deals +25% <span class="bt">${secs(b.exposedUntil)}s</span></div>`);
    return out.slice(0, 3).join('');
}

function renderSquad(now) {
    const list = playersPub();
    const targeting = S.local === 'target' ? CLASSES[S.me.pub.cls].abilities[S.ability] : null;
    const atk = S.live.boss?.attack;
    const targeted = new Set(atk?.targets || []);
    const soon = new Set(S.me.pub.cls === 'GUARDIAN' ? S.live.boss?.telegraph?.targets || [] : []);
    list.sort((a, b) => (b.id === S.pid) - (a.id === S.pid) || CLASS_IDS.indexOf(a.cls) - CLASS_IDS.indexOf(b.cls));
    $('#sq-count').textContent = `${list.filter(p => p.status === 'alive').length}/${list.length} UP`;
    setHTML($('#squad'), list.map(p => {
        const valid = targeting && (p.status === 'alive' || (targeting.kind === 'heal' && p.status === 'down'));
        const co = p.callout && now - p.callout.at < 8000 ? p.callout.k : null;
        return `<button class="sq-card ${p.id === S.pid ? 'me' : ''} ${p.status !== 'alive' ? p.status : ''} ${targeting ? (valid ? 'targetable' : 'disabled') : ''}" data-cls="${p.cls}" data-id="${p.id}">
            ${crest(p.cls, { size: 30 })}
            <div style="min-width:0">
                <div class="nm"><span>${esc(p.name)}${p.id === S.pid ? ' (you)' : ''}</span>${co ? `<span class="callout-badge ${co}">${{ heal: 'HEALS', shield: 'SHIELD', ult: 'ULT' }[co]}</span>` : ''}</div>
                <div class="bar hp ${p.hp / p.maxHp < 0.35 ? 'low' : ''}"><i style="width:${pct(p.hp, p.maxHp)}%"></i></div>
                <div class="tags">${p.status === 'down' ? '<b style="color:#ff4757">DOWN</b>' : p.status === 'out' ? '<span>👻 SPIRIT</span>' : ''}${targeted.has(p.id) && p.status === 'alive' ? '<b style="color:#ff4757">TARGETED</b>' : soon.has(p.id) && p.status === 'alive' ? '<b style="color:#ffa502">INCOMING</b>' : ''}${p.shield ? '<span style="color:#7d95ff">◆ SHIELD</span>' : ''}${p.infected ? '<b style="color:#7bed9f">☣</b>' : ''}${p.silenced > now && p.status === 'alive' ? '<b style="color:#9fa8ff">🔇</b>' : ''}${p.ult >= 100 ? '<span class="gold">★ ULT</span>' : ''}</div>
            </div></button>`;
    }).join(''));
    const syn = S.live.team?.syn || {};
    let n = 0;
    document.querySelectorAll('#syn .pip').forEach(p => { const on = now - (syn[p.dataset.cls] || -1e12) <= 10000; if (on) n++; p.classList.toggle('on', on); });
    $('#syn-mult').textContent = '×' + SYNERGY_MULT[Math.max(1, n)];
}

// ---------------------------------------------------------------- controls (question / actions / targeting)

function situationKey() {
    const st = S.live.stage || {};
    if (st.kind === 'puzzle') return ['puzzle', st.id, S.live.paused, puzzleKey(S.live)].join('|');
    return [st.kind, st.id, st.phase, S.live.paused, S.live.regroupUntil > hostNow(), S.local, S.me.pub.status, S.q?.i ?? -1, (S.me.pub.silenced || 0) > hostNow()].join('|');
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
    if (stage.kind === 'puzzle') {
        S.q = null; S.local = 'question';
        return drawPuzzle(box, center, { live: S.live, cls: pub.cls, now: hostNow(), send: it => sendIntent(S.code, S.pid, it), local: (S.pzLocal ||= {}) });
    }
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
        <div class="muted">${rest ? 'Patched up. Next boss incoming!' : S.live.stage.nextPuzzle ? 'Next up: a RAID PUZZLE. Solve it together to heal and power up. Your fight:' : 'Squad patched up: +40% HP, +15% ultimate. Your fight:'}</div>
        ${rest ? '' : `<div class="clear-stats">
            <div class="panel"><div class="label">DAMAGE</div><div class="v gold">${fmtNum(d('dmg'))}</div></div>
            <div class="panel"><div class="label">RIGHT</div><div class="v">${d('correct')}/${d('correct') + d('wrong')}</div></div>
            <div class="panel"><div class="label">HEALED · SHIELDS</div><div class="v">${fmtNum(d('heal'))} · ${d('shields')}</div></div>
            <div class="panel"><div class="label">SAVES · CALLS</div><div class="v">${d('saves')} · ${d('roleCalls')}</div></div>
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
        <div class="answers arming ${q.answers.length === 2 ? 'two' : ''}" id="g-ans">${order.map((orig, k) => `<button class="answer" data-k="${k}"><span class="ak">${q.answers.length === 2 ? (k ? 'B' : 'A') : 'ABCD'[k]}</span><span class="at">${esc(q.answers[orig])}</span></button>`).join('')}</div>`;
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
        textPop(layer, 'CORRECT!', '#2ed573', 2.6);
        const name = streakName(S.streak);
        if (name) { slam(name, { sub: `${S.streak} IN A ROW · +${streakBonusPct(S.streak, pub.cls)}% DAMAGE` }); edge(S.streak >= 10 ? '#ff9d00' : '#ff4757'); Audio.sfxStreak(); shake($('#g')); }
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
        textPop(layer, 'WRONG', '#ff4757', 2.4);
        Audio.sfxWrong(); shake($('#g'));
    }
    const alive = pub.status === 'alive';
    setTimeout(() => {
        S.q = null;
        S.local = correct && alive ? 'action' : 'question';
        S.lastKey = null;
        drawControls();
    }, correct ? 450 : 1700);
}

function actionButtons(c, pub, live = true) {
    const call = live ? myCall() : null;
    const callAll = live && S.live.boss?.attack?.call;
    const a = c.abilities;
    const silenced = live && (pub.silenced || 0) > hostNow();
    const spReady = !silenced && (pub.cd <= 0 || !!call);
    const ultReady = !silenced && pub.ult >= 100;
    const calledAll = callAll && callAll.cls === 'ALL' && !callAll.done && !(callAll.who || {})[c.id];
    const card = (key, extra, disabled, overlay) => {
        const ab = a[key];
        return `<button class="act act-${key} ${extra}" data-ab="${key}" ${disabled ? 'disabled' : ''}>
            <span class="act-ic">${abilityIcon(ab.id, { size: 62 })}</span>
            <span class="act-body"><span class="act-kind">${key === 'basic' ? 'BASIC' : 'SPECIAL'}</span><span class="act-name">${esc(ab.name.toUpperCase())}</span><span class="act-desc">${esc(ab.desc)}</span></span>
            <span class="act-stat">${ABILITY_STAT[ab.id] || ''}</span>${overlay || ''}
        </button>`;
    };
    const u = a.ult;
    const ult = ultReady
        ? `<button class="ult-btn ready" data-ab="ult" ${live || ultReady ? '' : 'disabled'}>
            <span class="ult-fx"></span>
            <span class="ult-ic">${abilityIcon(u.id, { size: 86 })}</span>
            <span class="ult-body"><span class="ult-kicker">★ ULTIMATE READY · PRESS IT! ★</span><span class="ult-name">${ULT_CALL[c.id]} ${esc(u.name.toUpperCase())}</span><span class="ult-desc">${esc(u.desc)}</span></span>
            <span class="ult-ic">${abilityIcon(u.id, { size: 86 })}</span>
          </button>`
        : `<button class="ult-btn" data-ab="ult" disabled>
            <span class="ult-fill" style="width:${pub.ult}%"></span>
            <span class="ult-ic">${abilityIcon(u.id, { size: 60 })}</span>
            <span class="ult-body"><span class="ult-kicker">${silenced ? '🔇 SILENCED' : '★ ULTIMATE CHARGING'} · ${pub.ult}%</span><span class="ult-name">${esc(u.name.toUpperCase())}</span><span class="ult-desc">Right answers charge it. ${esc(u.desc)}</span></span>
          </button>`;
    return card('basic', '', false, '')
        + card('special', call || calledAll ? 'called' : '', !spReady,
            silenced ? '<span class="act-lock">🔇 SILENCED</span>' : !spReady ? `<span class="act-lock">🔒 ${pub.cd} MORE RIGHT ANSWER${pub.cd > 1 ? 'S' : ''}</span>` : call || calledAll ? '<span class="act-callout">THE BOSS CALLED YOU!</span>' : '')
        + ult;
}

function drawActions(box) {
    const pub = S.me.pub, c = CLASSES[pub.cls];
    box.innerHTML = `<div class="label" style="text-align:center">CORRECT! CHOOSE YOUR MOVE</div>
        <div class="act-grid" id="g-act">${actionButtons(c, pub)}</div>`;
    $('#g-act').onclick = e => {
        const b = e.target.closest('[data-ab]');
        if (!b || b.disabled || S.local !== 'action') return;
        const ab = b.dataset.ab;
        if (c.abilities[ab].target === 'ally') { S.ability = ab; S.local = 'target'; S.lastKey = null; drawControls(); renderSquad(hostNow()); return; }
        doAct(ab, null, b);
    };
}

function drawTargeting(box) {
    const c = CLASSES[S.me.pub.cls], def = c.abilities[S.ability];
    const narrow = matchMedia('(max-width: 820px)').matches;
    if (!narrow) {
        box.innerHTML = `<div class="pick-prompt">${esc(def.name.toUpperCase())}: CLICK A TEAMMATE IN YOUR SQUAD ▶</div>
            <div class="muted" style="text-align:center">${def.kind === 'heal' ? 'Healing a downed teammate revives them!' : 'Teammates marked TARGETED or INCOMING are about to get hit.'}</div>
            <button class="btn ghost" id="g-back" style="align-self:center">BACK</button>`;
    } else {
        // small screens have no sidebar: pick from a grid instead
        const allies = playersPub().filter(p => p.status === 'alive' || (def.kind === 'heal' && p.status === 'down'));
        box.innerHTML = `<div class="pick-prompt">${esc(def.name.toUpperCase())}: PICK A TEAMMATE</div>
            <div class="targets" id="g-tg">${allies.map(p => `<button class="target ${p.status === 'down' ? 'down' : ''}" data-cls="${p.cls}" data-id="${p.id}"><div class="t-name">${esc(p.name)}</div><div class="bar hp" style="height:6px;margin-top:6px"><i style="width:${pct(p.hp, p.maxHp)}%"></i></div></button>`).join('')}</div>
            <button class="btn ghost" id="g-back">BACK</button>`;
        $('#g-tg').onclick = e => { const t = e.target.closest('.target'); if (t) doAct(S.ability, t.dataset.id); };
    }
    $('#g-back').onclick = () => { S.local = 'action'; S.lastKey = null; drawControls(); renderSquad(hostNow()); };
}

// Same formula as the rules engine, so the number pops the instant you click
// instead of waiting on the round trip to the projector.
function predictDamage(abKey) {
    const pub = S.me.pub, ab = CLASSES[pub.cls].abilities[abKey];
    if (ab.kind !== 'damage') return null;
    const b = S.live.boss, now = hostNow();
    const exposed = b && b.exposedUntil > now;
    let base = ab.power, crit = false, combo = null;
    if (abKey === 'ult' && ab.comboPower && exposed) { base = ab.comboPower; combo = 'SHATTER'; }
    else if (abKey === 'special' && exposed) { base *= 1.5; crit = true; }
    const syn = { ...(S.live.team?.syn || {}), [pub.cls]: now };
    const lvl = Math.max(1, Object.values(syn).filter(t => now - t <= 10000).length);
    const weak = b?.weak && b.weak.cls === pub.cls && b.weak.until > now ? b.weak.mult : 1;
    const resist = b?.eshield && b.eshield.cls !== pub.cls ? ESHIELD_LEAK : 1;
    const amount = Math.round(base * (1 + streakBonusPct(S.streak || 0, pub.cls) / 100) * SYNERGY_MULT[lvl] * (exposed ? 1 + (b.exposeBonus || 0) : 1) * weak * resist);
    return { amount, crit: crit || weak > 1, combo };
}

function doAct(ab, target, btn) {
    const c = CLASSES[S.me.pub.cls];
    sendIntent(S.code, S.pid, { t: 'x', ab, tg: target || null });
    const guess = predictDamage(ab);
    if (guess) {
        const legendary = !!guess.combo || guess.amount >= 8000;
        const t = damageNumber($('#dmg-layer'), guess.amount, { crit: guess.crit, legendary, label: guess.combo ? guess.combo + '!' : ab === 'ult' ? c.abilities.ult.name.toUpperCase() : '' });
        S.pred = { at: Date.now(), combo: guess.combo };
        if (S.bossR) S.bossR.hit(guess.amount, { crit: guess.crit || legendary || ab === 'ult' });
        Audio.sfxHit(guess.amount);
        if (t && (t.id === 'legendary' || t.id === 'epic')) edge(t.color);
    }
    if (ab === 'ult') { Audio.sfxUltimate(); flash(c.color, 0.35); edge(c.color); }
    if (target === S.pid && c.abilities[ab].kind === 'shield') S.lastShield = target;
    else if (c.abilities[ab].kind === 'shield') S.lastShield = target;
    S.local = 'feedback';
    // keep the move on screen for a beat instead of blanking the panel
    const grid = $('#g-act');
    if (grid && btn) { grid.classList.add('spent'); btn.classList.add('used'); }
    else $('#controls').innerHTML = `<div class="pick-prompt">${esc(c.abilities[ab].name.toUpperCase())}!</div>`;
    renderSquad(hostNow());
    setTimeout(() => { S.local = 'question'; S.lastKey = null; drawControls(); }, 600);
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
    S.counters ||= { shields: 0, heals: 0, revives: 0, exposes: 0, saves: 0 };
    switch (ev.type) {
        case 'hit': if (ev.pid === me) {
            const legendary = !!ev.combo || ev.amount >= 8000;
            const predicted = S.pred && Date.now() - S.pred.at < 3000;
            let t = null;
            if (!predicted) { t = damageNumber(layer, ev.amount, { crit: ev.crit, legendary, label: ev.combo ? ev.combo + '!' : ev.ability === 'ult' ? c.abilities.ult.name.toUpperCase() : '' }); Audio.sfxHit(ev.amount); if (S.bossR) S.bossR.hit(ev.amount, { crit: ev.crit || legendary }); }
            if (ev.combo && !(predicted && S.pred.combo)) damageNumber(layer, ev.amount, { legendary: true, label: ev.combo + '!' });
            S.pred = null;
            unlock('first_blood');
            if (ev.crit) unlock('crit');
            if (ev.amount >= 5000) unlock('heavy');
            if (ev.combo) { unlock('shatter'); slam(ev.combo + '!', { color: '#ff9d00', sub: fmtNum(ev.amount) + ' DAMAGE' }); edge('#ff9d00'); }
            if (legendary) unlock('legendary');
        } else if (S.bossR) S.bossR.hit(ev.amount, { crit: ev.crit || !!ev.combo });
            break;
        case 'ult': if (ev.pid === me) { slam(c.abilities.ult.name.toUpperCase() + '!', { color: c.color }); unlock('ult'); } break;
        case 'heal':
            if (ev.pid === me && ev.target !== me) { textPop(layer, `+${fmtNum(ev.amount)} HEALED`, '#2ed573', 2.4); if (++S.counters.heals >= 3) unlock('medic'); }
            if (ev.target === me) { textPop(layer, `+${fmtNum(ev.amount)} HP`, '#2ed573', 2.6); flash('#2ed573', 0.2); if (ev.pid !== me) toast(`${by(ev.pid)} healed you`); }
            break;
        case 'shield':
            if (ev.pid === me) { S.lastShield = ev.target; textPop(layer, '◆ SHIELD UP', '#7d95ff', 2.4); if (++S.counters.shields >= 5) unlock('bodyguard'); }
            if (ev.target === me && ev.pid !== me) { textPop(layer, '◆ SHIELDED', '#7d95ff', 2.6); toast(`${by(ev.pid)} shielded you`); }
            break;
        case 'shieldBlock':
            if (ev.pid === me) { textPop(layer, 'BLOCKED!', '#7d95ff', 2.8); Audio.sfxShield(); if (ev.by) toast(`${by(ev.by)}'s shield saved you!`); }
            if (ev.by === me && ev.pid !== me) {
                slam('CLUTCH SAVE!', { color: '#7d95ff', sub: `YOUR SHIELD BLOCKED ${fmtNum(ev.amount)} FOR ${by(ev.pid)}` });
                edge('#4a6cff'); Audio.sfxShield(); unlock('save');
                if (++S.counters.saves >= 3) unlock('save3');
            }
            break;
        case 'playerHit': if (ev.pid === me) { textPop(layer, `−${fmtNum(ev.amount)}`, '#ff4757', 3); flash('#ff2a3d', 0.4); edge('#ff2a3d'); shake($('#g')); navigator.vibrate && navigator.vibrate(150); } break;
        case 'selfDamage': if (ev.pid === me) textPop(layer, `−${fmtNum(ev.amount)}`, '#ff6b81', 1.6); break;
        case 'revive':
            if (ev.pid === me) { slam('BACK IN THE FIGHT!', { color: '#2ed573', sub: ev.by ? `REVIVED BY ${by(ev.by)}` : 'REBOOTED' }); flash('#2ed573', 0.4); edge('#2ed573'); unlock('comeback'); S.local = 'question'; S.q = null; S.lastKey = null; }
            if (ev.by === me && ev.pid !== me) { textPop(layer, 'REVIVED!', '#2ed573', 2.8); if (++S.counters.revives >= 1) unlock('revive1'); if (S.counters.revives >= 3) unlock('revive3'); }
            break;
        case 'down': if (ev.pid === me) { S.downThisBoss = true; S.streak = 0; slam("YOU'RE DOWN!", { color: '#ff4757', sub: 'ANSWER TO REBOOT, OR CALL A MEDIC' }); flash('#ff2a3d', 0.6); edge('#ff2a3d'); S.local = 'question'; S.q = null; S.lastKey = null; } break;
        case 'eliminated': if (ev.pid === me) { S.downThisBoss = true; slam('OUT OF LIVES', { color: '#9fd0ff', sub: 'YOUR ANSWERS NOW POWER THE TEAM RALLY' }); S.local = 'question'; S.lastKey = null; } break;
        case 'infected': if (ev.pid === me) toast('☣ You are infected! Ask a Medic for a heal'); break;
        case 'cured': if (ev.target === me) toast(`${by(ev.pid)} cured you`); break;
        case 'expose': if (ev.pid === me) { textPop(layer, 'EXPOSED!', CLASSES.TACTICIAN.color, 2.6); if (++S.counters.exposes >= 3) unlock('weakpoint'); } else if (pub.cls === 'WARRIOR') { slam('BOSS EXPOSED!', { color: CLASSES.TACTICIAN.color, sub: pub.ult >= 100 ? 'ULTIMATE NOW = SHATTER!' : 'STRIKE NOW!' }); } break;
        case 'interrupt': if (S.bossR) S.bossR.cancelWindUp(); if (ev.pid === me) { slam('INTERRUPTED!', { color: CLASSES.TACTICIAN.color, sub: 'YOU STOPPED THE ATTACK' }); unlock('interrupt'); } break;
        case 'roleCallProgress': if (ev.pid === me) { textPop(layer, 'CALL ANSWERED!', '#ffa502', 2.4); unlock('call'); } break;
        case 'roleCallSuccess':
            if (S.bossR) S.bossR.cancelWindUp();
            if (Object.values(ev.call?.who || {}).includes(me)) { slam('ATTACK STOPPED!', { color: '#2ed573', sub: `${fmtNum(ev.reflect)} REFLECTED BACK` }); edge('#2ed573'); Audio.sfxPuzzleSolve(); unlock('saver'); }
            else textPop(layer, 'ATTACK BLOCKED!', '#2ed573', 2);
            break;
        case 'windup': if (S.bossR) S.bossR.windUp(Math.max(500, ev.landsAt - hostNow())); break;
        case 'attack': if (S.bossR) S.bossR.release(); break;
        case 'domeBlock': if (S.bossR) S.bossR.release(); break;
        case 'bossDefeated': if (S.bossR) S.bossR.die(); break;
        case 'combo': if (ev.pid !== me) textPop(layer, `${ev.name}! (${by(ev.pid)})`, '#ff9d00', 2); break;
        case 'synergy': if (ev.level === 4) { slam('FULL SYNERGY', { color: '#c45cff', sub: 'ALL FOUR CLASSES · ×1.35 DAMAGE' }); edge('#c45cff'); if (pub.status === 'alive') unlock('synergy'); } break;
        case 'phase': slam(`BOSS ${ev.phase}!`, { color: ev.phase === 'DESPERATE' ? '#ff4757' : '#ffa502' }); break;
        case 'stagger': slam('STAGGERED!', { color: '#ffb020', sub: 'EVERY CLASS: HIT IT NOW FOR FULL SYNERGY' }); edge('#ffb020'); break;
        case 'bossBeat': slam('PHASE 2', { color: '#ff4757', sub: esc(ev.text || '') }); edge('#ff2a3d'); break;
        case 'lastStand': slam('LAST STAND!', { color: '#ff2a3d', sub: 'ULTIMATES CHARGED · EVERY CLASS MUST FIRE' }); edge('#ffb020'); navigator.vibrate && navigator.vibrate([200, 80, 200]); S.lastKey = null; break;
        case 'lastStandProgress': if (ev.pid === me) textPop(layer, '✔ YOUR CLASS FIRED!', '#ffb020', 2.8); break;
        case 'lastStandWon': slam('ANNIHILATION STOPPED!', { color: '#2ed573', sub: `${fmtNum(ev.amount)} DAMAGE · BOSS STUNNED` }); confetti(80); break;
        case 'lastStandFailed': slam('ANNIHILATION', { color: '#ff2a3d', sub: 'NOT EVERY CLASS FIRED IN TIME' }); flash('#ff2a3d', 0.6); shake($('#g')); break;
        case 'quarantine': if (ev.pid === me) { slam('QUARANTINED!', { color: '#7d95ff', sub: 'A SHIELD BLOCKED THE VIRUS' }); } else if (ev.by === me) { slam('QUARANTINE!', { color: '#7d95ff', sub: 'YOUR SHIELD STOPPED THE VIRUS' }); unlock('save'); } break;
        case 'weakShift': if (ev.cls === pub.cls && pub.status === 'alive') { slam('WEAK SPOT: YOU!', { color: CLASSES[pub.cls].color, sub: `${CLASSES[pub.cls].name.toUpperCase()}S DEAL ×${ev.mult} DAMAGE · ATTACK NOW` }); edge(CLASSES[pub.cls].color); Audio.sfxBuff(); S.lastKey = null; } break;
        case 'eshield': slam('ELEMENTAL SHIELD!', { color: CLASSES[ev.cls].color, sub: ev.cls === pub.cls ? `ONLY ${CLASSES[pub.cls].name.toUpperCase()}S CAN BREAK IT · THAT'S YOU!` : `ONLY ${CLASSES[ev.cls].name.toUpperCase()}S CAN BREAK IT · COVER THEM` }); edge(CLASSES[ev.cls].color); break;
        case 'eshieldBreak': slam('SHIELD SHATTERED!', { color: '#ffb020', sub: ev.pid === me ? 'YOU BROKE IT! EVERY CLASS: HIT IT NOW' : 'BOSS STAGGERED · EVERY CLASS: HIT IT NOW' }); edge('#ffb020'); if (ev.pid === me) confetti(60); break;
        case 'eshieldBurst': slam('SHIELD BURST', { color: '#ff2a3d', sub: 'IT WASN\'T BROKEN IN TIME' }); flash('#ff2a3d', 0.5); shake($('#g')); break;
        case 'ricochet':
            if (ev.by === me) { slam('RICOCHET!', { color: CLASSES.GUARDIAN.color, sub: `YOUR SHIELD BOUNCED THE SHOT · ${fmtNum(ev.amount)} DAMAGE` }); unlock('save'); }
            else if (ev.pid === me) slam('SHOT BLOCKED!', { color: CLASSES.GUARDIAN.color, sub: 'A SHIELD BOUNCED THE SNIPER MARK' });
            else textPop(layer, `RICOCHET ${fmtNum(ev.amount)}`, CLASSES.GUARDIAN.color, 2);
            break;
        case 'bossRepair': textPop(layer, `BOSS REPAIRED +${fmtNum(ev.amount)}`, '#2ed573', 2.4); break;
        case 'silenced': if (ev.pid === me) { slam('SILENCED!', { color: '#9fa8ff', sub: 'BASIC ATTACKS ONLY · ASK A MEDIC TO CLEANSE YOU' }); S.lastKey = null; } break;
        case 'overload': slam('SYSTEM OVERLOAD!', { color: '#7bed9f', sub: `${ev.infected} INFECTED · MEDICS, CURE THEM!` }); flash('#2ed573', 0.35); break;
        case 'chaos': {
            const t = { meteor: ['METEOR STRIKE!', '#ff4757', 'YOUR TEACHER CALLED IT IN'], drain: ['SHIELD DRAIN!', '#4a6cff', 'EVERY SHIELD IS GONE'], patient: ['PATIENT ZERO!', '#7bed9f', 'SOMEONE JUST GOT INFECTED'], silence: ['SILENCE!', '#9fa8ff', 'ONE CLASS JUST WENT QUIET'], strike: ['AIR STRIKE!', '#ffb020', 'TEACHER SUPPORT INBOUND'], rally: ['SUPPLY DROP!', '#ffb020', '+25% ULTIMATE FOR EVERYONE'] }[ev.kind];
            if (t) { slam(t[0], { color: t[1], sub: t[2] }); edge(t[1]); if (ev.kind === 'meteor' || ev.kind === 'drain') shake($('#g')); }
            break;
        }
        case 'teacherReward':
            if (ev.cls === pub.cls) { slam('TEACHER BONUS!', { color: '#ffb020', sub: `${CLASSES[ev.cls].name.toUpperCase()}S +35% ULTIMATE` }); edge('#ffb020'); confetti(40); }
            else textPop(layer, `TEACHER BONUS: ${CLASSES[ev.cls].name.toUpperCase()}S`, '#ffb020', 2);
            break;
        case 'enrage': slam('TIME\'S UP!', { color: '#ff4757', sub: 'THE BOSS IS ENRAGED · FINISH IT FAST' }); break;
        case 'enrageStack': slam('BOSS POWER RISING', { color: '#ff4757', sub: `IT NOW HITS FOR ${ev.dmg}% · FINISH IT!` }); edge('#ff2a3d'); break;
        case 'rally': slam('SPIRIT RALLY', { color: '#9fd0ff', sub: '+20% HP FOR EVERYONE' }); break;
        case 'wipe': slam('SQUAD WIPED', { color: '#ff4757' }); break;
        case 'hero': {
            const t = heroText(ev, id => S.room.players?.[id]?.pub?.name || '?');
            const color = heroColor(ev.kind);
            const crests = (ev.pids || []).map(id => S.room.players?.[id]?.pub?.cls).filter(Boolean).map(k => crest(k, { size: 90, glow: true })).join('');
            slam(`${crests ? `<div class="slam-crests">${crests}</div>` : ''}${esc(t.title)}`, { color, sub: esc(t.sub) });
            edge(color); confetti(50);
            if ((ev.pids || []).includes(me)) { unlock('hero'); Audio.sfxAchievement(); }
            break;
        }
        case 'puzzleReject': if (ev.pid === me) { toast(`Only ${CLASSES[ev.setter].name.toUpperCase()}S can enter slot ${ev.slot + 1}. Tell them!`); Audio.sfxWrong(); } break;
        case 'puzzleStrike':
            slam(ev.kind === 'vault' ? 'WRONG CODE!' : 'SURGE!', { color: '#ff4757', sub: `STRIKE ${ev.strikes} OF 3${ev.kind === 'reactor' ? ' · BACK TO STEP 1' : ''}` });
            flash('#ff2a3d', 0.4); edge('#ff2a3d'); shake($('#g')); Audio.sfxWrong();
            if (ev.pid === me) toast('That press was out of turn! Wait for your class to be called.');
            break;
        case 'reactorStep': if (ev.pid === me) { textPop(layer, '✓ STEP ' + ev.progress, '#ffd32a', 2.6); Audio.sfxCorrect(); } break;
        case 'reactorRound': slam('ROUND 2', { color: '#ffd32a', sub: 'A LONGER SEQUENCE' }); break;
        case 'vaultLocking': Audio.sfxCountdown(); break;
        case 'puzzleSolved': slam('SOLVED!', { color: '#2ed573' }); confetti(120); edge('#2ed573'); Audio.sfxPuzzleSolve(); unlock('puzzle'); break;
        case 'puzzleFailed': slam(ev.why === 'time' ? 'OUT OF TIME' : 'PUZZLE FAILED', { color: '#ff4757' }); edge('#ff2a3d'); Audio.sfxDefeat(); break;
        case 'rejected': if (ev.pid === me) { S.pred = null; toast({ 'no fight': 'Too late, that fight is over!', 'target is down': 'They went down. Pick someone else', 'target is out': 'They are out of lives', 'regrouping': 'Regrouping, hold on!' }[ev.reason] || 'That move didn\'t go through'); } break;
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
