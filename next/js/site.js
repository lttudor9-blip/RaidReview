// index.html: landing page (student join + teacher sign-in), dashboard and BattleSet editor.
//   #/            landing
//   #/dashboard   teacher's BattleSets
//   #/edit/<id>   BattleSet editor   (#/new for a fresh set)

import { auth, teacherAuth, dbGet } from './firebase.js';
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
    if (out) out.onclick = async () => { await teacherAuth.signOut(); location.hash = '#/'; };
    const inn = document.getElementById('nav-in');
    if (inn) inn.onclick = () => openAuth('signin');
}

// ================================================================= landing

// The squad formation: four crests linked to a synergy core (hero art)
function squadArt() {
    const pos = { WARRIOR: [50, 12], GUARDIAN: [88, 50], MEDIC: [50, 88], TACTICIAN: [12, 50] };
    const lines = CLASS_IDS.map(c => `<line x1="${pos[c][0]}" y1="${pos[c][1]}" x2="50" y2="50" stroke="${CLASSES[c].color}" />`).join('');
    const ring = CLASS_IDS.map((c, i) => { const n = CLASS_IDS[(i + 1) % 4]; return `<line x1="${pos[c][0]}" y1="${pos[c][1]}" x2="${pos[n][0]}" y2="${pos[n][1]}" stroke="${CLASSES[c].color}" />`; }).join('');
    return `<div class="squad-art" aria-hidden="true">
        <svg class="sa-lines" viewBox="0 0 100 100" preserveAspectRatio="none"><g class="sa-ring">${ring}</g><g class="sa-spokes">${lines}</g></svg>
        <div class="sa-orbit"></div><div class="sa-orbit two"></div>
        <div class="sa-core"><div class="sa-mult">×1.35</div><div class="sa-label">SQUAD SYNERGY</div></div>
        ${CLASS_IDS.map(c => `<div class="sa-node" data-cls="${c}" style="left:${pos[c][0]}%;top:${pos[c][1]}%">${crest(c, { size: 96, glow: true })}<div class="sa-name">${CLASSES[c].name.toUpperCase()}</div><div class="sa-role">${CLASSES[c].role.toUpperCase()}</div></div>`).join('')}
    </div>`;
}

const shotFig = (src, alt, caption, cls = '') => `<figure class="shot ${cls}"><img src="img/${src}" alt="${esc(alt)}"><figcaption>${caption}</figcaption></figure>`;

