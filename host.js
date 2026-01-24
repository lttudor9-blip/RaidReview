/* ============================================ */
/* HOST CONTROLLER                              */
/* host.js                                      */
/* ============================================ */

import { CLASSES, WAVES, BOSS_PHASES, TIMER_ENRAGE, DEFAULT_QUESTIONS } from './config.js';
import { setData, updateData, listenData, generateRoomCode } from './firebase.js';
import { show, hide, showView, setText, setStyle, setHTML, toggleVisible } from './ui.js';
import { shake, flash, spawnDamage, notify } from './juice.js';
import { openBattleSetManager } from './battleset.js';

let roomCode = null;
let localState = null;
let lastEnemyHealth = 0;
let lastActionLogLength = 0;
let bossAttackTimers = [];
let attackCooldowns = {};
let raidStartTime = null;
let isEnraged = false;
let waveTimerInterval = null;
let waveStartTime = null;
let waveTimeLimit = null;
let timerEnraged = false;
let currentPhase = 'NORMAL';
let chaosModeEnabled = false;
let meteorCooldownTimer = null;
let drainCooldownTimer = null;
const CHAOS_COOLDOWN = 15000;

export function getRoomCode() { return roomCode; }
export function getLocalState() { return localState; }

export async function initHost(questions) {
    roomCode = generateRoomCode();
    const wave = WAVES[0];
    
    // Ensure questions is a valid array with items to prevent game breakage
    let validQuestions = questions;
    if (!validQuestions || !Array.isArray(validQuestions) || validQuestions.length === 0) {
        validQuestions = DEFAULT_QUESTIONS;
    }

    const data = {
        roomCode: roomCode, status: 'LOBBY', currentWave: 1,
        enemy: { name: wave.name, health: wave.hp, maxHealth: wave.hp, img: wave.img, phase: 'NORMAL' },
        players: {}, questions: validQuestions
    };
    localState = data; lastEnemyHealth = wave.hp;
    await setData(`games/${roomCode}`, data);
    setText('host-room-code', roomCode);
    showView('view-host');
    show('btn-start-raid');
    listenData(`games/${roomCode}`, (data) => { if (data) { localState = data; renderHost(data); } });
    return roomCode;
}

function renderHost(data) {
    const hpPercent = (data.enemy.health / data.enemy.maxHealth) * 100;
    setStyle('host-boss-bar', 'width', `${hpPercent}%`);
    setText('host-boss-hp-text', `${Math.ceil(hpPercent)}%`);
    setText('host-boss-name', data.enemy.name);
    setText('host-wave-num', data.currentWave);
    updateBossPhaseDisplay(data.enemy);
    const img = document.getElementById('host-boss-img');
    if (img && img.src !== data.enemy.img) img.src = data.enemy.img;
    if (data.enemy.health < lastEnemyHealth) {
        const dmg = lastEnemyHealth - data.enemy.health;
        spawnDamage(dmg.toString(), { layer: 'host-damage-layer', size: dmg > 5000 ? '4rem' : '2.5rem', isCrit: dmg > 5000, color: dmg > 5000 ? '#ff6b81' : '#ffa502' });
        if (dmg > 2000) shake(dmg > 10000 ? 'heavy' : 'normal');
    }
    lastEnemyHealth = data.enemy.health;
    checkBossPhase(data.enemy);
    const players = Object.values(data.players || {});
    setText('host-player-count', players.length);
    setHTML('jumbo-vitals-grid', players.map(p => {
        const pct = p.health / p.maxHealth;
        const color = p.health <= 0 ? '#ff4757' : pct < 0.5 ? '#ffa502' : '#2ed573';
        return `<div class="w-3 h-3 rounded-full" style="background: ${color}"></div>`;
    }).join(''));
    renderActionFeed(data.actionLog);
    setHTML('jumbo-top-list', players.sort((a, b) => (b.ultimateCharge || 0) - (a.ultimateCharge || 0)).slice(0, 3).map((p, i) => `
        <div class="flex justify-between text-sm">
            <span class="text-gray-400">${i + 1}. ${p.name}</span>
            <span class="text-gold">${p.ultimateCharge || 0}%</span>
        </div>`).join(''));
    toggleVisible('btn-start-raid', data.status === 'LOBBY');
    toggleVisible('status-display', data.status !== 'LOBBY');
    if (data.status === 'ACTIVE' && data.enemy.health <= 0) nextWave(data);
}

