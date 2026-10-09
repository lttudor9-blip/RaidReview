// Tiny DOM helpers shared by host and student screens.

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Update an element only when its content actually changed. Screens refresh
// several times a second; rebuilding unchanged HTML restarts animations (flashing)
// and can swap a button out from under a click. Crest SVGs get fresh gradient ids
// each render, so those are ignored when comparing.
export function setHTML(el, html) {
    if (!el) return;
    const key = html.replace(/\bcr\d+/g, '');
    if (el.__rrKey === key) return;
    el.__rrKey = key;
    el.innerHTML = html;
}

// Full screen on and off (Chromebooks, projectors).
export function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else { const el = d.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); }
}

// Render a screen: replaces #app content with the given HTML string.
export function mount(html) {
    const app = document.getElementById('app');
    app.innerHTML = html;
    return app;
}

export function toast(text, ms = 2800) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    box.appendChild(t);
    setTimeout(() => t.remove(), ms);
}

export function floater(layer, text, { color = '#fff', size = '2rem', x = 50, y = 45 } = {}) {
    if (!layer) return;
    const f = document.createElement('div');
    f.className = 'floater';
    f.textContent = text;
    f.style.cssText = `left:${x}%;top:${y}%;color:${color};font-size:${size}`;
    layer.appendChild(f);
    setTimeout(() => f.remove(), 1300);
}

let flashEl = null;
export function flash(color = '#fff', strength = 0.35) {
    if (!flashEl) { flashEl = document.createElement('div'); flashEl.className = 'flash'; document.body.appendChild(flashEl); }
    flashEl.style.transition = 'none';
    flashEl.style.background = color;
    flashEl.style.opacity = String(strength);
    requestAnimationFrame(() => requestAnimationFrame(() => { flashEl.style.transition = 'opacity 0.4s ease'; flashEl.style.opacity = '0'; }));
}

export function shake(el = document.body) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
}

export const fmtNum = n => Math.round(n).toLocaleString();
export function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
