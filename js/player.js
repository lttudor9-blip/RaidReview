/* ============================================ */
/* PLAYER CONTROLLER                            */
/* player.js                                    */
/* ============================================ */

import { CLASSES, SUPPORT_CLASSES, DEFAULT_QUESTIONS } from './config.js';
import { getData, updateData, listenData, setupDisconnect } from './firebase.js';
import { show, hide, showView, setText, setStyle, setHTML, toggleVisible, getInputValue, setDisabled, setTargetingMode, makeRosterTargetable, clearRosterTargetable } from './ui.js';
import { shake, flash, spawnDamage, notify, hitMarker, showStreak, showReceivedEffect, showLowHpWarning, pulseRosterCard, showSupportAction, showBossWarning, hideBossWarning, getFlavorText } from './juice.js';
import { getComboMult, incrementCombo, breakCombo } from './combo.js';

let roomCode = null;
let playerId = null;
let playerName = null;
let playerClass = null;
let localState = null;
let currentQuestion = null;
let deathQuestion = null;
let isDeadLocal = false;
let deathStreak = 0;
let specialCooldown = 0;
let isInputLocked = false;
let isTargetingMode = false;
let pendingAbility = null;
let prevHealth = null;
let prevShield = null;
let prevBuff = null;
let lastBossAttackTimestamp = 0;
let currentBossWarning = null;
let lastChaosEventTimestamp = 0;

export function getRoomCode() { return roomCode; }
export function getLocalState() { return localState; }
export function isDead() { return isDeadLocal; }

function applyClassTheme(cls) {
    const gameContainer = document.querySelector('.game-container');
    if (!gameContainer) return;
    gameContainer.classList.remove('class-themed', 'warrior', 'guardian', 'medic', 'tactician');
    gameContainer.classList.add('class-themed', cls.toLowerCase());
}

export async function joinLobby() {
    const name = getInputValue('input-name');
    const code = getInputValue('input-room');
    if (!name || code.length !== 6) { alert('Enter name and 6-digit code'); return false; }
    try {
        const gameData = await getData(`games/${code}`);
        if (gameData) { roomCode = code; playerName = name; showView('view-class-select'); return true; }
        else { alert('Room not found'); return false; }
    } catch (e) { alert('Connection error'); return false; }
}

export async function selectClass(cls) {
    playerClass = cls; playerId = `${playerName}_${Date.now()}`;
    const stats = CLASSES[cls];
    setText('lbl-basic-name', stats.basic.name);
    setText('lbl-basic-dmg', `${stats.basic.dmg} DMG`);
    setText('lbl-special-name', stats.special.name);
    setText('lbl-special-desc', stats.special.desc);
    setText('ult-btn-name', `⚡ ${stats.ultName} ⚡`);
    setText('waiting-class-name', cls);
    applyClassTheme(cls);
    setupDisconnect(`games/${roomCode}/players/${playerId}`);
    await updateData(`games/${roomCode}/players/${playerId}`, { id: playerId, name: playerName, class: cls, health: stats.hp, maxHealth: stats.hp, ultimateCharge: 0 });
    showView('view-waiting');
    listenToGame();
}

function listenToGame() {
    listenData(`games/${roomCode}`, (data) => {
        if (!data) return;
        localState = data;
        if (data.status === 'ACTIVE' && !isDeadLocal) {
            const gameView = document.getElementById('view-game');
            if (gameView?.classList.contains('hidden')) loadQuestion();
            showView('view-game');
            renderGame(data);
        } else if (data.status === 'WAVE_CLEAR') {
            handleWaveClear(data);
        } else if (data.status === 'PAUSED') show('view-pause-overlay');
        else if (data.status === 'VICTORY' || data.status === 'DEFEAT') endGame(data.status);
        if (data.status !== 'PAUSED') hide('view-pause-overlay');
    });
}

function loadQuestion() {
    show('panel-question'); hide('panel-action');
    
    let questions = localState?.questions;
    
    // Handle Firebase object-as-array conversion
    if (questions && typeof questions === 'object' && !Array.isArray(questions)) {
        questions = Object.values(questions);
    }
    
    // Fallback if empty or undefined
    if (!questions || questions.length === 0) {
        questions = DEFAULT_QUESTIONS;
    }

    currentQuestion = questions[Math.floor(Math.random() * questions.length)];
    
    // Ensure currentQuestion is valid
    if (!currentQuestion) {
        currentQuestion = DEFAULT_QUESTIONS[0];
    }

    setText('question-text', currentQuestion.text || 'Error loading question text');
    const answers = currentQuestion.answers || ['-', '-', '-', '-'];
    [0,1,2,3].forEach(i => setText(`game-answer-${i}`, answers[i] || ''));
    
    document.querySelectorAll('#answers-grid .answer-btn').forEach(btn => { btn.classList.remove('correct', 'incorrect'); btn.disabled = false; });
}

