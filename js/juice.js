/* ============================================ */
/* JUICE (VISUAL FEEDBACK)                      */
/* juice.js                                     */
/* ============================================ */

import { DAMAGE_FLAVOR } from './config.js';

export function shake(intensity = 'normal') {
    const el = document.getElementById('screen-shake');
    if (!el) return;
    
    el.classList.remove('shake', 'heavy-shake');
    void el.offsetWidth;
    el.classList.add(intensity === 'heavy' ? 'heavy-shake' : 'shake');
    setTimeout(() => el.classList.remove('shake', 'heavy-shake'), 600);
}

export function flash(color, duration = 150) {
    const el = document.getElementById('flash-overlay');
    if (!el) return;
    
    el.style.backgroundColor = color;
    el.style.opacity = '0.4';
    setTimeout(() => el.style.opacity = '0', duration);
}

export function hitMarker(isCrit = false) {
    const el = document.getElementById('hit-marker');
    if (!el) return;
    
    el.classList.remove('hidden', 'active', 'crit');
    void el.offsetWidth;
    el.classList.add('active');
    if (isCrit) el.classList.add('crit');
    setTimeout(() => el.classList.add('hidden'), 400);
}

export function spawnDamage(text, options = {}) {
    const {
        color = '#ffa502',
        size = '2.5rem',
        isCrit = false,
        isHeal = false,
        layer = 'damage-layer'
    } = options;
    
    const container = document.getElementById(layer);
    if (!container) return;
    
    const el = document.createElement('div');
    el.className = `damage-number ${isCrit ? 'crit' : ''} ${isHeal ? 'heal' : ''}`;
    el.innerText = text;
    el.style.color = color;
    el.style.fontSize = size;
    el.style.left = `${30 + Math.random() * 40}%`;
    el.style.top = `${20 + Math.random() * 30}%`;
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 20}deg`);
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}px`);
    
    container.appendChild(el);
    setTimeout(() => el.remove(), 1500);
}

export function notify(text, type = 'normal', value = '') {
    const feed = document.getElementById('notification-feed');
    if (!feed) return;
    
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.innerHTML = `<span>${text}</span><span class="font-bold">${value}</span>`;
    
    feed.insertBefore(el, feed.firstChild);
    
    while (feed.children.length > 5) {
        feed.removeChild(feed.lastChild);
    }
    
    setTimeout(() => el.remove(), 4000);
}

export function showStreak(text, type = 'normal') {
    const container = document.getElementById('streak-announcement');
    const textEl = document.getElementById('streak-text');
    if (!container || !textEl) return;
    
    textEl.className = 'streak-text';
    if (type === 'fire') textEl.classList.add('fire');
    if (type === 'legendary') textEl.classList.add('legendary');
    
    textEl.innerText = text;
    textEl.style.animation = 'none';
    void textEl.offsetWidth; 
    textEl.style.animation = 'streakSlam 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
    
    container.classList.remove('hidden');
    shake('heavy');
    flash('#ffa502', 200);
    
    setTimeout(() => container.classList.add('hidden'), 2000);
}

export function ripple(btn, x, y) {
    if (!btn) return;
    
    const rippleEl = document.createElement('span');
    rippleEl.className = 'ripple';
    const rect = btn.getBoundingClientRect();
    rippleEl.style.left = `${x - rect.left}px`;
    rippleEl.style.top = `${y - rect.top}px`;
    rippleEl.style.width = rippleEl.style.height = '20px';
    btn.appendChild(rippleEl);
    setTimeout(() => rippleEl.remove(), 600);
}

