// index.html: landing page (student join + teacher sign-in), dashboard and BattleSet editor.
//   #/            landing
//   #/dashboard   teacher's BattleSets
//   #/edit/<id>   BattleSet editor   (#/new for a fresh set)

import { auth, teacherAuth, dbGet } from './firebase.js';
import { mirrorSignIn, mirrorSignOut, darkZoneRoomExists } from './teacher/darkzone.js';
import { crest, CREST_NAMES } from './content/crests.js';
import { CLASSES, CLASS_IDS } from './content/classes.js';
import { esc } from './ui.js';

const view = document.getElementById('view');
let user = null;
let authKnown = false;

teacherAuth.onChange(u => {
    user = u;
    authKnown = true;
    renderNav();
    route();
});
window.addEventListener('hashchange', route);

async function route() {
    const h = location.hash || '#/';
    if (window.__rrEditorCleanup) { await window.__rrEditorCleanup(); window.__rrEditorCleanup = null; }
    if (h.startsWith('#/dashboard') || h.startsWith('#/edit') || h.startsWith('#/new')) {
        if (!authKnown) return;
        if (!user) { location.hash = '#/'; openAuth('signin'); return; }
        document.body.dataset.view = 'app';
        if (h.startsWith('#/dashboard')) (await import('./teacher/dashboard.js')).renderDashboard(view, user);
        else (await import('./teacher/editor.js')).renderEditor(view, user, h.startsWith('#/new') ? null : decodeURIComponent(h.slice('#/edit/'.length)));
        return;
    }
    document.body.dataset.view = 'landing';
    renderLanding();
}

// ================================================================= nav

function renderNav() {
    const nav = document.getElementById('nav-right');
    nav.innerHTML = user
        ? `<a class="nav-link" href="#/dashboard">MY BATTLESETS</a><button class="btn ghost sm" id="nav-out">SIGN OUT</button>`
        : `<button class="btn primary sm" id="nav-in">TEACHER SIGN IN</button>`;
    const out = document.getElementById('nav-out');
    if (out) out.onclick = async () => { await teacherAuth.signOut(); await mirrorSignOut(); location.hash = '#/'; };
    const inn = document.getElementById('nav-in');
    if (inn) inn.onclick = () => openAuth('signin');
}

// ================================================================= landing