export async function submitAnswer(idx, btn) {
    if (isDeadLocal) { handleDeathAnswer(idx); return; }
    document.querySelectorAll('#answers-grid .answer-btn').forEach(b => b.disabled = true);
    if (idx === currentQuestion.correct) {
        btn?.classList.add('correct'); incrementCombo(); flash('#2ed573', 150); hitMarker(); spawnDamage('CORRECT!', { color: '#2ed573', size: '2rem' }); notify('Correct answer!', 'normal', `+${getComboMult()}x`);
        setTimeout(() => { hide('panel-question'); show('panel-action'); updateActionUI(); }, 500);
    } else {
        btn?.classList.add('incorrect'); breakCombo(); flash('#ff4757', 200); shake(); spawnDamage('WRONG!', { color: '#ff4757', size: '2rem' });
        const me = localState?.players?.[playerId];
        if (me) {
            let damage = Math.floor(me.maxHealth * 0.1);
            const updates = {};
            if ((me.shield || 0) > 0) {
                if (me.shield >= damage) { updates.shield = me.shield - damage; damage = 0; }
                else { damage -= me.shield; updates.shield = 0; }
            }
            if (damage > 0) updates.health = Math.max(0, me.health - damage);
            await updateData(`games/${roomCode}/players/${playerId}`, updates);
            if ((updates.health || me.health) <= 0) setTimeout(() => initDeath(), 500);
        }
        setTimeout(() => loadQuestion(), 1000);
    }
}

function updateActionUI() {
    const me = localState?.players?.[playerId];
    const hasUlt = me.ultimateCharge >= 100;
    toggleVisible('btn-ult', hasUlt); toggleVisible('ult-placeholder', !hasUlt);
    setText('ult-placeholder', `CHARGING... ${me.ultimateCharge}%`);
    if (specialCooldown > 0) { setDisabled('btn-special', true); setText('lbl-special-desc', `COOLDOWN ${specialCooldown}`); }
    else { setDisabled('btn-special', false); setText('lbl-special-desc', CLASSES[playerClass].special.desc); }
}

