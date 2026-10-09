// Student-screen juice: loot-colored damage numbers, streak slams,
// achievements, confetti. The stuff that makes kids ask for Raid Review.

import { AudioEngine as Audio } from '../audio.js';
import { fmtNum, shake, flash } from '../ui.js';

// Borderlands-style rarity tiers for damage numbers
export const TIERS = [
    { id: 'legendary', min: 8000, color: '#ff9d00', size: 4.6 },
    { id: 'epic', min: 4000, color: '#c45cff', size: 3.8 },
    { id: 'rare', min: 2000, color: '#3fa7ff', size: 3.1 },
    { id: 'uncommon', min: 1000, color: '#4ee36a', size: 2.6 },
    { id: 'common', min: 0, color: '#ffffff', size: 2.2 }
];
export const tierFor = (amount, legendary) => (legendary ? TIERS[0] : TIERS.find(t => amount >= t.min));

export function damageNumber(layer, amount, { crit = false, label = '', legendary = false } = {}) {
    if (!layer) return;
    const t = tierFor(amount, legendary);
    const el = document.createElement('div');
    el.className = `dmg tier-${t.id}`;
    el.style.setProperty('--c', t.color);
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 18}deg`);
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    el.style.left = `${28 + Math.random() * 44}%`;
    el.style.top = `${22 + Math.random() * 34}%`;
    el.style.fontSize = `${t.size}rem`;
    el.innerHTML = `${label ? `<span class="dmg-label">${label}</span>` : ''}${crit ? '<span class="dmg-crit">CRIT</span>' : ''}${fmtNum(amount)}`;
    while (layer.children.length > 9) layer.firstChild.remove();
    layer.appendChild(el);
    setTimeout(() => el.remove(), t.id === 'legendary' ? 2000 : 1400);
    if (t.id === 'legendary' || t.id === 'epic') { shake(document.getElementById('g')); flash(t.color, 0.25); }
    return t;
}

export function textPop(layer, text, color = '#fff', size = 2.2) {
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'dmg';
    el.style.setProperty('--c', color);
    el.style.setProperty('--rot', '0deg');
    el.style.setProperty('--dx', '0px');
    el.style.left = `${40 + Math.random() * 20}%`;
    el.style.top = `${30 + Math.random() * 20}%`;
    el.style.fontSize = `${size}rem`;
    el.textContent = text;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1400);
}

export function hitMarker(layer) {
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'hitmarker';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 350);
}

// ---------------------------------------------------------------- streak slams
const STREAK_NAMES = { 3: 'TRIPLE!', 5: 'RAMPAGE!', 7: 'DOMINATING!', 10: 'UNSTOPPABLE!', 15: 'LEGENDARY!', 20: 'GODLIKE!' };
export function streakName(n) { return STREAK_NAMES[n] || null; }

export function slam(text, { color = '#ffa502', sub = '' } = {}) {
    const host = document.getElementById('slam');
    if (!host) return;
    host.innerHTML = `<div class="slam-text" style="--c:${color}">${text}</div>${sub ? `<div class="slam-sub">${sub}</div>` : ''}`;
    host.classList.remove('on'); void host.offsetWidth; host.classList.add('on');
    clearTimeout(host._t);
    host._t = setTimeout(() => host.classList.remove('on'), 1700);
}

// ---------------------------------------------------------------- achievements
export const ACHIEVEMENTS = {
    first_blood: 'FIRST BLOOD',
    crit: 'CRITICAL THINKER',
    heavy: 'HEAVY HITTER',
    shatter: 'SHATTERED!',
    legendary: 'LEGENDARY DROP',
    streak5: 'ON A ROLL',
    streak10: 'UNSTOPPABLE',
    streak20: 'LIVING LEGEND',
    quick: 'QUICK DRAW',
    scholar: 'SCHOLAR',
    brainiac: 'BRAINIAC',
    encyclopedia: 'WALKING ENCYCLOPEDIA',
    clutch: 'NERVES OF STEEL',
    call: 'ANSWERED THE CALL',
    saver: 'SQUAD SAVER',
    revive1: 'SECOND CHANCE',
    revive3: 'GUARDIAN ANGEL',
    bodyguard: 'BODYGUARD',
    hero: 'RAID HERO',
    save: 'CLUTCH SAVE',
    save3: 'HUMAN SHIELD',
    medic: 'FIELD MEDIC',
    weakpoint: 'WEAK POINT FOUND',
    ult: 'ULTIMATE POWER',
    synergy: 'FULL SQUAD',
    comeback: 'BACK FROM THE DEAD',
    spirit: 'UNDYING SPIRIT',
    untouchable: 'UNTOUCHABLE',
    interrupt: 'SYSTEM CRASH'
};
const DESCS = {
    first_blood: 'Land your first hit', crit: 'Land a critical hit', heavy: 'Deal 5,000+ in one hit', shatter: 'Trigger a SHATTER combo',
    legendary: 'Land a legendary-tier hit', streak5: '5 right in a row', streak10: '10 right in a row', streak20: '20 right in a row',
    quick: 'Right answer in under 3 seconds', scholar: '10 right answers', brainiac: '25 right answers', encyclopedia: '50 right answers',
    clutch: 'Answer right while under 20% HP', call: 'Answer a boss role call', saver: 'Help stop a boss attack', revive1: 'Revive a teammate',
    revive3: 'Revive 3 teammates', bodyguard: 'Shield 5 teammates', save: 'Your shield blocks a boss hit on a teammate', save3: 'Make 3 clutch saves', hero: 'Star in a hero moment', medic: 'Heal 3 teammates', weakpoint: 'Expose the boss 3 times',
    ult: 'Use your ultimate', synergy: 'Fight with all four classes at once', comeback: 'Get back up after going down', spirit: 'Keep answering after you\'re out',
    untouchable: 'Beat a boss without going down', interrupt: 'Interrupt a boss attack'
};
export const achievementDesc = id => DESCS[id] || '';

const unlocked = new Set();
const queue = [];
let showing = false;
export function unlock(id) {
    if (unlocked.has(id) || !ACHIEVEMENTS[id]) return;
    unlocked.add(id);
    queue.push(id);
    if (!showing) nextAchievement();
}
function nextAchievement() {
    const id = queue.shift();
    const el = document.getElementById('achv');
    if (!id || !el) { showing = false; return; }
    showing = true;
    el.innerHTML = `<div class="achv-icon">🏆</div><div><div class="achv-kicker">ACHIEVEMENT UNLOCKED</div><div class="achv-name">${ACHIEVEMENTS[id]}</div><div class="achv-desc">${DESCS[id]}</div></div>`;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    Audio.sfxAchievement();
    setTimeout(() => { el.classList.remove('on'); setTimeout(nextAchievement, 350); }, 3000);
}
export const unlockedList = () => [...unlocked];

// ---------------------------------------------------------------- confetti
export function confetti(n = 140) {
    const box = document.createElement('div');
    box.className = 'confetti-box';
    document.body.appendChild(box);
    const colors = ['#ff4757', '#4a6cff', '#2ed573', '#a55eea', '#ffa502', '#ff9d00'];
    for (let i = 0; i < n; i++) {
        const c = document.createElement('i');
        c.style.left = Math.random() * 100 + '%';
        c.style.background = colors[i % colors.length];
        c.style.animationDuration = 1.8 + Math.random() * 2 + 's';
        c.style.animationDelay = Math.random() * 0.6 + 's';
        c.style.setProperty('--sx', (Math.random() - 0.5) * 200 + 'px');
        box.appendChild(c);
    }
    setTimeout(() => box.remove(), 5000);
}
