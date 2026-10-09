// End-to-end: the new game (next/) with a real host and four bot students in
// headless Chromium. Firebase is replaced by an in-memory mock shared between
// tabs (mock-*.js), so nothing touches the real database.
//
// Run: npm run e2e        (screenshots land in tests/e2e/out/)
// Env: CHROMIUM=/path/to/chrome to use a specific browser binary.

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const QUESTIONS = [
    { text: 'What is 2 + 2?', answers: ['3', '4', '5', '6'], correct: 1, type: 'mc' },
    { text: 'Capital of France?', answers: ['Paris', 'Rome', 'Madrid', 'Berlin'], correct: 0, type: 'mc' },
    { text: 'The sun is a star.', answers: ['True', 'False'], correct: 0, type: 'tf' },
    { text: 'Largest planet?', answers: ['Mars', 'Venus', 'Earth', 'Jupiter'], correct: 3, type: 'mc' },
    { text: 'Water freezes at 100°C.', answers: ['True', 'False'], correct: 1, type: 'tf' }
];
const CLASSES = ['WARRIOR', 'GUARDIAN', 'MEDIC', 'TACTICIAN'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined) });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'raid.test') {
        const f = path.join(ROOT, decodeURIComponent(u.pathname));
        return fs.existsSync(f) && fs.statSync(f).isFile() ? route.fulfill({ path: f }) : route.fulfill({ status: 404, body: 'not found' });
    }
    if (u.hostname === 'www.gstatic.com') {
        const m = u.pathname.endsWith('firebase-app.js') ? 'mock-app.js' : u.pathname.endsWith('firebase-auth.js') ? 'mock-auth.js' : 'mock-db.js';
        return route.fulfill({ path: path.join(HERE, m), contentType: 'application/javascript' });
    }
    return route.abort(); // fonts etc.
});
const watch = (page, name) => {
    page.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(`[${name}] ${m.text().slice(0, 300)}`); });
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

// ---- host ----
const host = await ctx.newPage(); watch(host, 'host');
await host.addInitScript(q => { if (location.search.includes('host=1')) { localStorage.setItem('rr_launch_questions', q); localStorage.setItem('rr_launch_set_title', 'E2E Check'); } }, JSON.stringify(QUESTIONS));
await host.goto('http://raid.test/next/play.html?host=1');
await host.waitForSelector('#join-code', { timeout: 15000 });
const code = (await host.textContent('#join-code')).trim();
console.log('room', code);

// ---- students ----
const phone = { width: 400, height: 820 };
const students = [];
for (let i = 0; i < 4; i++) {
    const p = await ctx.newPage({ viewport: phone }); watch(p, CLASSES[i]);
    await p.setViewportSize(phone);
    await p.goto(`http://raid.test/next/play.html?room=${code}&name=Bot${i + 1}`);
    await p.waitForSelector('.class-card', { timeout: 10000 });
    if (i === 0) await shot(p, 's01_class_select');
    await p.click(`[data-pick="${CLASSES[i]}"]`);
    await p.waitForSelector('#t-skip', { timeout: 10000 });
    if (i === 0) {
        await shot(p, 's02_tutorial');
        await p.click('#t-ans [data-i="1"]'); await sleep(800);
        await shot(p, 's03_tutorial_actions');
    }
    await p.click('#t-skip');
    students.push(p);
}
await sleep(800);
await shot(host, 'h01_lobby');

// quick format so the run is short
await host.click('#seg-format [data-v="quick"]');
await host.click('#btn-start');
await sleep(2500);
await shot(host, 'h02_boss_intro');
await host.waitForSelector('#boss-canvas', { timeout: 15000 });
await sleep(1500);

// ---- bots play ----
const known = Object.fromEntries(QUESTIONS.map(q => [q.text, q.answers[q.correct]]));
async function botStep(p, accuracy) {
    return p.evaluate(({ known, accuracy }) => {
        const q = document.querySelector('.question');
        const ans = [...document.querySelectorAll('#g-ans .answer')];
        if (q && ans.length && !document.querySelector('#g-ans.locked') && !document.querySelector('#g-ans.arming')) {
            const right = ans.find(a => a.textContent === known[q.textContent]);
            const choice = Math.random() < accuracy ? right : ans.find(a => a !== right);
            (choice || ans[0]).click();
            return 'answer';
        }
        const acts = [...document.querySelectorAll('#g-act .action')].filter(a => !a.disabled);
        if (acts.length) {
            const pick = acts.find(a => a.classList.contains('called')) || acts.find(a => a.dataset.ab === 'ult') || acts.find(a => a.dataset.ab === 'special') || acts[0];
            pick.click();
            return 'act:' + pick.dataset.ab;
        }
        const t = document.querySelector('#g-tg .target');
        if (t) { t.click(); return 'target'; }
        return 'idle';
    }, { known, accuracy });
}

const t0 = Date.now();
let shots = { rolecall: false, stuAction: false, stuCall: false, fight: false };
const counts = {};
while (Date.now() - t0 < 6 * 60000) {
    for (const [i, p] of students.entries()) {
        const r = await botStep(p, 0.8).catch(() => 'err');
        counts[r] = (counts[r] || 0) + 1;
        if (!shots.stuAction && r === 'answer' && i === 0) { await sleep(700); if (await p.$('#g-act')) { await shot(p, 's04_actions'); shots.stuAction = true; } }
    }
    const state = await host.evaluate(() => { const H = window.__rrHost; return { stage: H.stage, ended: H.ended, boss: H.engine.boss && { hp: H.engine.boss.hp, max: H.engine.boss.maxHp, call: !!H.engine.boss.attack?.call } }; });
    if (state.ended) break;
    if (!shots.fight && state.stage?.phase === 'fight') { await sleep(400); await shot(host, 'h03_fight'); shots.fight = true; }
    if (state.boss?.call && !shots.rolecall) { await shot(host, 'h04_rolecall'); shots.rolecall = true; }
    if (state.boss?.call && !shots.stuCall) {
        for (const [i, p] of students.entries()) if (await p.$('.callout.mine')) { await shot(p, `s05_rolecall_${CLASSES[i]}`); shots.stuCall = true; break; }
    }
    // keep the run short: once each fight has shown a role call, speed the boss toward defeat
    if (state.stage?.phase === 'fight' && shots.rolecall && state.boss && state.boss.hp > state.boss.max * 0.05) {
        await host.evaluate(() => { const b = window.__rrHost.engine.boss; b.hp = Math.max(1, b.hp - b.maxHp * 0.04); });
    }
    await sleep(350);
}
await sleep(1500);
await shot(host, 'h05_results');
await shot(students[0], 's06_end');

const final = await host.evaluate(() => { const H = window.__rrHost; const f = H.feed.join('\n'); return { events: H.counts, secs: Math.round((Date.now() - performance.timeOrigin) / 1000), ended: H.ended, status: H.engine.status, stageIdx: H.stageIdx, players: Object.values(H.engine.players).map(p => ({ cls: p.cls, ...p.stats })) }; });
console.log('bot actions:', JSON.stringify(counts));
console.log('final:', JSON.stringify(final));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(final.ended && !errors.length ? 0 : 1);