export async function performAction(type, btn) {
    if (isInputLocked) return;
    const me = localState?.players?.[playerId];
    const stats = CLASSES[playerClass];
    const mult = getComboMult();
    if (type === 'special' && SUPPORT_CLASSES.includes(playerClass)) { enterTargetingMode(stats.special.type); return; }
    isInputLocked = true; let damage = 0; const updates = {};
    const hasBuff = me.buff && me.buff.damageBonus;
    const buffMult = hasBuff ? me.buff.damageBonus : 1;
    flash(stats.color, 100); hitMarker(type === 'ult' || type === 'special' || hasBuff);
    
    if (type === 'basic') {
        damage = Math.floor(stats.basic.dmg * mult * buffMult);
        const armorShattered = localState?.enemy?.armorShattered;
        if (armorShattered && armorShattered.active && Date.now() < armorShattered.endTime) damage = Math.floor(damage * armorShattered.multiplier);
        updates[`players/${playerId}/ultimateCharge`] = Math.min(100, (me.ultimateCharge || 0) + 15);
        shake();
        if (hasBuff) {
            spawnDamage(damage.toString(), { color: '#a55eea', size: '3.5rem', isCrit: true });
            spawnDamage('BOOSTED!', { color: '#a55eea', size: '2rem' });
            updates[`players/${playerId}/buff`] = null;
        } else {
            spawnDamage(damage.toString(), { color: '#ffa502', size: '3rem' });
            spawnDamage(getFlavorText('hit'), { color: '#fff', size: '1.5rem' });
        }
    } else if (type === 'special') {
        damage = Math.floor(stats.special.dmg * mult * buffMult);
        const armorShattered = localState?.enemy?.armorShattered;
        if (armorShattered && armorShattered.active && Date.now() < armorShattered.endTime) damage = Math.floor(damage * armorShattered.multiplier);
        shake('heavy');
        if(hasBuff) {
            spawnDamage(damage.toString(), { color: '#a55eea', size: '4rem', isCrit: true });
            updates[`players/${playerId}/buff`] = null;
        } else {
            spawnDamage(damage.toString(), { color: '#ff6b81', size: '3.5rem', isCrit: true });
        }
        specialCooldown = stats.specialCooldown || 3;
    } else if (type === 'ult') {
        const ultConfig = stats.ultimate;
        updates[`players/${playerId}/ultimateCharge`] = 0;
        if(hasBuff) updates[`players/${playerId}/buff`] = null;
        if (ultConfig.type === 'damage') {
            const isCombo = localState?.enemy?.armorShattered && ultConfig.comboCondition === 'armorShattered';
            damage = Math.floor((isCombo ? ultConfig.comboDamage : ultConfig.baseDamage) * mult * buffMult);
            shake('heavy'); flash('#ff4757', 500); 
            spawnDamage(damage.toString(), { color: '#ff6b81', size: '6rem', isCrit: true }); 
            if(isCombo) {
                spawnDamage('💥 CRITICAL SHATTER!', { color: '#fff', size: '3rem', isCrit: true });
                showStreak('💥 CRITICAL SHATTER!', 'legendary');
                if(ultConfig.consumesDebuff) updates['enemy/armorShattered'] = null;
            } else {
                spawnDamage(stats.ultName, { color: '#fff', size: '2rem' });
                showStreak(stats.ultName, 'legendary');
            }
        } else if (ultConfig.type === 'protection') {
            updates['ironDome'] = { active: true, endTime: Date.now() + ultConfig.duration, casterId: playerId, casterName: playerName };
            shake('heavy'); flash('#3742fa', 500); spawnDamage('🛡 IRON DOME ACTIVE!', { color: '#3742fa', size: '4rem', isCrit: true }); showStreak('IRON DOME!', 'legendary');
        } else if (ultConfig.type === 'massHeal') {
            const allPlayers = localState?.players || {};
            Object.keys(allPlayers).forEach(pid => {
                const p = allPlayers[pid];
                if (p.health <= 0) updates[`players/${pid}/health`] = Math.floor(p.maxHealth * ultConfig.revivePercent);
                else updates[`players/${pid}/health`] = Math.min(p.maxHealth, p.health + Math.floor(p.maxHealth * ultConfig.healPercent));
            });
            shake('heavy'); flash('#2ed573', 500); spawnDamage('🏥 FIELD HOSPITAL!', { color: '#2ed573', size: '4rem', isCrit: true }); showStreak('FIELD HOSPITAL!', 'legendary');
        } else if (ultConfig.type === 'debuff') {
            updates['enemy/armorShattered'] = { active: true, endTime: Date.now() + ultConfig.duration, multiplier: ultConfig.damageMultiplier, casterId: playerId, casterName: playerName };
            shake('heavy'); flash('#a55eea', 500); spawnDamage('💥 ARMOR SHATTERED!', { color: '#a55eea', size: '4rem', isCrit: true }); showStreak('ARMOR SHATTERED!', 'legendary');
        }
    }

    if (damage > 0) updates['enemy/health'] = Math.max(0, localState.enemy.health - damage);
    await updateData(`games/${roomCode}`, updates);
    setTimeout(() => { isInputLocked = false; if (specialCooldown > 0) specialCooldown--; loadQuestion(); }, 1500);
}

function enterTargetingMode(abilityType) {
    isTargetingMode = true; pendingAbility = abilityType;
    setTargetingMode(true);
    makeRosterTargetable(playerId, abilityType, selectTarget);
    setText('lbl-special-desc', 'SELECT TARGET');
}

function exitTargetingMode() {
    isTargetingMode = false; pendingAbility = null;
    clearRosterTargetable();
    setText('lbl-special-desc', CLASSES[playerClass].special.desc);
}