function updateBossPhaseDisplay(enemy) {
    const phaseEl = document.getElementById('host-boss-phase');
    const bossBar = document.getElementById('host-boss-bar');
    const bossImg = document.getElementById('host-boss-img');
    const phase = enemy.phase || 'NORMAL';
    if (phaseEl) {
        if (phase === 'NORMAL') phaseEl.classList.add('hidden');
        else {
            phaseEl.classList.remove('hidden');
            phaseEl.textContent = phase;
            phaseEl.className = `boss-phase-indicator ${phase.toLowerCase()}`;
        }
    }
    if (bossBar) {
        bossBar.classList.remove('phase-normal', 'phase-enraged', 'phase-desperate', 'timer-enraged');
        if (timerEnraged) bossBar.classList.add('timer-enraged');
        else if (phase === 'ENRAGED') bossBar.classList.add('phase-enraged');
        else if (phase === 'DESPERATE') bossBar.classList.add('phase-desperate');
    }
    if (bossImg) {
        bossImg.classList.remove('phase-normal', 'phase-enraged', 'phase-desperate', 'timer-enraged');
        if (timerEnraged) bossImg.classList.add('timer-enraged');
        else if (phase !== 'NORMAL') bossImg.classList.add(`phase-${phase.toLowerCase()}`);
    }
}

async function checkBossPhase(enemy) {
    const hpPercent = enemy.health / enemy.maxHealth;
    let newPhase = 'NORMAL';
    if (hpPercent <= BOSS_PHASES.DESPERATE.threshold) newPhase = 'DESPERATE';
    else if (hpPercent <= BOSS_PHASES.ENRAGED.threshold) newPhase = 'ENRAGED';
    if (newPhase !== currentPhase) {
        currentPhase = newPhase;
        await updateData(`games/${roomCode}`, { 'enemy/phase': newPhase });
        if (newPhase !== 'NORMAL') announceBossPhase(newPhase);
    }
}

async function announceBossPhase(phase) {
    const phaseConfig = BOSS_PHASES[phase];
    await updateData(`games/${roomCode}`, { 'bossAttack': { type: 'phase_change', phase: phase, warningText: phase === 'DESPERATE' ? 'BOSS IS DESPERATE!' : 'BOSS ENRAGED!', icon: phase === 'DESPERATE' ? '💀' : '🔥', timestamp: Date.now() } });
    flash(phaseConfig.color, 500); shake('heavy');
    spawnDamage(phase === 'DESPERATE' ? '💀 DESPERATE!' : '🔥 ENRAGED!', { layer: 'host-damage-layer', color: phaseConfig.color, size: '4rem', isCrit: true });
    notify(phase === 'DESPERATE' ? 'BOSS IS DESPERATE!' : 'BOSS ENRAGED!', 'crit', phase === 'DESPERATE' ? 'TARGETING WEAKEST' : '+50% SPEED');
}

