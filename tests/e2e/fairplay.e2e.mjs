// Fair play + reconnects, end to end (mock Firebase, headless Chromium):
//   - the answer key never reaches a Chromebook; the projector checks answers
//   - a Chromebook that drops mid-raid keeps its character and gets back in
//     (same tab, a new tab, or a different Chromebook by typing the same name)
//   - an answer-spamming script is rate limited and flagged for the teacher
//   - junk intents are ignored, and a bot join flood locks the lobby
//
// Run: npm run e2e:fairplay

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const QUESTIONS = [
    { text: 'What is 2 + 2?', answers: ['3', '4', '5', '6'], correct: 1, type: 'mc' },
    { text: 'Capital of France?', answers: ['Paris', 'Rome', 'Madrid', 'Berlin'], correct: 0, type: 'mc' },
    { text: 'The sun is a star.', answers: ['True', 'False'], correct: 0, type: 'tf' }
];
const known = Object.fromEntries(QUESTIONS.map(q => [q.text, q.answers[q.correct]]));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined) });
const route = async r => {
    const u = new URL(r.request().url());
    if (u.hostname === 'raid.test') {
        const f = path.join(ROOT, decodeURIComponent(u.pathname));
        return fs.existsSync(f) && fs.statSync(f).isFile() ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: 'not found' });
    }
    if (u.hostname === 'www.gstatic.com') {
        const m = u.pathname.endsWith('firebase-app.js') ? 'mock-app.js' : u.pathname.endsWith('firebase-auth.js') ? 'mock-auth.js' : 'mock-db.js';
        return r.fulfill({ path: path.join(HERE, m), contentType: 'application/javascript' });
    }
    return r.abort();
};
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await ctx.route('**/*', route);
const errors = [];
const watch = (page, name) => page.on('pageerror', e => errors.push(`[${name}] ${e.message}`));

// Each simulated student is its own Chromebook: the saved player id lives in
// a per-device slot (real Chromebooks each have their own storage)
const asDevice = (page, device) => page.addInitScript(d => {
    const get = Storage.prototype.getItem, put = Storage.prototype.setItem;
    const k = key => (String(key).startsWith('rr2_pid_') ? `${d}:${key}` : key);
    Storage.prototype.getItem = function (key) { return get.call(this, k(key)); };
    Storage.prototype.setItem = function (key, v) { return put.call(this, k(key), v); };
}, device);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };

const host = await ctx.newPage(); watch(host, 'host');
await host.addInitScript(q => { if (location.search.includes('host=1')) { localStorage.setItem('rr_launch_questions', q); localStorage.setItem('rr_launch_set_title', 'Fair play'); } }, JSON.stringify(QUESTIONS));
await host.goto('http://raid.test/next/play.html?host=1');
await host.waitForSelector('#join-code', { timeout: 15000 });
const code = (await host.textContent('#join-code')).trim();
const H = (fn, arg) => host.evaluate(fn, arg);

async function joinAs(page, name, cls) {
    await page.goto(`http://raid.test/next/play.html?room=${code}&name=${encodeURIComponent(name)}`);
    if (cls) {
        await page.waitForSelector('.hs-card', { timeout: 10000 });
        await page.click(`[data-pick="${cls}"]`);
        await page.click('#hs-lock');
        await page.waitForSelector('#t-skip', { timeout: 10000 });
        await page.click('#t-skip');
    }
}
const pidOf = page => page.evaluate(c => localStorage.getItem(`rr2_pid_${c}`), code);

const ana = await ctx.newPage(); watch(ana, 'ana'); await asDevice(ana, 'chromebook-ana');
const ben = await ctx.newPage(); watch(ben, 'ben'); await asDevice(ben, 'chromebook-ben');
await joinAs(ana, 'Ana', 'WARRIOR');
await joinAs(ben, 'Ben', 'MEDIC');
await sleep(800);
await host.click('#btn-start');
await ana.waitForSelector('#g-ans .answer', { timeout: 30000 });
await sleep(600);

// ---- 1. the answer key never reaches a Chromebook
const keyOnChromebook = await ana.evaluate(c => JSON.stringify(window.__mockfb.get(`games/${c}/questions`)), code);
check('answer key is not sent to Chromebooks', !keyOnChromebook.includes('correct'));

// ---- 2. the projector checks answers and replies
async function answerRight(page) {
    await page.waitForSelector('#g-ans:not(.arming) .answer', { timeout: 15000 });
    const q = await page.textContent('.qbox .qt');
    const btns = await page.$$('#g-ans .answer');
    for (const b of btns) if ((await b.textContent()).includes(known[q])) { await b.click(); break; }
    await page.waitForSelector('#g-ans .answer.right', { timeout: 5000 });
}
await answerRight(ana);
const anaPid = await pidOf(ana);
const anaCorrect = await H(pid => window.__rrHost.engine.players[pid].stats.correct, anaPid);
check('a right answer is confirmed by the projector', anaCorrect === 1, `correct=${anaCorrect}`);