async function selectTarget(targetPlayerId) {
    if (!isTargetingMode || !pendingAbility) return;
    const stats = CLASSES[playerClass];
    const target = localState?.players?.[targetPlayerId];
    if (!target) { exitTargetingMode(); return; }
    isInputLocked = true; const abilityType = pendingAbility; exitTargetingMode();
    const updates = {}; let effectValue = 0;
    if (abilityType === 'heal') {
        const healAmount = Math.floor(target.maxHealth * stats.special.amount);
        const newHealth = Math.min(target.maxHealth, target.health + healAmount);
        effectValue = newHealth - target.health;
        updates[`players/${targetPlayerId}/health`] = newHealth;
        flash('#2ed573', 200); notify(`Healed ${target.name}`, 'heal', `+${effectValue}`);
    } else if (abilityType === 'shield') {
        updates[`players/${targetPlayerId}/shield`] = (target.shield || 0) + stats.special.amount;
        effectValue = stats.special.amount;
        flash('#3742fa', 200); notify(`Shielded ${target.name}`, 'normal', `+${effectValue}`);
    } else if (abilityType === 'buff') {
        updates[`players/${targetPlayerId}/buff`] = { damageBonus: stats.special.damageBonus, source: playerName };
        flash('#a55eea', 200); notify(`Buffed ${target.name}`, 'normal', '+50% DMG');
    }
    const actionId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    updates[`actionLog/${actionId}`] = { type: abilityType, caster: playerName, casterClass: playerClass, target: target.name, value: effectValue, timestamp: Date.now() };
    showSupportAction(abilityType, target.name);
    pulseRosterCard(targetPlayerId, abilityType);
    updates[`players/${playerId}/ultimateCharge`] = Math.min(100, (localState.players[playerId].ultimateCharge || 0) + 20);
    specialCooldown = stats.specialCooldown || 3;
    shake('heavy'); hitMarker(true);
    await updateData(`games/${roomCode}`, updates);
    setTimeout(() => { isInputLocked = false; if (specialCooldown > 0) specialCooldown--; loadQuestion(); }, 1500);
}

export function cancelTargeting() { if (isTargetingMode) exitTargetingMode(); }

function renderGame(data) {
    const me = data.players?.[playerId];
    if (!me) return;
    if (me.health <= 0 && !isDeadLocal) { initDeath(); return; }
    if (me.health > 0 && isDeadLocal) revive();
    detectIncomingEffects(me);
    handleBossAttack(data.bossAttack);
    handleChaosEvent(data.chaosEvent);
    const hpPercent = (me.health / me.maxHealth) * 100;
    setStyle('hud-hp-bar', 'width', `${hpPercent}%`);
    setText('hp-text', me.health);
    setStyle('hud-ult-bar', 'width', `${me.ultimateCharge}%`);
    setText('ult-text', `${me.ultimateCharge}%`);
    showLowHpWarning(hpPercent > 0 && hpPercent <= 25);
    const ironDomeActive = data.ironDome && data.ironDome.active && Date.now() < data.ironDome.endTime;
    document.querySelector('.game-container')?.classList.toggle('iron-dome-active', ironDomeActive);
    const armorShatteredActive = data.enemy?.armorShattered && data.enemy.armorShattered.active && Date.now() < data.enemy.armorShattered.endTime;
    updateStatusBanner(armorShatteredActive, data.enemy?.armorShattered, ironDomeActive, data.ironDome);
    setHTML('game-roster', Object.values(data.players).map(p => {
        const isTargeted = isPlayerTargeted(data.bossAttack, p.id);
        const classData = CLASSES[p.class];
        return `
            <div class="squad-card ${isTargeted ? 'boss-targeted' : ''}" data-player-id="${p.id}" data-player-health="${p.health}" style="border-left: 3px solid ${classData.color}">
                <div class="flex items-center gap-3">
                    <div class="flex-1">
                        <div class="font-bold text-sm flex items-center gap-2">
                            ${isTargeted ? '<span class="text-warrior animate-pulse">⚠️</span>' : ''} ${p.name}
                            ${(p.shield > 0) ? '<span class="text-guardian text-xs">🛡</span>' : ''}
                            ${(p.buff && p.buff.damageBonus) ? '<span class="text-tactician text-xs">⚡</span>' : ''}
                        </div>
                        <div class="h-1.5 bg-gray-800 rounded mt-1 relative overflow-hidden">
                            <div class="h-full rounded absolute left-0 top-0" style="width: ${(p.health/p.maxHealth)*100}%; background: ${p.health <= 0 ? '#ff4757' : classData.color}"></div>
                            ${(p.shield > 0) ? `<div class="h-full rounded absolute left-0 top-0 bg-guardian/50" style="width: ${Math.min(100, (p.shield/p.maxHealth)*100)}%"></div>` : ''}
                        </div>
                    </div>
                    <div class="text-xs text-gray-400">${Math.round((p.health/p.maxHealth)*100)}%</div>
                </div>
            </div>`;
    }).join(''));
    if (isTargetingMode && pendingAbility) makeRosterTargetable(playerId, pendingAbility, selectTarget);
}

