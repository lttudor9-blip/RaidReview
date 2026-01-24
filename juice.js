/* ============================================ */
/* RAID REVIEW - Juice (Visual Feedback)        */
/* ============================================ */

/**
 * Screen shake effect
 * @param {string} intensity - 'normal' or 'heavy'
 */
export function shake(intensity = 'normal') {
    const el = document.getElementById('screen-shake');
    if (!el) return;
    
    el.classList.remove('shake', 'heavy-shake');
    void el.offsetWidth; // Force reflow to restart animation
    el.classList.add(intensity === 'heavy' ? 'heavy-shake' : 'shake');
    setTimeout(() => el.classList.remove('shake', 'heavy-shake'), 600);
}

/**
 * Full-screen color flash
 * @param {string} color - CSS color value
 * @param {number} duration - Flash duration in ms
 */
export function flash(color, duration = 150) {
    const el = document.getElementById('flash-overlay');
    if (!el) return;
    
    el.style.backgroundColor = color;
    el.style.opacity = '0.4';
    setTimeout(() => el.style.opacity = '0', duration);
}

/**
 * Show hit marker crosshair
 * @param {boolean} isCrit - Whether to show critical hit style
 */
export function hitMarker(isCrit = false) {
    const el = document.getElementById('hit-marker');
    if (!el) return;
    
    el.classList.remove('hidden', 'active', 'crit');
    void el.offsetWidth; // Force reflow
    el.classList.add('active');
    if (isCrit) el.classList.add('crit');
    setTimeout(() => el.classList.add('hidden'), 400);
}

/**
 * Spawn floating damage/text number
 * @param {string} text - Text to display
 * @param {Object} options - Styling options
 */
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

/**
 * Add notification to the feed
 * @param {string} text - Notification text
 * @param {string} type - 'normal', 'crit', 'heal', or 'ult'
 * @param {string} value - Optional value to show on right side
 */
export function notify(text, type = 'normal', value = '') {
    const feed = document.getElementById('notification-feed');
    if (!feed) return;
    
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.innerHTML = `<span>${text}</span><span class="font-bold">${value}</span>`;
    
    feed.insertBefore(el, feed.firstChild);
    
    // Limit notifications to 5
    while (feed.children.length > 5) {
        feed.removeChild(feed.lastChild);
    }
    
    setTimeout(() => el.remove(), 4000);
}

/**
 * Show big streak announcement in center of screen
 * @param {string} text - Announcement text
 * @param {string} type - 'normal', 'fire', or 'legendary'
 */
export function showStreak(text, type = 'normal') {
    const container = document.getElementById('streak-announcement');
    const textEl = document.getElementById('streak-text');
    if (!container || !textEl) return;
    
    textEl.className = 'streak-text';
    if (type === 'fire') textEl.classList.add('fire');
    if (type === 'legendary') textEl.classList.add('legendary');
    
    textEl.innerText = text;
    textEl.style.animation = 'none';
    void textEl.offsetWidth; // Force reflow
    textEl.style.animation = 'streakSlam 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
    
    container.classList.remove('hidden');
    
    // Add extra juice
    shake('heavy');
    flash('#ffa502', 200);
    
    setTimeout(() => container.classList.add('hidden'), 2000);
}

/**
 * Create ripple effect on button click
 * @param {HTMLElement} btn - Button element
 * @param {number} x - Click X coordinate
 * @param {number} y - Click Y coordinate
 */
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

/**
 * Show screen border effect when receiving support ability
 * @param {string} type - 'heal', 'shield', or 'buff'
 * @param {string} sourceName - Name of the player who cast the ability
 * @param {string|number} value - Effect value to display
 */