export function showReceivedEffect(type, sourceName, value) {
    const overlay = document.getElementById('screen-effect-overlay');
    if (!overlay) return;
    
    const config = {
        heal: { color: '#2ed573', icon: '💚', text: 'HEALED', valueText: `+${value} HP` },
        shield: { color: '#3742fa', icon: '🛡', text: 'SHIELDED', valueText: `+${value}` },
        buff: { color: '#a55eea', icon: '⚡', text: 'BOOSTED', valueText: '+50% DMG' }
    };
    
    const cfg = config[type] || config.heal;
    
    overlay.className = `screen-effect-${type}`;
    overlay.style.boxShadow = `inset 0 0 100px ${cfg.color}80, inset 0 0 200px ${cfg.color}40`;
    
    setTimeout(() => {
        overlay.style.boxShadow = 'none';
        overlay.className = '';
    }, 1500);
    
    spawnDamage(`${cfg.icon} ${cfg.text}!`, { color: cfg.color, size: '3rem', isCrit: true });
    spawnDamage(`FROM ${sourceName.toUpperCase()}`, { color: '#ffffff', size: '1.5rem' });
    spawnDamage(cfg.valueText, { color: cfg.color, size: '2.5rem' });
    
    flash(cfg.color, 300);
    shake();
    
    notify(`${sourceName} used ${cfg.text}!`, type === 'heal' ? 'heal' : 'normal', cfg.valueText);
}

export function showLowHpWarning(enabled) {
    const gameContainer = document.querySelector('.game-container');
    if (!gameContainer) return;
    
    if (enabled) {
        gameContainer.classList.add('low-hp-warning');
    } else {
        gameContainer.classList.remove('low-hp-warning');
    }
}

export function pulseRosterCard(playerId, type) {
    const card = document.querySelector(`[data-player-id="${playerId}"]`);
    if (!card) return;
    
    const colors = {
        heal: '#2ed573',
        shield: '#3742fa',
        buff: '#a55eea'
    };
    
    const color = colors[type] || '#ffa502';
    
    card.classList.add('roster-pulse');
    card.style.setProperty('--pulse-color', color);
    
    setTimeout(() => {
        card.classList.remove('roster-pulse');
    }, 1000);
}

export function showSupportAction(abilityType, targetName) {
    const container = document.getElementById('streak-announcement');
    const textEl = document.getElementById('streak-text');
    if (!container || !textEl) return;
    
    const config = {
        heal: { text: `HEALED ${targetName.toUpperCase()}!`, class: 'heal-action' },
        shield: { text: `SHIELDED ${targetName.toUpperCase()}!`, class: 'shield-action' },
        buff: { text: `BUFFED ${targetName.toUpperCase()}!`, class: 'buff-action' }
    };
    
    const cfg = config[abilityType] || config.heal;
    
    textEl.className = `streak-text ${cfg.class}`;
    textEl.innerText = cfg.text;
    textEl.style.animation = 'none';
    void textEl.offsetWidth;
    textEl.style.animation = 'streakSlam 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
    
    container.classList.remove('hidden');
    setTimeout(() => container.classList.add('hidden'), 1500);
}

let bossWarningTimer = null;

export function showBossWarning(text, icon, duration, isTargeted) {
    const container = document.getElementById('boss-warning');
    if (!container) return;
    
    if (bossWarningTimer) {
        clearTimeout(bossWarningTimer);
        bossWarningTimer = null;
    }
    
    const iconEl = container.querySelector('.boss-warning-icon');
    const textEl = container.querySelector('.boss-warning-text');
    const timerEl = container.querySelector('.boss-warning-timer');
    
    if (iconEl) iconEl.innerText = icon;
    if (textEl) textEl.innerText = text;
    
    container.classList.toggle('targeted', isTargeted);
    container.classList.remove('hidden');
    
    if (duration > 0 && timerEl) {
        let remaining = Math.ceil(duration / 1000);
        timerEl.innerText = `${remaining}s`;
        
        const countdownInterval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(countdownInterval);
                timerEl.innerText = 'NOW!';
            } else {
                timerEl.innerText = `${remaining}s`;
            }
        }, 1000);
        
        bossWarningTimer = setTimeout(() => {
            clearInterval(countdownInterval);
            hideBossWarning();
        }, duration + 500);
    } else if (timerEl) {
        timerEl.innerText = '';
        bossWarningTimer = setTimeout(() => hideBossWarning(), 3000);
    }
}

export function hideBossWarning() {
    const container = document.getElementById('boss-warning');
    if (container) {
        container.classList.add('hidden');
        container.classList.remove('targeted');
    }
    if (bossWarningTimer) {
        clearTimeout(bossWarningTimer);
        bossWarningTimer = null;
    }
}

export function getFlavorText(type) {
    const options = DAMAGE_FLAVOR[type] || DAMAGE_FLAVOR.hit;
    return options[Math.floor(Math.random() * options.length)];
}
