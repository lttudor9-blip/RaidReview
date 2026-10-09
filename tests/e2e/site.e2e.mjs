// Teacher site (next/index.html): landing, dashboard, editor, bulk add, preview, launch.
// Run: node tests/e2e/site.e2e.mjs   (screenshots in tests/e2e/out/)

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (ok, msg) => { if (!ok) { errors.push('CHECK FAILED: ' + msg); } else console.log('  ✓ ' + msg); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined) });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
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
    return route.abort();
});
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text().slice(0, 300)); });
page.on('dialog', d => d.accept());
const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });

// landing, signed out
await page.goto('http://raid.test/next/index.html');
await page.waitForSelector('.l-hero');
await sleep(1800);
await shot('site-landing');
check(await page.isVisible('#nav-in'), 'landing shows teacher sign in');
await page.fill('#j-code', '12');
await page.click('#j-go');
check((await page.textContent('#j-err')).includes('6 digits'), 'join validates the code');
await page.click('#l-signin');
await page.waitForSelector('#a-email');
await shot('site-signin');

// signed in
await page.evaluate(() => localStorage.setItem('mock_teacher', '1'));
await page.goto('about:blank');
await page.goto('http://raid.test/next/index.html#/dashboard');
await page.waitForSelector('.set-card');
await sleep(300);
check(await page.isVisible('.set-card.new'), 'dashboard shows the new set card');
await shot('site-dashboard-empty');

// new set: type a question
await page.click('.set-card.new');
await page.waitForSelector('#e-title');
await page.fill('#e-title', 'Unit 4: Ancient Egypt');
await page.fill('#e-subject', 'Social Studies');
await page.fill('#q-text', 'Which river was essential to Ancient Egypt?');
for (const [k, v] of [[0, 'Nile'], [1, 'Amazon'], [2, 'Tigris']]) await page.fill(`.qe-input[data-k="${k}"]`, v);
await page.click('.qe-input[data-k="2"]');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter'); // last box -> new question
await page.waitForFunction(() => document.querySelectorAll('.ed-card').length === 2);
check(true, 'Enter on the last answer adds a question');
await page.fill('#q-text', 'Who was the boy pharaoh?');
await page.fill('.qe-input[data-k="0"]', 'Ramses II');
await page.fill('.qe-input[data-k="1"]', 'Tutankhamun');
await page.click('[data-mark="1"]');
await sleep(1300);
check((await page.textContent('#e-status')).includes('saved'), 'editor autosaves');
await shot('site-editor');

// bulk add
await page.click('#e-bulk');
await page.waitForSelector('#b-text');
await page.click('[data-ex="pairs"]');
await sleep(300);
await shot('site-bulk-pairs');
await page.click('[data-ex="raid"]');
await sleep(300);
check((await page.textContent('#b-add')).includes('ADD 3'), 'bulk add reads the example');
await shot('site-bulk');
await page.click('#b-add');
await page.waitForFunction(() => document.querySelectorAll('.ed-card').length === 5);
check(true, 'bulk add appended 3 questions');

// preview
await page.click('#e-preview');
await page.waitForSelector('.sg-lite');
await page.click('.pv-cls[data-c="MEDIC"]');
await page.click('.sg-lite [data-k="1"]');
await sleep(300);
check(await page.isVisible('.sg-lite .answer.right'), 'preview reveals the right answer');
await shot('site-preview');
await page.click('#p-x');

// saved to the database without blank answers
await page.evaluate(() => window.__rrEditorCleanup && window.__rrEditorCleanup());
await sleep(300);
await page.click('a[href="#/dashboard"].btn');
await page.waitForSelector('.set-card .set-title');
await sleep(400);
const titles = await page.$$eval('.set-card .set-title', els => els.map(e => e.textContent));
check(titles.includes('Unit 4: Ancient Egypt'), 'set appears on the dashboard');
const stored = await page.evaluate(async () => {
    const { dbGet } = await import('/next/js/firebase.js');
    return Object.values(await dbGet('battleSets/teacher1'))[0];
});
check(stored.questions[0].answers.length === 3 && stored.questions[1].answers[stored.questions[1].correct] === 'Tutankhamun', 'blank answers dropped, right answer kept');
await shot('site-dashboard');

// launch goes straight to the raid lobby
await page.click('.set-card [data-act="launch"]');
await page.waitForURL(/play\.html\?host=1/);
const launched = await page.evaluate(() => JSON.parse(localStorage.getItem('rr_launch_questions')).length);
check(launched === 5, 'launch hands 5 questions to the game');

await browser.close();
if (errors.length) { console.log('\nERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nSite e2e passed');