export function showReceivedEffect(type, sourceName, value) {
    const overlay = document.getElementById('screen-effect-overlay');
    if (!overlay) return;
    
    // Color and text based on type
    const config = {
        heal: { color: '#2ed573', icon: '', text: 'HEALED', valueText: `+${value} HP` },
        shield: { color: '#3742fa', icon: '', text: 'SHIELDED', valueText: `+${value}` },
        buff: { color: '#a55eea', icon: '', text: 'BOOSTED', valueText: '+50% DMG' }
    };
    
    const cfg = config[type] || config.heal;
    
    // Screen border glow
    overlay.className = `screen-effect-${type}`;
    overlay.style.boxShadow = `inset 0 0 100px ${cfg.color}80, inset 0 0 200px ${cfg.color}40`;
    
    // Fade out the border effect
    setTimeout(() => {
        overlay.style.boxShadow = 'none';
        overlay.className = '';
    }, 1500);
    
    // Big center announcement
    spawnDamage(`${cfg.icon} ${cfg.text}!`, { color: cfg.color, size: '3rem', isCrit: true });
    spawnDamage(`FROM ${sourceName.toUpperCase()}`, { color: '#ffffff', size: '1.5rem' });
    spawnDamage(cfg.valueText, { color: cfg.color, size: '2.5rem' });
    
    // Appropriate feedback
    flash(cfg.color, 300);
    shake();
    
    // Notify
    notify(`${sourceName} used ${cfg.text}!`, type === 'heal' ? 'heal' : 'normal', cfg.valueText);
}

/**
 * Show low HP warning effect
 * @param {boolean} enabled - Whether to show/hide warning
 */
export function showLowHpWarning(enabled) {
    const gameContainer = document.querySelector('.game-container');
    if (!gameContainer) return;
    
    if (enabled) {
        gameContainer.classList.add('low-hp-warning');
    } else {
        gameContainer.classList.remove('low-hp-warning');
    }
}

/**
 * Pulse a roster card to highlight support action
 * @param {string} playerId - ID of the player card to pulse
 * @param {string} type - 'heal', 'shield', or 'buff'
 */
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

/**
 * Show big support action announcement (for caster)
 * @param {string} abilityType - 'heal', 'shield', or 'buff'
 * @param {string} targetName - Name of the target
 */
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

// Boss warning state
let bossWarningTimer = null;

/**
 * Show boss attack warning
 * @param {string} text - Warning text
 * @param {string} icon - Emoji icon
 * @param {number} duration - Time until attack hits (ms)
 * @param {boolean} isTargeted - Whether current player is targeted
 */
export function showBossWarning(text, icon, duration, isTargeted) {
    const container = document.getElementById('boss-warning');
    if (!container) return;
    
    // Clear any existing timer
    if (bossWarningTimer) {
        clearTimeout(bossWarningTimer);
        bossWarningTimer = null;
    }
    
    const iconEl = container.querySelector('.boss-warning-icon');
    const textEl = container.querySelector('.boss-warning-text');
    const timerEl = container.querySelector('.boss-warning-timer');
    
    if (iconEl) iconEl.innerText = icon;
    if (textEl) textEl.innerText = text;
    
    // Add targeted class for extra intensity
    container.classList.toggle('targeted', isTargeted);
    container.classList.remove('hidden');
    
    // Countdown timer
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
        
        // Auto-hide after duration
        bossWarningTimer = setTimeout(() => {
            clearInterval(countdownInterval);
            hideBossWarning();
        }, duration + 500);
    } else if (timerEl) {
        timerEl.innerText = '';
        // For enrage and instant messages, hide after a delay
        bossWarningTimer = setTimeout(() => hideBossWarning(), 3000);
    }
}

/**
 * Hide boss attack warning
 */
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

/**
 * Get random flavor text for damage numbers
 * @param {string} type - 'hit', 'crit', 'miss', 'heal', 'shield'
 * @returns {string}
 */
export function getFlavorText(type) {
    const flavors = {
        hit: ['BOOM!', 'POW!', 'WHAM!', 'SMACK!', 'THWACK!'],
        crit: ['DEVASTATING!', 'OBLITERATED!', 'CRUSHED!', 'ANNIHILATED!', 'Ã°Å¸â€™â‚¬'],
        miss: ['YIKES!', 'OOF!', 'NOPE!', 'WHOOPS!', 'MISS!'],
        heal: ['PATCHED UP!', 'RESTORED!', 'REFRESHED!', 'MENDED!'],
        shield: ['BLOCKED!', 'DENIED!', 'DEFLECTED!', 'ABSORBED!']
    };
    
    const options = flavors[type] || flavors.hit;
    return options[Math.floor(Math.random() * options.length)];
}