function renderLanding() {
    view.innerHTML = `
    <section class="l-hero">
        <div class="l-hero-copy">
            <div class="l-kicker">THE CLASSROOM RAID</div>
            <h1 class="l-title">REVIEW DAY,<br><span>BOSS FIGHT.</span></h1>
            <p class="l-sub">Your class picks Warriors, Guardians, Medics and Tacticians, answers review questions to power their moves, and takes down giant bosses <b>together</b>. Built by a teacher. Free for teachers.</p>
            <div class="l-join panel" id="join">
                <div class="label">STUDENTS: JOIN A RAID</div>
                <div class="l-join-row">
                    <input class="field code" id="j-code" inputmode="numeric" maxlength="6" placeholder="CODE">
                    <input class="field" id="j-name" maxlength="16" placeholder="Your name">
                    <button class="btn gold big" id="j-go">JOIN</button>
                </div>
                <div class="l-err" id="j-err"></div>
            </div>
            <div class="l-teacher">${user
                ? `<a class="btn primary big" href="#/dashboard">GO TO MY BATTLESETS →</a>`
                : `<button class="btn primary big" id="l-signup">I'M A TEACHER: START FREE</button><button class="btn ghost big" id="l-signin">SIGN IN</button>`}</div>
        </div>
        <div class="l-hero-art">
            <canvas id="l-boss"></canvas>
            <div class="l-crests">${CLASS_IDS.map(c => crest(c, { size: 74, glow: true })).join('')}</div>
        </div>
    </section>

    <section class="l-section">
        <div class="l-h2">FOUR CLASSES. ONE SQUAD.</div>
        <div class="l-classes">${CLASS_IDS.map(id => `
            <div class="l-class" data-cls="${id}">${crest(id, { size: 96, glow: true })}
                <div class="l-class-name">${CLASSES[id].name.toUpperCase()}</div>
                <div class="label">${CLASSES[id].role} · ${CREST_NAMES[id]}</div>
                <p>${esc({ WARRIOR: 'Biggest hits in the raid. Lines up SHATTER combos with the Tacticians.', GUARDIAN: 'Sees who the boss is about to hit and shields them in time.', MEDIC: 'Watches everyone\'s vitals, heals the lowest, and revives the fallen.', TACTICIAN: 'Sees the boss\'s next move first and Exposes it so everyone hits harder.' }[id])}</p>
            </div>`).join('')}</div>
    </section>

    <section class="l-section">
        <div class="l-h2">HOW A RAID WORKS</div>
        <div class="l-steps">
            ${[['1', 'Pick a BattleSet', 'Type questions, paste a list, or import a Quizlet or spreadsheet in seconds.'],
               ['2', 'Students join', 'They enter the code on their Chromebooks and lock in a class.'],
               ['3', 'Answer to attack', 'Every right answer powers a move. Wrong answers show the right one.'],
               ['4', 'Talk to win', 'Bosses call on classes by name. Squads that communicate win.']]
                .map(([n, t, d]) => `<div class="l-step"><div class="l-step-n">${n}</div><div class="l-step-t">${t}</div><p>${d}</p></div>`).join('')}
        </div>
    </section>

    <section class="l-section l-two">
        <div class="panel"><div class="l-h3">★ HERO MOMENTS</div><p>When a Medic's Field Hospital saves a squad on the brink, or a Tactician sets up a Warrior's SHATTER, the whole room sees it on the projector.</p></div>
        <div class="panel"><div class="l-h3">📋 KNOW WHAT TO RETEACH</div><p>Every raid ends with the most-missed questions and the wrong answer students picked most, plus a one-click re-raid of just those.</p></div>
    </section>
    <footer class="l-foot">RAID REVIEW · Built by a teacher, for teachers</footer>`;

    const go = () => joinRaid();
    document.getElementById('j-go').onclick = go;
    document.getElementById('j-name').onkeydown = e => { if (e.key === 'Enter') go(); };
    document.getElementById('j-code').onkeydown = e => { if (e.key === 'Enter') document.getElementById('j-name').focus(); };
    const su = document.getElementById('l-signup'); if (su) su.onclick = () => openAuth('signup');
    const si = document.getElementById('l-signin'); if (si) si.onclick = () => openAuth('signin');
    if (window.BossRenderer) {
        const b = window.BossRenderer.create(document.getElementById('l-boss'), 'omega', { maxDpr: 1.5 });
        b.intro(1600);
        const cycle = setInterval(() => { if (!document.getElementById('l-boss')) { clearInterval(cycle); b.destroy(); return; } b.windUp(2200); setTimeout(() => b.release(), 2200); }, 7000);
    }
}

async function joinRaid() {
    const code = document.getElementById('j-code').value.trim();
    const name = document.getElementById('j-name').value.trim().replace(/[<>]/g, '').slice(0, 16);
    const err = document.getElementById('j-err');
    if (!/^\d{6}$/.test(code)) return (err.textContent = 'The code is the 6 digits on the projector.');
    if (!name) return (err.textContent = 'Type your name.');
    err.textContent = 'Finding your raid…';
    const room = await dbGet(`games/${code}`).catch(() => null);
    const q = `?room=${code}&name=${encodeURIComponent(name)}`;
    if (room && room.v === 2) return (location.href = 'play.html' + q);
    if (room) return (location.href = `../play.html?name=${encodeURIComponent(name)}&room=${code}`);
    if (await darkZoneRoomExists(code)) return (location.href = `../darkzone.html?name=${encodeURIComponent(name)}&room=${code}`);
    err.textContent = 'No raid with that code. Check the projector!';
}

// ================================================================= teacher sign in

function openAuth(mode) {
    const m = document.getElementById('auth');
    const titles = { signin: 'WELCOME BACK', signup: 'CREATE YOUR FREE ACCOUNT', reset: 'RESET YOUR PASSWORD' };
    m.innerHTML = `<div class="modal-box">
        <button class="modal-x" id="a-x">×</button>
        <div class="row" style="justify-content:center;gap:6px;margin-bottom:10px">${CLASS_IDS.map(c => crest(c, { size: 34 })).join('')}</div>
        <div class="modal-title">${titles[mode]}</div>
        <div class="stack">
            <input class="field" id="a-email" type="email" placeholder="School email" autocomplete="email">
            ${mode !== 'reset' ? `<input class="field" id="a-pw" type="password" placeholder="Password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}">` : ''}
            ${mode === 'signup' ? `<input class="field" id="a-pw2" type="password" placeholder="Confirm password" autocomplete="new-password">` : ''}
            <div class="l-err" id="a-err"></div>
            <button class="btn primary big" id="a-go">${{ signin: 'SIGN IN', signup: 'CREATE ACCOUNT', reset: 'SEND RESET LINK' }[mode]}</button>
            <div class="modal-links">${mode === 'signin' ? '<button data-m="signup">New here? Create an account</button><button data-m="reset">Forgot password?</button>' : '<button data-m="signin">Back to sign in</button>'}</div>
        </div></div>`;
    m.hidden = false;
    const email = document.getElementById('a-email');
    email.focus();
    const err = document.getElementById('a-err');
    const close = () => { m.hidden = true; };
    document.getElementById('a-x').onclick = close;
    m.onclick = e => { if (e.target === m) close(); };
    m.querySelectorAll('[data-m]').forEach(b => b.onclick = () => openAuth(b.dataset.m));
    const submit = async () => {
        const e = email.value.trim(), pw = document.getElementById('a-pw')?.value || '';
        err.style.color = '';
        if (!e) return (err.textContent = 'Enter your email.');
        const btn = document.getElementById('a-go');
        btn.disabled = true;
        try {
            if (mode === 'reset') { await teacherAuth.reset(e); err.style.color = '#2ed573'; err.textContent = 'Check your email for a reset link.'; btn.disabled = false; return; }
            if (mode === 'signup') {
                if (pw.length < 6) throw { code: 'auth/weak-password' };
                if (pw !== document.getElementById('a-pw2').value) throw { message: 'Passwords don\'t match.' };
                await teacherAuth.signUp(e, pw);
            } else await teacherAuth.signIn(e, pw);
            mirrorSignIn(e, pw);
            close();
            location.hash = '#/dashboard';
        } catch (x) {
            btn.disabled = false;
            err.textContent = ({
                'auth/invalid-email': 'That email doesn\'t look right.',
                'auth/user-not-found': 'No account with that email. Create one?',
                'auth/wrong-password': 'Wrong password.',
                'auth/invalid-credential': 'Email or password is wrong.',
                'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
                'auth/weak-password': 'Use at least 6 characters.',
                'auth/too-many-requests': 'Too many tries. Wait a minute and try again.'
            })[x.code] || x.message || 'Something went wrong. Try again.';
        }
    };
    document.getElementById('a-go').onclick = submit;
    m.querySelectorAll('input').forEach(i => i.onkeydown = ev => { if (ev.key === 'Enter') submit(); });
}

// Keep the session around for debugging
window.__rrSite = { get user() { return user; }, auth };