function renderActionFeed(actionLog) {
    const feed = document.getElementById('host-action-feed');
    if (!feed) return;
    if (!actionLog || Object.keys(actionLog).length === 0) { feed.innerHTML = '<div class="text-gray-600 text-xs text-center py-2">No actions yet</div>'; return; }
    const actions = Object.values(actionLog).sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);
    const hasNewAction = actions.length > lastActionLogLength;
    lastActionLogLength = actions.length;
    const actionConfig = { heal: { icon: '💚', color: '#2ed573', label: 'HEAL' }, shield: { icon: '🛡', color: '#3742fa', label: 'SHIELD' }, buff: { icon: '⚡', color: '#a55eea', label: 'BUFF' } };
    feed.innerHTML = actions.map((action, index) => {
        const cfg = actionConfig[action.type] || actionConfig.heal;
        const isNew = hasNewAction && index === 0;
        return `<div class="action-feed-item ${isNew ? 'new' : ''}" style="border-left-color: ${cfg.color}"><div class="flex items-center gap-2"><span class="text-lg">${cfg.icon}</span><div class="flex-1 min-w-0"><div class="text-sm truncate"><span style="color: ${CLASSES[action.casterClass]?.color || '#888'}">${action.caster}</span><span class="text-gray-500">→</span><span class="text-white">${action.target}</span></div><div class="text-xs text-gray-500">${cfg.label}${action.value ? ` +${action.value}` : ''}</div></div></div></div>`;
    }).join('');
}

function startWaveTimer() {
    stopWaveTimer();
    const wave = WAVES[(localState?.currentWave || 1) - 1];
    if (!wave?.timeLimit) return;
    waveStartTime = Date.now();
    waveTimeLimit = wave.timeLimit;
    timerEnraged = false;
    waveTimerInterval = setInterval(() => {
        if (localState?.status !== 'ACTIVE') return;
        const elapsed = Date.now() - waveStartTime;
        const remaining = Math.max(0, waveTimeLimit - elapsed);
        updateTimerDisplay(remaining);
        if (remaining <= 0 && !timerEnraged) triggerTimerEnrage();
    }, 100);
}

function stopWaveTimer() {
    if (waveTimerInterval) { clearInterval(waveTimerInterval); waveTimerInterval = null; }
    waveStartTime = null; waveTimeLimit = null;
}

function updateTimerDisplay(remaining) {
    const timerEl = document.getElementById('host-wave-timer');
    const timerContainer = document.getElementById('host-timer-container');
    if (!timerEl || !timerContainer) return;
    const seconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timerEl.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
    if (seconds <= 30 && seconds > 0) { timerContainer.classList.add('timer-warning'); timerContainer.classList.remove('timer-expired'); }
    else if (seconds <= 0) { timerContainer.classList.remove('timer-warning'); timerContainer.classList.add('timer-expired'); }
    else { timerContainer.classList.remove('timer-warning', 'timer-expired'); }
}

async function triggerTimerEnrage() {
    timerEnraged = true;
    await updateData(`games/${roomCode}`, { 'bossAttack': { type: 'timer_enrage', warningText: 'TIME EXPIRED - BOSS ENRAGED!', icon: '⏰', timestamp: Date.now() }, 'timerEnraged': true });
    flash('#ff4757', 800); shake('heavy'); spawnDamage('⏰ TIME UP!', { layer: 'host-damage-layer', color: '#ff4757', size: '4rem', isCrit: true });
    spawnDamage('BOSS ENRAGED!', { layer: 'host-damage-layer', color: '#ff4757', size: '3rem' }); notify('TIME EXPIRED!', 'crit', '2x DAMAGE & SPEED');
}

