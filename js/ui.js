/* ============================================ */
/* UI HELPERS                                   */
/* ui.js                                        */
/* ============================================ */

export function show(id) {
    document.getElementById(id)?.classList.remove('hidden');
}

export function hide(id) {
    document.getElementById(id)?.classList.add('hidden');
}

export function showView(id) {
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    show(id);
}

export function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

export function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

export function setStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
}

export function getInputValue(id) {
    return document.getElementById(id)?.value.trim() || '';
}

export function toggleVisible(id, condition) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !condition);
}

export function setDisabled(id, disabled) {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
}

export function onClick(id, handler) {
    document.getElementById(id)?.addEventListener('click', handler);
}

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

export function makeRosterTargetable(selfId, abilityType, onSelect) {
    const roster = document.getElementById('game-roster');
    if (!roster) return;
    
    const cards = roster.querySelectorAll('.squad-card');
    cards.forEach(card => {
        const playerId = card.dataset.playerId;
        const playerHealth = parseInt(card.dataset.playerHealth || '0');
        
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
