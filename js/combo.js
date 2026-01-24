/* ============================================ */
/* RAID REVIEW - Combo System                   */
/* ============================================ */

import { STREAK_MILESTONES, COMBO_MULTIPLIERS } from './config.js';
import { showStreak, notify } from './juice.js';

// Combo state
let comboCount = 0;
let comboTimer = null;

/**
 * Get current combo count
 * @returns {number}
 */
export function getComboCount() {
    return comboCount;
}

/**
 * Calculate combo multiplier based on current count
 * @returns {number}
 */
export function getComboMult() {
    for (const { threshold, mult } of COMBO_MULTIPLIERS) {
        if (comboCount >= threshold) return mult;
    }
    return 1;
}

/**
 * Increment combo and check for streak milestones
 */
export function incrementCombo() {
    comboCount++;
    
    // Reset combo timer
    if (comboTimer) clearTimeout(comboTimer);
    comboTimer = setTimeout(() => breakCombo(), 10000);
    
    updateComboUI();
    
    // Check for streak milestones
    if (STREAK_MILESTONES[comboCount]) {
        const type = comboCount >= 10 ? 'legendary' : (comboCount >= 5 ? 'fire' : 'normal');
        showStreak(STREAK_MILESTONES[comboCount], type);
    }
}

/**
 * Break the combo chain
 */
export function breakCombo() {
    if (comboCount > 0) {
        notify('Combo broken!', 'normal', `${comboCount}x`);
    }
    comboCount = 0;
    if (comboTimer) clearTimeout(comboTimer);
    updateComboUI();
}

/**
 * Reset combo (without notification)
 */
export function resetCombo() {
    comboCount = 0;
    if (comboTimer) clearTimeout(comboTimer);
    updateComboUI();
}

/**
 * Update the combo UI display
 */
export function updateComboUI() {
    const display = document.getElementById('combo-display');
    const countEl = document.getElementById('combo-count');
    const multEl = document.getElementById('combo-mult');
    
    if (!display || !countEl || !multEl) return;
    
    if (comboCount === 0) {
        display.classList.add('hidden');
        return;
    }
    
    display.classList.remove('hidden');
    display.classList.toggle('on-fire', comboCount >= 5);
    countEl.innerText = comboCount;
    multEl.innerText = `⭐ ${getComboMult().toFixed(1)}x`;
}