async function nextWave(data) {
    stopBossAttacks(); stopWaveTimer();
    const nextWaveNum = (data.currentWave || 1) + 1;
    if (nextWaveNum > WAVES.length) { await updateData(`games/${roomCode}`, { status: 'VICTORY', bossAttack: null, timerEnraged: null }); return; }
    const wave = WAVES[nextWaveNum - 1];
    const playerCount = Math.max(1, Object.keys(data.players || {}).length);
    const scaledHp = wave.hp + wave.scale * playerCount;
    await updateData(`games/${roomCode}`, { status: 'WAVE_CLEAR', bossAttack: null, timerEnraged: null, nextWaveInfo: { waveNum: nextWaveNum, bossName: wave.name, bossImg: wave.img } });
    flash('#ffa502', 500); shake('heavy'); spawnDamage('WAVE CLEARED!', { layer: 'host-damage-layer', color: '#ffa502', size: '4rem', isCrit: true }); notify('Wave Complete!', 'ult', `Wave ${nextWaveNum} incoming`);
    currentPhase = 'NORMAL'; timerEnraged = false;
    setTimeout(async () => {
        const updates = { status: 'ACTIVE', currentWave: nextWaveNum, enemy: { name: wave.name, health: scaledHp, maxHealth: scaledHp, img: wave.img, phase: 'NORMAL' }, bossAttack: null, nextWaveInfo: null, timerEnraged: null };
        Object.keys(data.players || {}).forEach(pid => { updates[`players/${pid}/health`] = data.players[pid].maxHealth; updates[`players/${pid}/ultimateCharge`] = Math.min(100, (data.players[pid].ultimateCharge || 0) + 25); updates[`players/${pid}/shield`] = 0; });
        await updateData(`games/${roomCode}`, updates);
        if (localState?.status === 'ACTIVE') { startBossAttacks(); startWaveTimer(); }
    }, 3000);
}

function getPhaseMultipliers() {
    if (timerEnraged) return { speedMult: TIMER_ENRAGE.speedMult, damageMult: TIMER_ENRAGE.damageMult };
    const phaseConfig = BOSS_PHASES[currentPhase] || BOSS_PHASES.NORMAL;
    return { speedMult: phaseConfig.speedMult, damageMult: phaseConfig.damageMult };
}

function startBossAttacks() {
    stopBossAttacks();
    const wave = WAVES[(localState?.currentWave || 1) - 1];
    if (!wave?.attacks) return;
    raidStartTime = Date.now(); isEnraged = false; attackCooldowns = {};
    wave.attacks.forEach((a, i) => attackCooldowns[i] = Date.now() + a.cooldown * 0.5);
    const mainTimer = setInterval(() => {
        if (localState?.status !== 'ACTIVE') { stopBossAttacks(); return; }
        const { speedMult, damageMult } = getPhaseMultipliers();
        wave.attacks.forEach((a, i) => {
            if (Date.now() >= attackCooldowns[i]) {
                const modifiedAttack = { ...a };
                if (currentPhase === 'DESPERATE' && BOSS_PHASES.DESPERATE.targetLowest) modifiedAttack.type = 'lowest_hp';
                executeBossAttack(modifiedAttack, damageMult);
                attackCooldowns[i] = Date.now() + (a.cooldown / speedMult);
            }
        });
    }, 1000);
    bossAttackTimers.push(mainTimer);
}

function stopBossAttacks() { bossAttackTimers.forEach(t => clearInterval(t)); bossAttackTimers = []; attackCooldowns = {}; }

async function executeBossAttack(attack, damageMult = 1) {
    const players = Object.entries(localState?.players || {}).filter(([id, p]) => p.health > 0);
    if (players.length === 0) return;
    let targets = [];
    if (attack.type === 'aoe') targets = players.map(([id, p]) => ({ id, name: p.name, maxHealth: p.maxHealth }));
    else if (attack.type === 'lowest_hp') {
        const sorted = [...players].sort((a, b) => (a[1].health / a[1].maxHealth) - (b[1].health / b[1].maxHealth));
        targets = sorted.slice(0, Math.min(attack.targetCount || 1, sorted.length)).map(([id, p]) => ({ id, name: p.name, maxHealth: p.maxHealth }));
    } else {
        const shuffled = [...players].sort(() => Math.random() - 0.5);
        targets = shuffled.slice(0, Math.min(attack.targetCount || 1, shuffled.length)).map(([id, p]) => ({ id, name: p.name, maxHealth: p.maxHealth }));
    }
    const targetData = targets.map(t => ({ ...t, damage: Math.floor(t.maxHealth * attack.damagePercent * damageMult) }));
    await updateData(`games/${roomCode}`, { 'bossAttack': { name: attack.name, type: attack.type, warningText: attack.warningText, icon: attack.icon, targets: targetData, warningTime: attack.warningTime, timestamp: Date.now(), resolveAt: Date.now() + attack.warningTime } });
    spawnDamage(`${attack.icon} ${attack.name}`, { layer: 'host-damage-layer', color: '#ff4757', size: '2.5rem' });
    notify(`${attack.name}`, 'crit', attack.type === 'aoe' ? 'ALL' : targetData.map(t => t.name).join(', '));
    setTimeout(() => applyBossAttackDamage(targetData, attack.name), attack.warningTime);
}

