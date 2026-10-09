// Layout check: can a student always see and tap every answer?
// A real host and one student in headless Chromium (mock Firebase), then the
// student screen is squeezed to real Chromebook window sizes (browser bars,
// 125% display zoom) with the worst case on screen at once: three big banners,
// a long question, four long answers, a slam, an achievement and a toast.
//
// Run: npm run e2e:layout    (screenshots land in tests/e2e/out/layout_*.png)

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const QUESTIONS = [
    { text: 'Which river valley civilization developed cuneiform writing on clay tablets to keep records of trade, laws and harvests?', answers: ['Mesopotamia, between the Tigris and Euphrates rivers', 'Ancient Egypt along the Nile River delta', 'The Indus Valley civilization at Mohenjo-daro', 'Ancient China along the Huang He (Yellow River)'], correct: 0, type: 'mc' }
];

// CSS-pixel window sizes students really have
const SIZES = [
    { name: 'chromebook-fullscreen', width: 1366, height: 768 },
    { name: 'chromebook-browser', width: 1366, height: 650 },
    { name: 'chromebook-125pct', width: 1093, height: 520 },
    { name: 'chromebook-small', width: 1280, height: 600 },
    { name: 'half-window', width: 800, height: 560 }
];

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
    return route.abort();
});

const host = await ctx.newPage();
await host.addInitScript(q => { if (location.search.includes('host=1')) { localStorage.setItem('rr_launch_questions', q); localStorage.setItem('rr_launch_set_title', 'Layout'); } }, JSON.stringify(QUESTIONS));
await host.goto('http://raid.test/next/play.html?host=1');
await host.waitForSelector('#join-code', { timeout: 15000 });
const code = (await host.textContent('#join-code')).trim();

const stu = await ctx.newPage();
await stu.setViewportSize({ width: 1366, height: 768 });
await stu.goto(`http://raid.test/next/play.html?room=${code}&name=Layout`);
await stu.waitForSelector('.hs-card', { timeout: 10000 });
await stu.click('[data-pick="MEDIC"]');
await stu.click('#hs-lock');
await stu.waitForSelector('#t-skip', { timeout: 10000 });
await stu.click('#t-skip');
await sleep(600);
await host.click('#btn-start');
await stu.waitForSelector('#g-ans .answer', { timeout: 30000 });
await sleep(800);

const failures = [];
for (const size of SIZES) {
    await stu.setViewportSize({ width: size.width, height: size.height });
    await sleep(300);
    const r = await stu.evaluate(() => {
        // worst case: everything at once
        const big = (t, c) => `<div class="banner big" style="--bc:${c}">${t} <span class="bt">9s</span></div>`;
        document.getElementById('banners').innerHTML =
            big('🛡 ELEMENTAL SHIELD: ONLY MEDICS CAN BREAK IT! ATTACK! (80% left)', '#2ed573')
            + big('🔇 SILENCED: basic attacks only. A Medic heal cleanses it', '#9fa8ff')
            + `<div class="banner big danger">⚠ YOU'RE TARGETED: SNIPER MARK — it can knock you out! GUARDIANS: SHIELD ME! <span class="bt">7s</span></div>`
            + '<div class="banner">BOSS EXPOSED: everyone deals +25% <span class="bt">5s</span></div>';
        const slam = document.getElementById('slam');
        slam.innerHTML = '<div class="slam-text" style="--c:#ffb020">SHIELD SHATTERED!</div><div class="slam-sub">BOSS STAGGERED · EVERY CLASS: HIT IT NOW</div>';
        slam.classList.add('on'); slam.style.animation = 'none'; slam.style.opacity = '1';
        const achv = document.getElementById('achv');
        achv.innerHTML = '<div class="achv-icon">🏆</div><div><div class="achv-kicker">ACHIEVEMENT UNLOCKED</div><div class="achv-name">SQUAD SAVER</div><div class="achv-desc">Answer a role call that stops an attack</div></div>';
        achv.classList.add('on'); achv.style.transition = 'none';
        // measured straight away, before the next live update redraws the banners
        const vw = innerWidth, vh = innerHeight;
        // what's actually painted: a popup inside a clipping box (the boss stage) can't spill past it
        const clipped = el => {
            const r = el.getBoundingClientRect();
            let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            for (let p = el.parentElement; p; p = p.parentElement) {
                if (getComputedStyle(p).overflow === 'visible') continue;
                const c = p.getBoundingClientRect();
                box = { left: Math.max(box.left, c.left), top: Math.max(box.top, c.top), right: Math.min(box.right, c.right), bottom: Math.min(box.bottom, c.bottom) };
            }
            return box;
        };
        const covers = ['#achv', '.toasts', '#slam .slam-text', '#slam .slam-sub'].flatMap(sel => [...document.querySelectorAll(sel)])
            .filter(el => getComputedStyle(el).opacity !== '0' && getComputedStyle(el).display !== 'none').map(el => ({ sel: el.id || el.className, r: clipped(el) }));
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const answers = [...document.querySelectorAll('#g-ans .answer')].map((el, i) => {
            const b = el.getBoundingClientRect();
            const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
            const top = document.elementFromPoint(Math.min(vw - 1, Math.max(0, cx)), Math.min(vh - 1, Math.max(0, cy)));
            return {
                i, visible: b.top >= 0 && b.bottom <= vh + 0.5 && b.left >= 0 && b.right <= vw + 0.5,
                tappable: !!top && el.contains(top),
                coveredBy: covers.filter(c => hit(c.r, b)).map(c => c.sel),
                bottom: Math.round(b.bottom)
            };
        });
        const q = document.querySelector('.qbox').getBoundingClientRect();
        return { vh, answers, qVisible: q.top >= 0 && q.bottom <= vh, qCoveredBy: covers.filter(c => hit(c.r, q)).map(c => c.sel) };
    });
    await stu.screenshot({ path: path.join(OUT, `layout_${size.name}.png`) });
    const bad = r.answers.filter(a => !a.visible || !a.tappable || a.coveredBy.length);
    const status = bad.length || !r.qVisible || r.qCoveredBy.length ? 'FAIL' : 'ok';
    console.log(`${status.padEnd(4)} ${size.name} ${size.width}x${size.height}` + (status === 'ok' ? '' : `  question ${r.qVisible ? 'visible' : 'CUT OFF'}${r.qCoveredBy.length ? ' covered by ' + r.qCoveredBy.join(',') : ''}; ` + bad.map(a => `answer ${'ABCD'[a.i]}: ${!a.visible ? `cut off (bottom ${a.bottom} > ${r.vh})` : ''}${!a.tappable ? ' not tappable' : ''}${a.coveredBy.length ? ' covered by ' + a.coveredBy.join(',') : ''}`).join('; ')));
    if (status !== 'ok') failures.push(size.name);
    await stu.evaluate(() => { const s = document.getElementById('slam'), a = document.getElementById('achv'); s.classList.remove('on'); s.style.cssText = ''; a.classList.remove('on'); a.style.cssText = ''; });
}

await browser.close();
if (failures.length) { console.log(`\nLayout check FAILED at: ${failures.join(', ')}`); process.exit(1); }
console.log('\nLayout check passed: every answer visible and tappable at every size');