function updateStatusBanner(armor, armorData, dome, domeData) {
    const banner = document.getElementById('status-banner');
    if (!banner) return;
    const icon = document.getElementById('status-banner-icon');
    const title = document.getElementById('status-banner-title');
    const sub = document.getElementById('status-banner-subtitle');
    const timer = document.getElementById('status-banner-timer');
    
    if (armor) {
        const timeLeft = Math.ceil((armorData.endTime - Date.now()) / 1000);
        icon.textContent = '💥'; title.textContent = 'ARMOR SHATTERED'; sub.textContent = '+50% DAMAGE'; timer.textContent = `${timeLeft}s`;
        banner.classList.remove('iron-dome', 'hidden'); banner.classList.add('armor-shattered', 'visible');
        if (timeLeft <= 5) banner.classList.add('urgent'); else banner.classList.remove('urgent');
    } else if (dome) {
        const timeLeft = Math.ceil((domeData.endTime - Date.now()) / 1000);
        icon.textContent = '🛡'; title.textContent = 'IRON DOME ACTIVE'; sub.textContent = 'INVULNERABLE'; timer.textContent = `${timeLeft}s`;
        banner.classList.remove('armor-shattered', 'hidden'); banner.classList.add('iron-dome', 'visible');
        if (timeLeft <= 5) banner.classList.add('urgent'); else banner.classList.remove('urgent');
    } else {
        banner.classList.remove('visible', 'armor-shattered', 'iron-dome', 'urgent'); banner.classList.add('hidden');
    }
}

function isPlayerTargeted(bossAttack, pid) {
    if (!bossAttack?.targets) return false;
    if (bossAttack.type === 'aoe') return true;
    return bossAttack.targets.some(t => t.id === pid);
}

function handleBossAttack(attack) {
    if (!attack || !attack.timestamp) { if (currentBossWarning) { hideBossWarning(); currentBossWarning = null; } return; }
    if (attack.timestamp === lastBossAttackTimestamp) return;
    lastBossAttackTimestamp = attack.timestamp; currentBossWarning = attack;
    
    if (attack.type === 'enrage') { showBossWarning(attack.warningText, attack.icon, 0, false); flash('#ff4757', 500); shake('heavy'); notify('BOSS ENRAGED!', 'crit', '2x DAMAGE'); return; }
    if (attack.type === 'phase_change') { showBossWarning(attack.warningText, attack.icon, 0, false); flash(attack.phase === 'DESPERATE' ? '#ff4757' : '#ffa502', 500); shake('heavy'); return; }
    if (attack.type === 'timer_enrage') { showBossWarning(attack.warningText, attack.icon, 0, false); flash('#ff4757', 800); shake('heavy'); notify('TIME EXPIRED!', 'crit', '2x DAMAGE & SPEED'); return; }

    const isTargeted = isPlayerTargeted(attack, playerId);
    const timeUntilHit = attack.resolveAt - Date.now();
    let targetText = attack.type === 'aoe' ? 'ALL PLAYERS' : (attack.targets ? attack.targets.map(t => t.name).join(', ') : '');
    showBossWarning(`${attack.warningText}: ${targetText}`, attack.icon, Math.max(0, timeUntilHit), isTargeted);
    if (isTargeted) { flash('#ff4757', 200); shake(); notify(`${attack.icon} INCOMING ATTACK!`, 'crit', `${Math.ceil(timeUntilHit/1000)}s`); }
}

function handleChaosEvent(event) {
    if (!event || !event.timestamp) return;
    if (event.timestamp === lastChaosEventTimestamp) return;
    lastChaosEventTimestamp = event.timestamp;
    if (event.type === 'meteor_strike') {
        showBossWarning('☄️ METEOR STRIKE!', '☄️', 0, true); flash('#ff4757', 800); shake('heavy');
        spawnDamage('☄️ METEOR!', { color: '#ff4757', size: '5rem', isCrit: true }); spawnDamage('-20% HP', { color: '#ff4757', size: '3rem' }); notify('TEACHER INTERVENTION!', 'crit', '-20% HP');
    } else if (event.type === 'shield_drain') {
        showBossWarning('🔮 SHIELDS DRAINED!', '🔮', 0, true); flash('#3742fa', 800); shake('heavy');
        spawnDamage('🔮 DRAINED!', { color: '#3742fa', size: '5rem', isCrit: true }); notify('SHIELDS DRAINED!', 'crit', 'ALL SHIELDS GONE');
    }
}

