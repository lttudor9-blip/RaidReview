/* ============================================ */
/* RAID REVIEW - UI Helpers                     */
/* ============================================ */

/**
 * Show an element by removing 'hidden' class
 * @param {string} id - Element ID
 */
export function show(id) {
    document.getElementById(id)?.classList.remove('hidden');
}

/**
 * Hide an element by adding 'hidden' class
 * @param {string} id - Element ID
 */
export function hide(id) {
    document.getElementById(id)?.classList.add('hidden');
}

/**
 * Show a specific view, hiding all other views
 * @param {string} id - View element ID to show
 */
export function showView(id) {
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    show(id);
}

/**
 * Set text content of an element
 * @param {string} id - Element ID
 * @param {string} text - Text to set
 */
export function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

/**
 * Set innerHTML of an element
 * @param {string} id - Element ID
 * @param {string} html - HTML to set
 */
export function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

/**
 * Set style property of an element
 * @param {string} id - Element ID
 * @param {string} prop - Style property name
 * @param {string} value - Style value
 */
export function setStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
}

/**
 * Get input value
 * @param {string} id - Input element ID
 * @returns {string} Trimmed value
 */
export function getInputValue(id) {
    return document.getElementById(id)?.value.trim() || '';
}

/**
 * Toggle element visibility based on condition
 * @param {string} id - Element ID
 * @param {boolean} condition - Show if true, hide if false
 */
export function toggleVisible(id, condition) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !condition);
}

/**
 * Disable/enable a button
 * @param {string} id - Button element ID
 * @param {boolean} disabled - Whether to disable
 */
export function setDisabled(id, disabled) {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
}

/**
 * Add click event listener
 * @param {string} id - Element ID
 * @param {Function} handler - Click handler
 */
export function onClick(id, handler) {
    document.getElementById(id)?.addEventListener('click', handler);
}

/**
 * Enable targeting mode on the roster
 * @param {boolean} enabled - Whether targeting mode is active
 */
export function setTargetingMode(enabled) {
    const roster = document.getElementById('game-roster');
    const prompt = document.getElementById('targeting-prompt');
    
    if (roster) {
        roster.classList.toggle('targeting-mode', enabled);
    }
    if (prompt) {
        prompt.classList.toggle('hidden', !enabled);
    }
}

/**
 * Make roster cards targetable with click handlers
 * @param {string} selfId - Current player's ID (to exclude from targeting for heal)
 * @param {string} abilityType - Type of ability being used
 * @param {Function} onSelect - Callback when a target is selected
 */
export function makeRosterTargetable(selfId, abilityType, onSelect) {
    const roster = document.getElementById('game-roster');
    if (!roster) return;
    
    const cards = roster.querySelectorAll('.squad-card');
    cards.forEach(card => {
        const playerId = card.dataset.playerId;
        const playerHealth = parseInt(card.dataset.playerHealth || '0');
        
        // Determine if this is a valid target
        // - Can't heal yourself (medic rule)
        // - Can't target dead players
        const isSelf = playerId === selfId;
        const isDead = playerHealth <= 0;
        const isValidTarget = !isDead && !(abilityType === 'heal' && isSelf);
        
        if (isValidTarget) {
            card.classList.add('valid-target');
            card.classList.remove('invalid-target');
            card.onclick = () => onSelect(playerId);
        } else {
            card.classList.add('invalid-target');
            card.classList.remove('valid-target');
            card.onclick = null;
        }
    });
}

/**
 * Clear targeting mode and remove click handlers
 */
export function clearRosterTargetable() {
    const roster = document.getElementById('game-roster');
    if (!roster) return;
    
    const cards = roster.querySelectorAll('.squad-card');
    cards.forEach(card => {
        card.classList.remove('valid-target', 'invalid-target');
        card.onclick = null;
    });
    
    setTargetingMode(false);
}