async function applyBossAttackDamage(targets, attackName) {
    if (localState?.status !== 'ACTIVE') return;
    const updates = {}; const currentPlayers = localState?.players || {};
    const ironDome = localState?.ironDome;
    const ironDomeActive = ironDome && ironDome.active && Date.now() < ironDome.endTime;
    if (ironDomeActive) {
        updates['bossAttack'] = null; flash('#3742fa', 300); spawnDamage('🛡 IRON DOME BLOCKED!', { layer: 'host-damage-layer', color: '#3742fa', size: '3rem', isCrit: true }); notify('Attack Blocked!', 'normal', 'Iron Dome'); await updateData(`games/${roomCode}`, updates); return;
    }
    for (const target of targets) {
        const player = currentPlayers[target.id];
        if (!player || player.health <= 0) continue;
        let damage = target.damage; const currentShield = player.shield || 0;
        if (currentShield > 0) {
            if (currentShield >= damage) { updates[`players/${target.id}/shield`] = currentShield - damage; damage = 0; }
            else { damage -= currentShield; updates[`players/${target.id}/shield`] = 0; }
        }
        if (damage > 0) updates[`players/${target.id}/health`] = Math.max(0, player.health - damage);
    }
    updates['bossAttack'] = null; await updateData(`games/${roomCode}`, updates); shake('heavy'); flash('#ff4757', 200);
}

export async function startRaid() {
    if (!localState) return;
    const wave = WAVES[0];
    const playerCount = Math.max(1, Object.keys(localState.players || {}).length);
    const scaledHp = wave.hp + wave.scale * playerCount;
    currentPhase = 'NORMAL'; timerEnraged = false;
    await updateData(`games/${roomCode}`, { status: 'ACTIVE', enemy: { name: wave.name, health: scaledHp, maxHealth: scaledHp, img: wave.img, phase: 'NORMAL' }, bossAttack: null, timerEnraged: null });
    startBossAttacks(); startWaveTimer();
}

export async function triggerAirstrike() {
    if (!localState) return;
    await updateData(`games/${roomCode}`, { 'enemy/health': Math.max(0, localState.enemy.health - 10000) });
    shake('heavy'); flash('#ff4757', 300);
}

export async function triggerSupplyDrop() {
    if (!localState?.players) return;
    const updates = {};
    Object.keys(localState.players).forEach(pid => updates[`players/${pid}/ultimateCharge`] = Math.min(100, (localState.players[pid].ultimateCharge || 0) + 25));
    await updateData(`games/${roomCode}`, updates); flash('#2ed573', 200);
}

export async function togglePause() {
    if (!localState) return;
    const newStatus = localState.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
    await updateData(`games/${roomCode}`, { status: newStatus, bossAttack: null });
    if (newStatus === 'PAUSED') {
        stopBossAttacks();
        if (waveTimerInterval && waveStartTime && waveTimeLimit) { waveTimeLimit = Math.max(0, waveTimeLimit - (Date.now() - waveStartTime)); stopWaveTimer(); }
    } else {
        startBossAttacks();
        if (waveTimeLimit > 0) { waveStartTime = Date.now(); startWaveTimer(); }
    }
}

