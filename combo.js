/* ============================================ */
/* COMBO SYSTEM                                 */
/* combo.js                                     */
/* ============================================ */

import { COMBO_MULTIPLIERS, STREAK_MILESTONES } from './config.js';
import { notify, showStreak } from './juice.js';

let comboCount = 0;
let comboTimer = null;

export function getComboCount() {
    return comboCount;
}

export function getComboMult() {
    for (const { threshold, mult } of COMBO_MULTIPLIERS) {
        if (comboCount >= threshold) return mult;
    }
    return 1;
}

export function incrementCombo() {
    comboCount++;
    if (comboTimer) clearTimeout(comboTimer);
    comboTimer = setTimeout(() => breakCombo(), 10000);
    updateComboUI();
    if (STREAK_MILESTONES[comboCount]) {
        const type = comboCount >= 10 ? 'legendary' : (comboCount >= 5 ? 'fire' : 'normal');
        showStreak(STREAK_MILESTONES[comboCount], type);
    }
}

export function breakCombo() {
    if (comboCount > 0) {
        notify('Combo broken!', 'normal', `${comboCount}x`);
    }
    comboCount = 0;
    if (comboTimer) clearTimeout(comboTimer);
    updateComboUI();
}

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
    multEl.innerText = `×${getComboMult().toFixed(2)}`;
}