function detectIncomingEffects(me) {
    if (prevHealth === null) { prevHealth = me.health; prevShield = me.shield || 0; prevBuff = me.buff; return; }
    if (me.health > prevHealth && prevHealth > 0 && (me.health - prevHealth >= 100)) { showReceivedEffect('heal', 'ALLY', me.health - prevHealth); pulseRosterCard(playerId, 'heal'); }
    if ((me.shield || 0) > prevShield) { showReceivedEffect('shield', 'ALLY', (me.shield || 0) - prevShield); pulseRosterCard(playerId, 'shield'); }
    if (me.buff && me.buff.damageBonus && (!prevBuff || !prevBuff.damageBonus)) { showReceivedEffect('buff', me.buff.source || 'ALLY', null); pulseRosterCard(playerId, 'buff'); }
    prevHealth = me.health; prevShield = me.shield || 0; prevBuff = me.buff;
}

function initDeath() { isDeadLocal = true; deathStreak = 0; show('view-death-overlay'); updateDeathUI(); loadDeathQuestion(); }
function revive() { isDeadLocal = false; hide('view-death-overlay'); }

function loadDeathQuestion() {
    let questions = localState?.questions;
    if (questions && typeof questions === 'object' && !Array.isArray(questions)) {
        questions = Object.values(questions);
    }
    if (!questions || questions.length === 0) questions = DEFAULT_QUESTIONS;
    
    let q = questions[Math.floor(Math.random() * questions.length)];
    if (!q) q = DEFAULT_QUESTIONS[0];

    deathQuestion = q; 
    setText('death-question-text', q.text || 'Error loading question');
    
    const answers = q.answers || ['A', 'B', 'C', 'D'];
    document.querySelectorAll('#death-answers-grid .answer-btn').forEach((btn, i) => btn.innerText = answers[i] || '-');
}

async function handleDeathAnswer(idx) {
    if (idx === deathQuestion.correct) {
        deathStreak++; flash('#2ed573', 150); updateDeathUI();
        if (deathStreak >= 3) {
            const me = localState?.players?.[playerId];
            if (me) { await updateData(`games/${roomCode}/players/${playerId}`, { health: Math.floor(me.maxHealth * 0.5) }); revive(); loadQuestion(); }
        } else loadDeathQuestion();
    } else { deathStreak = 0; flash('#ff4757', 200); shake(); updateDeathUI(); loadDeathQuestion(); }
}

function updateDeathUI() {
    [1,2,3].forEach(i => {
        const seg = document.getElementById(`reboot-seg-${i}`);
        if(seg) { seg.style.background = i <= deathStreak ? '#3742fa' : '#1a1a2e'; seg.style.boxShadow = i <= deathStreak ? '0 0 10px #3742fa' : 'none'; }
    });
}

function handleWaveClear(data) {
    showView('view-game'); showStreak('WAVE CLEARED!', 'legendary'); flash('#ffa502', 500); shake('heavy');
    if (data.nextWaveInfo) { spawnDamage(`WAVE ${data.nextWaveInfo.waveNum}`, { color: '#fff', size: '2rem' }); spawnDamage(data.nextWaveInfo.bossName, { color: '#ff4757', size: '3rem', isCrit: true }); notify('Wave Complete!', 'ult', `+25% Ultimate`); notify('Health Restored!', 'heal', 'FULL HP'); }
}

function endGame(status) {
    showView('view-game-over');
    setHTML('game-over-content', status === 'VICTORY' ? 
        `<h1 class="text-6xl font-black text-medic mb-4" style="font-family: 'Orbitron';">VICTORY!</h1><button onclick="location.reload()" class="landing-btn primary mt-8">RETURN</button>` : 
        `<h1 class="text-6xl font-black text-warrior mb-4" style="font-family: 'Orbitron';">DEFEAT</h1><button onclick="location.reload()" class="landing-btn secondary mt-8">RETRY</button>`);
}
