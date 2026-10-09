// Renders the soundtrack offline (no speakers needed) so it can be listened to
// and checked: no silence where there should be music, no clipping.
// Run: node tests/audio/render.mjs [scenario]   -> tests/audio/out/*.mp3 (or .wav)

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

// Each scenario: segments rendered back to back. Events: [time, action, arg]
const SCENARIOS = {
    'raid-fight': [
        { track: 'boss:raider', dur: 64, events: [
            [0, 'intensity', 0.1], [8, 'intensity', 0.3], [16, 'intensity', 0.45], [20, 'stinger', 'telegraph'],
            [24, 'intensity', 0.6], [26, 'stinger', 'ult'], [30, 'phase', 'ENRAGED'], [36, 'intensity', 0.75],
            [40, 'stinger', 'combo'], [44, 'phase', 'DESPERATE'], [50, 'stinger', 'hero'], [56, 'intensity', 1], [60, 'stinger', 'bossDown']] }
    ],
    'boss-themes': [
        { track: 'boss:raider', dur: 16, events: [[0, 'intensity', 0.9]] },
        { track: 'boss:enforcer', dur: 16, events: [[0, 'intensity', 0.9]] },
        { track: 'boss:construct', dur: 15, events: [[0, 'intensity', 0.9]] },
        { track: 'boss:omega', dur: 14, events: [[0, 'intensity', 0.9]] }
    ],
    'final-boss': [
        { track: 'boss:omega', dur: 56, events: [[0, 'intensity', 0.2], [10, 'intensity', 0.5], [18, 'phase', 'ENRAGED'], [28, 'intensity', 0.8], [34, 'stinger', 'ult'], [38, 'phase', 'DESPERATE'], [46, 'stinger', 'hero'], [52, 'stinger', 'bossDown']] }
    ],
    'puzzle': [
        { track: 'puzzle', dur: 44, events: [[0, 'urgency', 0], [12, 'urgency', 0.45], [24, 'urgency', 0.8], [34, 'urgency', 0.95], [40, 'stinger', 'solve']] }
    ],
    'lobby-victory-defeat': [
        { track: 'lobby', dur: 20, events: [] },
        { track: 'victory', dur: 18, events: [] },
        { track: 'defeat', dur: 12, events: [[0, 'stinger', 'wipe']] }
    ]
};

const only = process.argv[2];
const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const page = await browser.newPage();
await page.route('**/*', route => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    return fs.existsSync(f) && fs.statSync(f).isFile() ? route.fulfill({ path: f }) : route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>render</title>' });
});
await page.goto('http://raid.test/');
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const RATE = 44100;
for (const [name, segs] of Object.entries(SCENARIOS)) {
    if (only && only !== name) continue;
    const result = await page.evaluate(async ({ segs, RATE }) => {
        const { AudioEngine: A } = await import('/next/js/audio.js');
        const chunks = [];
        for (const seg of segs) {
            const ctx = new OfflineAudioContext(2, Math.ceil(RATE * (seg.dur + 1.5)), RATE);
            A.attach(ctx);
            A.music(seg.track, { restart: true, at: 0.02 });
            const ev = [...seg.events];
            for (let t = 0; t < seg.dur; t += 0.05) {
                while (ev.length && ev[0][0] <= t) {
                    const [at, act, arg] = ev.shift();
                    if (act === 'intensity') A.setIntensity(arg);
                    if (act === 'urgency') A.setUrgency(arg);
                    if (act === 'phase') A.setPhase(arg);
                    if (act === 'stinger') A.stingerAt(arg, at + 0.01);
                }
                A.pump(t + 0.05);
            }
            A.stopMusic();
            const buf = await ctx.startRendering();
            chunks.push([buf.getChannelData(0), buf.getChannelData(1)]);
        }
        const len = chunks.reduce((n, c) => n + c[0].length, 0);
        const L = new Float32Array(len), R = new Float32Array(len);
        let o = 0;
        for (const [l, r] of chunks) { L.set(l, o); R.set(r, o); o += l.length; }
        // stats per second
        const secs = [];
        for (let s = 0; s * RATE < len; s++) {
            let sum = 0, peak = 0;
            for (let i = s * RATE; i < Math.min(len, (s + 1) * RATE); i++) { const v = Math.abs(L[i]); sum += v * v; if (v > peak) peak = v; }
            secs.push([Math.sqrt(sum / RATE), peak]);
        }
        // 16-bit stereo PCM, base64
        const pcm = new Int16Array(len * 2);
        for (let i = 0; i < len; i++) { pcm[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767; pcm[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767; }
        const bytes = new Uint8Array(pcm.buffer);
        let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return { pcm: btoa(bin), secs };
    }, { segs, RATE });
    const raw = path.join(OUT, name + '.pcm');
    fs.writeFileSync(raw, Buffer.from(result.pcm, 'base64'));
    let file = path.join(OUT, name + '.mp3');
    try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '2', '-i', raw, '-b:a', '160k', file]); }
    catch (e) { file = raw; }
    if (file !== raw) fs.unlinkSync(raw);
    const rms = result.secs.map(s => s[0]);
    const peaks = result.secs.map(s => s[1]);
    const silent = rms.filter(r => r < 0.005).length;
    console.log(`${name}: ${rms.length}s  avg rms ${(rms.reduce((a, b) => a + b, 0) / rms.length).toFixed(3)}  max peak ${Math.max(...peaks).toFixed(2)}  clipped secs ${peaks.filter(p => p >= 0.999).length}  silent secs ${silent}  -> ${path.relative(ROOT, file)}`);
    console.log('  rms/s: ' + rms.map(r => r.toFixed(2)).join(' '));
}
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