// ---- 3. Chromebook drops mid-raid: character stays, marked away
await ana.evaluate(() => window.__mockfb.drop());
await sleep(900);
const afterDrop = await H(pid => ({ inRaid: !!window.__rrHost.engine.players[pid], away: window.__rrHost.away?.has(pid), profile: !!window.__rrHost.room.players?.[pid]?.profile }), anaPid);
check('a dropped Chromebook keeps its character in the raid', afterDrop.inRaid && afterDrop.profile, JSON.stringify(afterDrop));
check('the projector shows the student as disconnected', !!afterDrop.away);
await host.waitForSelector(`.vital[data-pid="${anaPid}"]`, { timeout: 5000 });

// ---- 4. same tab reload gets straight back in, as the same character
await ana.reload();
await ana.waitForSelector('#g-ans .answer, #g .sg-main', { timeout: 15000 });
await sleep(900);
check('reloading puts the student back in the raid', (await pidOf(ana)) === anaPid && await ana.$('#g') !== null);
check('the disconnected mark clears on return', !(await H(pid => window.__rrHost.away?.has(pid), anaPid)));

// ---- 5. tab closed, new tab opened: same character
await ana.close();
const ana2 = await ctx.newPage(); watch(ana2, 'ana2'); await asDevice(ana2, 'chromebook-ana');
await joinAs(ana2, 'Ana');
await ana2.waitForSelector('#g', { timeout: 15000 });
check('a closed tab rejoins as the same character', (await pidOf(ana2)) === anaPid);

// ---- 6. a different Chromebook (no saved id), room locked: same name takes the character back
await H(() => { window.__rrHost.settings.locked = true; });
await host.evaluate(c => window.__mockfb.update(`games/${c}/meta`, { locked: true }), code);
await ana2.evaluate(() => window.__mockfb.drop());
await sleep(700);
const other = await ctx.newPage(); watch(other, 'other-chromebook'); await asDevice(other, 'chromebook-loaner');
await other.goto(`http://raid.test/next/play.html?room=${code}&name=ana`);
await other.waitForSelector('#g', { timeout: 15000 });
check('a different Chromebook gets the character back by typing the same name', (await other.evaluate(c => localStorage.getItem(`rr2_pid_${c}`), code)) === anaPid);
const stranger = await ctx.newPage(); watch(stranger, 'stranger'); await asDevice(stranger, 'chromebook-stranger');
await stranger.goto(`http://raid.test/next/play.html?room=${code}&name=Zed`);
await stranger.waitForSelector('#j-err', { timeout: 10000 });
await sleep(800);
const strangerMsg = await stranger.textContent('#j-err').catch(() => '(no join screen)');
check('a stranger can\'t get into a locked raid', /locked/i.test(strangerMsg), strangerMsg);
const engineCount = await H(() => Object.keys(window.__rrHost.engine.players).length);
check('nobody was duplicated by the rejoins', engineCount === 2, `players=${engineCount}`);

// ---- 7. a cheat script spams answers straight into Firebase
const benPid = await pidOf(ben);
await ben.evaluate(({ c, pid }) => {
    const t = Date.now().toString(36);
    const batch = {};
    for (let i = 0; i < 40; i++) batch[`i${t}${String(i).padStart(2, '0')}`] = { t: 'a', q: i % 3, p: 0, n: 'x' + i };
    window.__mockfb.update(`games/${c}/players/${pid}/intents`, batch);
}, { c: code, pid: benPid });
await sleep(1200);
const spam = await H(pid => { const p = window.__rrHost.engine.players[pid]; return { answered: p.stats.correct + p.stats.wrong, flagged: !!window.__rrHost.guard.p[pid]?.flagged }; }, benPid);
check('an answer-spamming script gets almost nothing through', spam.answered <= 5, `answers counted: ${spam.answered} of 40`);
check('the teacher is warned about the bot', spam.flagged);
await sleep(600);
check('the projector marks the suspected bot', !!(await host.$(`.vital.flagged[data-pid="${benPid}"]`)));

// ---- 8. junk intents are ignored
await ben.evaluate(({ c, pid }) => window.__mockfb.update(`games/${c}/players/${pid}/intents`, { izzz1: { t: 'x', ab: 'nuke' }, izzz2: { t: 'a', q: 99, p: 0 }, izzz3: 'hello', izzz4: { t: 'v', perk: { evil: true } } }), { c: code, pid: benPid });
await sleep(600);
check('junk intents are ignored without errors', !errors.some(e => e.startsWith('[host]')));

// ---- 9. bot join flood: the room caps itself and locks
await host.evaluate(c => window.__mockfb.update(`games/${c}/meta`, { locked: false }), code);
await H(() => { window.__rrHost.settings.locked = false; });
await ben.evaluate(c => {
    const flood = {};
    for (let i = 0; i < 80; i++) flood[`pbot${i}`] = { profile: { name: 'bot' + i, cls: 'WARRIOR', joinedAt: Date.now() } };
    window.__mockfb.update(`games/${c}/players`, flood);
}, code);
await sleep(1200);
const flood = await H(() => ({ n: Object.keys(window.__rrHost.engine.players).length, locked: window.__rrHost.settings.locked }));
check('a bot join flood is capped at 60 and the lobby locks itself', flood.n <= 60 && flood.locked, `players=${flood.n}`);

await host.screenshot({ path: path.join(OUT, 'fairplay_host.png') });
await browser.close();
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
const failed = results.filter(r => !r.ok).length;
console.log(failed || errors.length ? `\nFair-play check FAILED (${failed} failed)` : '\nFair-play check passed');
process.exit(failed || errors.length ? 1 : 0);