export function openMissionSelect(onSelect) { openBattleSetManager(onSelect); }

export function toggleChaosMode() {
    chaosModeEnabled = !chaosModeEnabled;
    const abilitiesDiv = document.getElementById('chaos-abilities');
    const sidebar = document.querySelector('#view-host .w-80');
    if (chaosModeEnabled) { abilitiesDiv?.classList.remove('hidden'); sidebar?.classList.add('chaos-active'); notify('CHAOS MODE ENABLED', 'crit', '😈'); }
    else { abilitiesDiv?.classList.add('hidden'); sidebar?.classList.remove('chaos-active'); notify('Chaos Mode disabled', 'normal', ''); }
}

export async function chaosMeteorStrike() {
    if (!chaosModeEnabled || !localState?.players) return;
    const btn = document.getElementById('btn-meteor-strike');
    if (btn?.disabled) return;
    const updates = {};
    Object.keys(localState.players).forEach(pid => {
        const player = localState.players[pid];
        if (player.health > 0) updates[`players/${pid}/health`] = Math.max(0, player.health - Math.floor(player.maxHealth * 0.20));
    });
    updates['chaosEvent'] = { type: 'meteor_strike', warningText: 'METEOR STRIKE!', icon: '☄️', timestamp: Date.now() };
    await updateData(`games/${roomCode}`, updates);
    flash('#ff4757', 500); shake('heavy'); spawnDamage('☄️ METEOR STRIKE!', { layer: 'host-damage-layer', color: '#ff4757', size: '4rem', isCrit: true }); notify('METEOR STRIKE!', 'crit', '-20% HP ALL');
    startChaosCooldown('meteor');
}

export async function chaosShieldDrain() {
    if (!chaosModeEnabled || !localState?.players) return;
    const btn = document.getElementById('btn-shield-drain');
    if (btn?.disabled) return;
    const updates = {}; let totalDrained = 0;
    Object.keys(localState.players).forEach(pid => {
        if (localState.players[pid].shield > 0) { totalDrained += localState.players[pid].shield; updates[`players/${pid}/shield`] = 0; }
    });
    if (totalDrained === 0) { notify('No shields to drain!', 'normal', ''); return; }
    updates['chaosEvent'] = { type: 'shield_drain', warningText: 'SHIELDS DRAINED!', icon: '🔮', timestamp: Date.now() };
    await updateData(`games/${roomCode}`, updates);
    flash('#3742fa', 500); shake('heavy'); spawnDamage('🔮 SHIELDS DRAINED!', { layer: 'host-damage-layer', color: '#3742fa', size: '4rem', isCrit: true }); notify('SHIELD DRAIN!', 'crit', `${totalDrained} ABSORBED`);
    startChaosCooldown('drain');
}

function startChaosCooldown(ability) {
    const btnId = ability === 'meteor' ? 'btn-meteor-strike' : 'btn-shield-drain';
    const cooldownId = ability === 'meteor' ? 'meteor-cooldown' : 'drain-cooldown';
    const btn = document.getElementById(btnId);
    const cooldownEl = document.getElementById(cooldownId);
    if (!btn || !cooldownEl) return;
    btn.disabled = true; btn.classList.add('on-cooldown'); cooldownEl.classList.remove('hidden');
    let remaining = CHAOS_COOLDOWN / 1000;
    cooldownEl.textContent = `${remaining}s`;
    const timer = setInterval(() => {
        remaining--;
        if (remaining <= 0) { clearInterval(timer); btn.disabled = false; btn.classList.remove('on-cooldown'); cooldownEl.classList.add('hidden'); }
        else { cooldownEl.textContent = `${remaining}s`; }
    }, 1000);
    if (ability === 'meteor') meteorCooldownTimer = timer; else drainCooldownTimer = timer;
}