function renderLanding() {
    view.innerHTML = `
    <section class="l-hero">
        <div class="l-hero-copy">
            <div class="l-kicker">THE CO-OP REVIEW GAME</div>
            <h1 class="l-title"><span class="l-t1">STUDY FOR THE TEST.</span><br><span class="l-t2">FIGHT FOR THE SQUAD.</span></h1>
            <p class="l-sub">Raid Review turns review day into a boss raid. The whole class is one team, every right answer powers an attack, and the only way to win is <b>together</b>.</p>
            <div class="l-teacher">${user
                ? `<a class="btn gold big" href="#/dashboard">GO TO MY BATTLESETS →</a>`
                : `<button class="btn gold big" id="l-signup">TEACHERS: START FREE</button><button class="btn ghost big" id="l-signin">SIGN IN</button>`}</div>
            <div class="l-join" id="join">
                <div class="label">STUDENTS: JOIN A RAID</div>
                <div class="l-join-row">
                    <input class="field code" id="j-code" inputmode="numeric" maxlength="6" placeholder="CODE" aria-label="Room code">
                    <input class="field" id="j-name" maxlength="16" placeholder="Your name" aria-label="Your name">
                    <button class="btn primary" id="j-go">JOIN</button>
                </div>
                <div class="l-err" id="j-err"></div>
            </div>
        </div>
        <div class="l-hero-art">${squadArt()}</div>
    </section>

    <div class="l-facts">${['Built for Chromebooks', 'No student accounts', 'Call signs, never real names', 'Free for teachers'].map(t => `<span>◆ ${t}</span>`).join('')}</div>

    <section class="l-section">
        <div class="l-kick2">HOW IT'S DIFFERENT</div>
        <h2 class="l-h2">NOT ANOTHER RACE TO THE BUZZER</h2>
        <p class="l-lead">In most review games, students race each other and the fastest few win. In Raid Review the class races the boss, and every student has a job only they can do.</p>
        <div class="vs">
            <div class="vs-head"><span></span><span class="vs-them">TYPICAL QUIZ GAME</span><span class="vs-us">RAID REVIEW</span></div>
            ${[
                ['Who wins', 'The fastest few kids', 'The whole class, or nobody'],
                ['A wrong answer', 'You drop down the leaderboard', 'You see the right answer, and your squad covers for you'],
                ['Quiet students', 'Check out once they fall behind', 'Heal, shield and set up combos the team can\'t win without'],
                ['Talking', 'Gets in the way', 'Is the strategy'],
                ['Afterwards', 'A podium', 'A list of the questions your class missed most, ready to reteach']
            ].map(([k, a, b]) => `<div class="vs-row"><span class="vs-k">${k}</span><span class="vs-them">${a}</span><span class="vs-us">${b}</span></div>`).join('')}
        </div>
    </section>

    <section class="l-section">
        <div class="l-kick2">SEE IT IN ACTION</div>
        <h2 class="l-h2">ONE BOSS. ONE CLASS. EVERY CHROMEBOOK MATTERS.</h2>
        <div class="shots">
            ${shotFig('projector-rolecall.webp', 'Projector during a boss fight, calling on the Guardians', '<b>The projector.</b> The whole class fights one boss. Before a big attack it calls a class by name, and they have seconds to answer.', 'wide')}
            ${shotFig('chromebook-warrior.webp', 'A Warrior student\'s Chromebook mid-fight', '<b>Every Chromebook.</b> Answer the question to power your next move. Each class\'s screen looks and plays differently.')}
            ${shotFig('projector-hero.webp', 'A hero moment on the projector', '<b>Hero moments.</b> Clutch saves, perfect combos and flawless kills go up on the big screen.')}
        </div>
    </section>

    <section class="l-section">
        <div class="l-kick2">FOUR CLASSES</div>
        <h2 class="l-h2">EVERYONE HAS A JOB</h2>
        <div class="l-classes">${CLASS_IDS.map(id => `
            <div class="l-class" data-cls="${id}">${crest(id, { size: 72, glow: true })}
                <div class="l-class-name">${CLASSES[id].name.toUpperCase()}</div>
                <div class="label">${CLASSES[id].role}</div>
                <p>${esc({ WARRIOR: 'Biggest hits in the raid. Lines up SHATTER combos with the Tacticians.', GUARDIAN: 'Sees who the boss is about to hit and shields them in time.', MEDIC: 'Watches everyone\'s health, heals the lowest, and revives the fallen.', TACTICIAN: 'Sees the boss\'s next move first and exposes it so everyone hits harder.' }[id])}</p>
            </div>`).join('')}</div>
    </section>

    <section class="l-section l-puzzles">
        <div class="l-kick2">RAID PUZZLES</div>
        <h2 class="l-h2">NOBODY SOLVES THEM ALONE</h2>
        <p class="l-lead">Between bosses the class hits a puzzle. Each class holds one piece of the answer on its own Chromebook, so the room has to talk to get through.</p>
        <div class="pz-cards">
            <div class="pz-card">
                ${shotFig('puzzle-vault.webp', 'The Vault puzzle on the projector', '')}
                <div class="pz-body"><div class="pz-name">THE VAULT</div>
                <p>A four-symbol code. Every class gets the clue for a slot that <b>another</b> class has to enter, and the clues point at a symbol wall on the projector. Students shout across the room to crack it. Three wrong codes trip the alarm.</p></div>
            </div>
            <div class="pz-card">
                ${shotFig('puzzle-reactor.webp', 'The Reactor Core puzzle on a Tactician\'s Chromebook', '')}
                <div class="pz-body"><div class="pz-name">REACTOR CORE</div>
                <p>Only the Tacticians can see the order the classes must press in. Everyone else has one big button and has to listen. One press out of turn surges the core and resets the round.</p></div>
            </div>
        </div>
        <div class="stakes">
            <div class="ok"><b>SOLVE IT</b><span>Full heal and a power-up for the next boss.</span></div>
            <div class="bad"><b>FAIL IT</b><span>No heal, and the next boss gets tougher. Every choice carries forward.</span></div>
        </div>
    </section>

    <section class="l-section">
        <div class="l-kick2">FOR TEACHERS</div>
        <h2 class="l-h2">SET UP IN MINUTES. LEARN FROM EVERY RAID.</h2>
        <div class="l-teach">
            <div class="panel teach-report">${shotFig('reteach-report.webp', 'End-of-raid report with the most missed questions', '<b>Know what to reteach.</b> Every raid ends with the questions your class missed most and the wrong answer they picked, plus a one-click re-raid of just those.')}</div>
            <div class="teach-list">
                ${[
                    ['Bring your own questions', 'Type them, paste a list, or import from Quizlet, Google Sheets or Excel.'],
                    ['Three difficulty levels', 'Elementary for a new class or tough material, Regular for a real raid, Heroic for veterans.'],
                    ['Private by default', 'Students join with a code. Everyone gets a call sign on screen, never their real name.'],
                    ['You run the room', 'Pause any time, lock the room, and call in an air strike if a squad needs a hand.']
                ].map(([t, d]) => `<div class="teach-item"><div class="ti-t">${t}</div><p>${d}</p></div>`).join('')}
            </div>
        </div>
    </section>

    <section class="l-final">
        <h2 class="l-h2">YOUR NEXT REVIEW DAY IS A RAID.</h2>
        ${user ? `<a class="btn gold big" href="#/dashboard">GO TO MY BATTLESETS →</a>` : `<button class="btn gold big" id="l-signup2">START FREE</button>`}
    </section>
    <footer class="l-foot">RAID REVIEW · Built by a teacher, for teachers</footer>`;

    const go = () => joinRaid();
    document.getElementById('j-go').onclick = go;
    document.getElementById('j-name').onkeydown = e => { if (e.key === 'Enter') go(); };
    document.getElementById('j-code').onkeydown = e => { if (e.key === 'Enter') document.getElementById('j-name').focus(); };
    for (const id of ['l-signup', 'l-signup2']) { const b = document.getElementById(id); if (b) b.onclick = () => openAuth('signup'); }
    const si = document.getElementById('l-signin'); if (si) si.onclick = () => openAuth('signin');
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
