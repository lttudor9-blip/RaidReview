/* ============================================ */
/* RAID REVIEW - Host Controller                */
/* ============================================ */

import { WAVES, DEFAULT_QUESTIONS, CLASSES, BOSS_PHASES, TIMER_ENRAGE, PUZZLE_CONFIG, PUZZLE_CONFIG_VIRUS, PUZZLE_CONFIG_SYMBOLS, PUZZLE_SYMBOLS } from './config.js';
import { setData, updateData, getData, listenData, generateRoomCode } from './firebase.js';
import { showView, show, hide, setText, setHTML, setStyle, toggleVisible } from './ui.js';
import { shake, flash, spawnDamage, notify } from './juice.js';
import { openBattleSetManager } from './battleset.js';

// Host state
let roomCode = null;
let localState = null;
let lastEnemyHealth = 0;
let lastActionLogLength = 0;

// Boss attack state
let bossAttackTimers = [];
let attackCooldowns = {};
let raidStartTime = null;
let isEnraged = false;

// Wave timer state
let waveTimerInterval = null;
let waveStartTime = null;
let waveTimeLimit = null;
let timerEnraged = false;

// Boss phase state
let currentPhase = 'NORMAL';

// Puzzle state
let puzzleActive = false;
let puzzleCode = '';
let puzzleTimer = null;
let puzzleStartTime = null;

/**
 * Get current room code
 * @returns {string|null}
 */
export function getRoomCode() {
    return roomCode;
}

/**
 * Get current local state
 * @returns {Object|null}
 */
export function getLocalState() {
    return localState;
}

/**
 * Initialize host mode with questions
 * @param {Array} questions - Question set to use
 */
export async function initHost(questions) {
    roomCode = generateRoomCode();
    
    const wave = WAVES[0];
    const data = {
        roomCode: roomCode,
        status: 'LOBBY',
        currentWave: 1,
        enemy: {
            name: wave.name,
            health: wave.hp,
            maxHealth: wave.hp,
            img: wave.img,
            phase: 'NORMAL'
        },
        players: {},
        questions: questions || DEFAULT_QUESTIONS
    };
    
    localState = data;
    lastEnemyHealth = wave.hp;
    
    await setData(`games/${roomCode}`, data);
    
    setText('host-room-code', roomCode);
    showView('view-host');
    show('btn-start-raid');
    
    // Listen for game updates
    listenData(`games/${roomCode}`, (data) => {
        if (data) {
            localState = data;
            renderHost(data);
            
            // Check for puzzle submissions
            if (data.puzzleSubmission && puzzleActive) {
                handlePuzzleSubmission(
                    data.puzzleSubmission.code,
                    data.puzzleSubmission.playerName
                );
                // Clear the submission
                updateData(`games/${roomCode}/puzzleSubmission`, null);
            }
        }
    });
    
    return roomCode;
}

/**
 * Render host view with current game state
 * @param {Object} data - Game state
 */
function renderHost(data) {
    // Boss health bar
    const hpPercent = (data.enemy.health / data.enemy.maxHealth) * 100;
    setStyle('host-boss-bar', 'width', `${hpPercent}%`);
    setText('host-boss-hp-text', `${Math.ceil(hpPercent)}%`);
    setText('host-boss-name', data.enemy.name);
    setText('host-wave-num', data.currentWave);
    
    // Update boss phase visuals
    updateBossPhaseDisplay(data.enemy);
    
    // Boss image
    const img = document.getElementById('host-boss-img');
    if (img && img.src !== data.enemy.img) {
        img.src = data.enemy.img;
    }
    
    // Damage display when health drops
    if (data.enemy.health < lastEnemyHealth) {
        const dmg = lastEnemyHealth - data.enemy.health;
        spawnDamage(dmg.toString(), {
            layer: 'host-damage-layer',
            size: dmg > 5000 ? '4rem' : '2.5rem',
            isCrit: dmg > 5000,
            color: dmg > 5000 ? '#ff6b81' : '#ffa502'
        });
        if (dmg > 2000) {
            shake(dmg > 10000 ? 'heavy' : 'normal');
        }
        // Trigger boss hit animation
        triggerBossHit();
    }
    lastEnemyHealth = data.enemy.health;
    
    // Check for boss phase transitions
    checkBossPhase(data.enemy);
    
    // Player stats
    const players = Object.values(data.players || {});
    setText('host-player-count', players.length);
    
    // Vitals grid (health indicators)
    setHTML('jumbo-vitals-grid', players.map(p => {
        const pct = p.health / p.maxHealth;
        const color = p.health <= 0 ? '#ff4757' : pct < 0.5 ? '#ffa502' : '#2ed573';
        return `<div class="w-3 h-3 rounded-full" style="background: ${color}"></div>`;
    }).join(''));
    
    // Action feed (support actions)
    renderActionFeed(data.actionLog);
    
    // Top performers list
    setHTML('jumbo-top-list', players
        .sort((a, b) => (b.ultimateCharge || 0) - (a.ultimateCharge || 0))
        .slice(0, 3)
        .map((p, i) => `
            <div class="flex justify-between text-sm">
                <span class="text-gray-400">${i + 1}. ${p.name}</span>
                <span class="text-gold">${p.ultimateCharge || 0}%</span>
            </div>
        `).join(''));
    
    // Status buttons
    toggleVisible('btn-start-raid', data.status === 'LOBBY');
    toggleVisible('status-display', data.status !== 'LOBBY');
    
    // Wave transition check
    if (data.status === 'ACTIVE' && data.enemy.health <= 0) {
        nextWave(data);
    }
}

/**
 * Update boss phase display on host screen
 * @param {Object} enemy - Enemy data
 */
function updateBossPhaseDisplay(enemy) {
    const phaseEl = document.getElementById('host-boss-phase');
    const bossBar = document.getElementById('host-boss-bar');
    const bossImg = document.getElementById('host-boss-img');
    const bossAura = document.getElementById('boss-aura');
    const bossVignette = document.getElementById('boss-vignette');
    
    const phase = enemy.phase || 'NORMAL';
    const phaseClass = phase.toLowerCase();
    
    // Update phase indicator text
    if (phaseEl) {
        if (phase === 'NORMAL') {
            phaseEl.classList.add('hidden');
        } else {
            phaseEl.classList.remove('hidden');
            phaseEl.textContent = phase;
            phaseEl.className = `boss-phase-indicator ${phaseClass}`;
        }
    }
    
    // Clear all phase classes helper
    const clearPhaseClasses = (el) => {
        if (el) {
            el.classList.remove('phase-normal', 'phase-enraged', 'phase-desperate', 'timer-enraged');
        }
    };
    
    // Determine which class to apply
    let activePhaseClass = null;
    if (timerEnraged) {
        activePhaseClass = 'timer-enraged';
    } else if (phase === 'ENRAGED') {
        activePhaseClass = 'phase-enraged';
    } else if (phase === 'DESPERATE') {
        activePhaseClass = 'phase-desperate';
    }
    
    // Update boss bar color
    clearPhaseClasses(bossBar);
    if (activePhaseClass && bossBar) {
        bossBar.classList.add(activePhaseClass);
    }
    
    // Update boss image
    clearPhaseClasses(bossImg);
    if (activePhaseClass && bossImg) {
        bossImg.classList.add(activePhaseClass);
    }
    
    // Update boss aura
    clearPhaseClasses(bossAura);
    if (activePhaseClass && bossAura) {
        bossAura.classList.add(activePhaseClass);
    }
    
    // Update vignette
    clearPhaseClasses(bossVignette);
    if (activePhaseClass && bossVignette) {
        bossVignette.classList.add(activePhaseClass);
    }
    
    // Update particles based on phase
    updateBossParticles(activePhaseClass);
}

/**
 * Check and update boss phase based on HP
 * @param {Object} enemy - Enemy data
 */
async function checkBossPhase(enemy) {
    const hpPercent = enemy.health / enemy.maxHealth;
    let newPhase = 'NORMAL';
    
    if (hpPercent <= BOSS_PHASES.DESPERATE.threshold) {
        newPhase = 'DESPERATE';
    } else if (hpPercent <= BOSS_PHASES.ENRAGED.threshold) {
        newPhase = 'ENRAGED';
    }
    
    // Phase transition
    if (newPhase !== currentPhase) {
        const oldPhase = currentPhase;
        currentPhase = newPhase;
        
        // Update Firebase
        await updateData(`games/${roomCode}`, { 'enemy/phase': newPhase });
        
        // Announce phase change
        if (newPhase !== 'NORMAL') {
            announceBossPhase(newPhase);
        }
    }
}

/**
 * Announce boss phase transition
 * @param {string} phase - New phase name
 */
async function announceBossPhase(phase) {
    const phaseConfig = BOSS_PHASES[phase];
    
    // Trigger phase transition flash
    triggerPhaseFlash(phase);
    
    // Broadcast to players
    await updateData(`games/${roomCode}`, {
        'bossAttack': {
            type: 'phase_change',
            phase: phase,
            warningText: phase === 'DESPERATE' ? 'BOSS IS DESPERATE!' : 'BOSS ENRAGED!',
            icon: phase === 'DESPERATE' ? 'ðŸ”¥' : 'ðŸ˜¡',
            timestamp: Date.now()
        }
    });
    
    // Host feedback
    flash(phaseConfig.color, 500);
    shake('heavy');
    
    const phaseText = phase === 'DESPERATE' ? 'ðŸ”¥ DESPERATE!' : 'ðŸ˜¡ ENRAGED!';
    spawnDamage(phaseText, { layer: 'host-damage-layer', color: phaseConfig.color, size: '4rem', isCrit: true });
    
    if (phase === 'DESPERATE') {
        notify('BOSS IS DESPERATE!', 'crit', 'TARGETING WEAKEST');
    } else {
        notify('BOSS ENRAGED!', 'crit', '+50% SPEED');
    }
}

/**
 * Trigger the phase transition flash effect
 * @param {string} phase - Phase name (ENRAGED or DESPERATE)
 */
function triggerPhaseFlash(phase) {
    const flashEl = document.getElementById('phase-flash');
    if (!flashEl) return;
    
    // Reset and apply new phase
    flashEl.classList.remove('active', 'enraged', 'desperate');
    flashEl.offsetHeight; // Force reflow
    
    flashEl.classList.add(phase.toLowerCase(), 'active');
    
    // Remove after animation
    setTimeout(() => {
        flashEl.classList.remove('active', 'enraged', 'desperate');
    }, 600);
}

// Particle system state
let particleInterval = null;
let currentParticlePhase = null;

/**
 * Update boss particles based on phase
 * @param {string} phaseClass - Current phase class (e.g., 'phase-enraged', 'timer-enraged', or null)
 */
function updateBossParticles(phaseClass) {
    const particlesContainer = document.getElementById('boss-particles');
    if (!particlesContainer) return;
    
    // Determine particle type
    let particleType = 'normal';
    let spawnRate = 2000; // ms between spawns
    let particleCount = 1;
    
    if (phaseClass === 'timer-enraged') {
        particleType = 'timer-enraged';
        spawnRate = 150;
        particleCount = 3;
    } else if (phaseClass === 'phase-desperate') {
        particleType = 'desperate';
        spawnRate = 300;
        particleCount = 2;
    } else if (phaseClass === 'phase-enraged') {
        particleType = 'enraged';
        spawnRate = 600;
        particleCount = 1;
    }
    
    // Only restart if phase changed
    if (currentParticlePhase === phaseClass) return;
    currentParticlePhase = phaseClass;
    
    // Clear existing particles and interval
    if (particleInterval) {
        clearInterval(particleInterval);
        particleInterval = null;
    }
    particlesContainer.innerHTML = '';
    
    // Spawn particles periodically
    const spawnParticles = () => {
        for (let i = 0; i < particleCount; i++) {
            createBossParticle(particlesContainer, particleType);
        }
    };
    
    // Initial spawn
    spawnParticles();
    
    // Continue spawning
    particleInterval = setInterval(spawnParticles, spawnRate);
}

/**
 * Create a single boss particle
 * @param {HTMLElement} container - Particle container
 * @param {string} type - Particle type (normal, enraged, desperate, timer-enraged)
 */
function createBossParticle(container, type) {
    const particle = document.createElement('div');
    particle.className = `boss-particle ${type}`;
    
    // Random horizontal position (centered around boss)
    const centerX = 50;
    const spread = type === 'normal' ? 20 : type === 'enraged' ? 30 : 40;
    const x = centerX + (Math.random() - 0.5) * spread;
    particle.style.left = `${x}%`;
    particle.style.bottom = '10%';
    
    // Random drift direction for some particle types
    const drift = (Math.random() - 0.5) * 60;
    particle.style.setProperty('--drift', `${drift}px`);
    
    // Random delay for variety
    particle.style.animationDelay = `${Math.random() * 0.5}s`;
    
    container.appendChild(particle);
    
    // Remove particle after animation
    const duration = type === 'timer-enraged' ? 1000 : type === 'desperate' ? 2000 : type === 'enraged' ? 4000 : 8000;
    setTimeout(() => {
        particle.remove();
    }, duration + 500);
}

/**
 * Trigger boss hit reaction animation
 */
function triggerBossHit() {
    const bossContainer = document.getElementById('boss-container');
    if (!bossContainer) return;
    
    bossContainer.classList.remove('hit');
    bossContainer.offsetHeight; // Force reflow
    bossContainer.classList.add('hit');
    
    setTimeout(() => {
        bossContainer.classList.remove('hit');
    }, 300);
}

/**
 * Trigger boss attack windup animation
 */
function triggerBossAttackWindup() {
    const bossContainer = document.getElementById('boss-container');
    if (!bossContainer) return;
    
    bossContainer.classList.remove('attacking');
    bossContainer.offsetHeight; // Force reflow
    bossContainer.classList.add('attacking');
    
    setTimeout(() => {
        bossContainer.classList.remove('attacking');
    }, 800);
}

/**
 * Render the support action feed
 * @param {Object} actionLog - Action log from Firebase
 */
function renderActionFeed(actionLog) {
    const feed = document.getElementById('host-action-feed');
    if (!feed) return;
    
    if (!actionLog || Object.keys(actionLog).length === 0) {
        feed.innerHTML = '<div class="text-gray-600 text-xs text-center py-2">No actions yet</div>';
        return;
    }
    
    // Convert to array and sort by timestamp (newest first)
    const actions = Object.values(actionLog)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 8); // Keep last 8 actions
    
    // Check if there are new actions (for animation)
    const currentLength = actions.length;
    const hasNewAction = currentLength > lastActionLogLength;
    lastActionLogLength = currentLength;
    
    // Icons and colors for each action type
    const actionConfig = {
        heal: { icon: 'ðŸ’š', color: '#2ed573', label: 'HEAL' },
        shield: { icon: 'ðŸ›¡ï¸', color: '#3742fa', label: 'SHIELD' },
        buff: { icon: 'â¬†ï¸', color: '#a55eea', label: 'BUFF' }
    };
    
    feed.innerHTML = actions.map((action, index) => {
        const cfg = actionConfig[action.type] || actionConfig.heal;
        const isNew = hasNewAction && index === 0;
        const classColor = CLASSES[action.casterClass]?.color || '#888';
        
        return `
            <div class="action-feed-item ${isNew ? 'new' : ''}" style="border-left-color: ${cfg.color}">
                <div class="flex items-center gap-2">
                    <span class="text-lg">${cfg.icon}</span>
                    <div class="flex-1 min-w-0">
                        <div class="text-sm truncate">
                            <span style="color: ${classColor}">${action.caster}</span>
                            <span class="text-gray-500">âž¤</span>
                            <span class="text-white">${action.target}</span>
                        </div>
                        <div class="text-xs text-gray-500">${cfg.label}${action.value ? ` +${action.value}` : ''}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Start the wave timer
 */
function startWaveTimer() {
    stopWaveTimer();
    
    const wave = WAVES[(localState?.currentWave || 1) - 1];
    if (!wave?.timeLimit) return;
    
    waveStartTime = Date.now();
    waveTimeLimit = wave.timeLimit;
    timerEnraged = false;
    
    // Update timer display every second
    waveTimerInterval = setInterval(() => {
        if (localState?.status !== 'ACTIVE') {
            return;
        }
        
        const elapsed = Date.now() - waveStartTime;
        const remaining = Math.max(0, waveTimeLimit - elapsed);
        
        updateTimerDisplay(remaining);
        
        // Check for timer expiration
        if (remaining <= 0 && !timerEnraged) {
            triggerTimerEnrage();
        }
    }, 100);
}

/**
 * Stop the wave timer
 */
function stopWaveTimer() {
    if (waveTimerInterval) {
        clearInterval(waveTimerInterval);
        waveTimerInterval = null;
    }
    waveStartTime = null;
    waveTimeLimit = null;
}

/**
 * Update the timer display on host screen
 * @param {number} remaining - Remaining time in ms
 */
function updateTimerDisplay(remaining) {
    const timerEl = document.getElementById('host-wave-timer');
    const timerContainer = document.getElementById('host-timer-container');
    
    if (!timerEl || !timerContainer) return;
    
    const seconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    timerEl.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
    
    // Warning state at 30 seconds
    if (seconds <= 30 && seconds > 0) {
        timerContainer.classList.add('timer-warning');
        timerContainer.classList.remove('timer-expired');
    } else if (seconds <= 0) {
        timerContainer.classList.remove('timer-warning');
        timerContainer.classList.add('timer-expired');
    } else {
        timerContainer.classList.remove('timer-warning', 'timer-expired');
    }
}

/**
 * Trigger enrage due to timer expiration
 */
async function triggerTimerEnrage() {
    timerEnraged = true;
    
    // Broadcast to players
    await updateData(`games/${roomCode}`, {
        'bossAttack': {
            type: 'timer_enrage',
            warningText: 'TIME EXPIRED - BOSS ENRAGED!',
            icon: 'â°',
            timestamp: Date.now()
        },
        'timerEnraged': true
    });
    
    // Host feedback
    flash('#ff4757', 800);
    shake('heavy');
    spawnDamage('â° TIME UP!', { layer: 'host-damage-layer', color: '#ff4757', size: '4rem', isCrit: true });
    spawnDamage('BOSS ENRAGED!', { layer: 'host-damage-layer', color: '#ff4757', size: '3rem' });
    notify('TIME EXPIRED!', 'crit', '2x DAMAGE & SPEED');
}

/**
 * Progress to next wave
 * @param {Object} data - Current game state
 */
async function nextWave(data) {
    // Stop current boss attacks and timer
    stopBossAttacks();
    stopWaveTimer();
    
    const nextWaveNum = (data.currentWave || 1) + 1;
    
    // Victory condition
    if (nextWaveNum > WAVES.length) {
        await updateData(`games/${roomCode}`, { status: 'VICTORY', bossAttack: null, timerEnraged: null });
        return;
    }
    
    const wave = WAVES[nextWaveNum - 1];
    const playerCount = Math.max(1, Object.keys(data.players || {}).length);
    const scaledHp = wave.hp + wave.scale * playerCount;
    
    // Set wave clear status with next wave info
    await updateData(`games/${roomCode}`, {
        status: 'WAVE_CLEAR',
        bossAttack: null,
        timerEnraged: null,
        nextWaveInfo: {
            waveNum: nextWaveNum,
            bossName: wave.name,
            bossImg: wave.img
        }
    });
    
    // Host celebration
    flash('#ffa502', 500);
    shake('heavy');
    spawnDamage('WAVE CLEARED!', { layer: 'host-damage-layer', color: '#ffa502', size: '4rem', isCrit: true });
    notify('Wave Complete!', 'ult', 'Puzzle incoming!');
    
    // Reset phase tracking
    currentPhase = 'NORMAL';
    timerEnraged = false;
    
    // Store next wave info for after puzzle
    const nextWaveData = {
        waveNum: nextWaveNum,
        wave: wave,
        scaledHp: scaledHp,
        players: data.players
    };
    
    // Wait 3 seconds, then start puzzle
    setTimeout(() => {
        startPuzzle(nextWaveData);
    }, 3000);
}

/**
 * Start the raid puzzle between waves
 * @param {Object} nextWaveData - Data needed to start the next wave after puzzle
 */
async function startPuzzle(nextWaveData) {
    // Wave 3 (after clearing Wave 2) uses the Virus puzzle
    if (nextWaveData.waveNum === 3) {
        return startVirusPuzzle(nextWaveData);
    }
    
    // Wave 4 (after clearing Wave 3) uses the Symbol puzzle
    if (nextWaveData.waveNum === 4) {
        return startSymbolPuzzle(nextWaveData);
    }
    
    // Standard puzzle for other waves
    puzzleActive = true;
    puzzleStartTime = Date.now();
    
    // Generate 6-digit code
    puzzleCode = '';
    for (let i = 0; i < PUZZLE_CONFIG.codeLength; i++) {
        puzzleCode += Math.floor(Math.random() * 10).toString();
    }
    
    // Distribute digits to players
    const players = Object.keys(nextWaveData.players || {});
    const playerDigits = {};
    
    if (players.length > 0) {
        // Shuffle digit positions
        const positions = [0, 1, 2, 3, 4, 5];
        
        // Assign digits round-robin to players
        positions.forEach((pos, idx) => {
            const playerId = players[idx % players.length];
            if (!playerDigits[playerId]) {
                playerDigits[playerId] = [];
            }
            playerDigits[playerId].push({
                position: pos + 1, // 1-indexed for display
                digit: puzzleCode[pos]
            });
        });
    }
    
    // Update Firebase with puzzle state
    await updateData(`games/${roomCode}`, {
        status: 'PUZZLE',
        puzzle: {
            active: true,
            type: 'standard',
            code: puzzleCode, // Host can see this
            playerDigits: playerDigits,
            startTime: puzzleStartTime,
            timeLimit: PUZZLE_CONFIG.timeLimit,
            attempts: [],
            solved: false
        },
        nextWaveData: {
            waveNum: nextWaveData.waveNum,
            waveName: nextWaveData.wave.name,
            waveHp: nextWaveData.scaledHp,
            waveImg: nextWaveData.wave.img
        }
    });
    
    // Show host puzzle UI
    show('view-puzzle-host');
    renderHostPuzzle();
    
    // Start puzzle timer
    startPuzzleTimer(nextWaveData);
}

/**
 * Start the Virus puzzle (Wave 3) - one player is infected with corrupted data
 * @param {Object} nextWaveData - Data needed to start the next wave after puzzle
 */
async function startVirusPuzzle(nextWaveData) {
    puzzleActive = true;
    puzzleStartTime = Date.now();
    
    // Generate 6-digit code
    puzzleCode = '';
    for (let i = 0; i < PUZZLE_CONFIG_VIRUS.codeLength; i++) {
        puzzleCode += Math.floor(Math.random() * 10).toString();
    }
    
    // Get player list and pick one random infected player
    const players = Object.keys(nextWaveData.players || {});
    const infectedPlayerId = players.length > 0 
        ? players[Math.floor(Math.random() * players.length)] 
        : null;
    
    // Generate fake digits for infected player (guaranteed different from real)
    const generateFakeDigit = (realDigit) => {
        let fake;
        do {
            fake = Math.floor(Math.random() * 10).toString();
        } while (fake === realDigit);
        return fake;
    };
    
    // Distribute digits to players
    const playerDigits = {};
    
    if (players.length > 0) {
        const positions = [0, 1, 2, 3, 4, 5];
        
        // Assign digits round-robin to players
        positions.forEach((pos, idx) => {
            const playerId = players[idx % players.length];
            if (!playerDigits[playerId]) {
                playerDigits[playerId] = [];
            }
            
            // If this player is infected, give them fake digits
            const isInfected = playerId === infectedPlayerId;
            const digit = isInfected 
                ? generateFakeDigit(puzzleCode[pos])
                : puzzleCode[pos];
            
            playerDigits[playerId].push({
                position: pos + 1,
                digit: digit
            });
        });
    }
    
    // Update Firebase with puzzle state
    await updateData(`games/${roomCode}`, {
        status: 'PUZZLE',
        puzzle: {
            active: true,
            type: 'virus',
            code: puzzleCode, // Host can see the real code
            playerDigits: playerDigits,
            infectedPlayerId: infectedPlayerId, // Host and infected player can see this
            infectedPlayerName: infectedPlayerId ? nextWaveData.players[infectedPlayerId]?.name : null,
            startTime: puzzleStartTime,
            timeLimit: PUZZLE_CONFIG_VIRUS.timeLimit,
            attempts: [],
            solved: false
        },
        nextWaveData: {
            waveNum: nextWaveData.waveNum,
            waveName: nextWaveData.wave.name,
            waveHp: nextWaveData.scaledHp,
            waveImg: nextWaveData.wave.img
        }
    });
    
    // Show host puzzle UI
    show('view-puzzle-host');
    renderHostPuzzle();
    
    // Start puzzle timer with virus config
    startVirusPuzzleTimer(nextWaveData);
}

/**
 * Start the virus puzzle countdown timer
 * @param {Object} nextWaveData - Data for next wave
 */
function startVirusPuzzleTimer(nextWaveData) {
    if (puzzleTimer) clearInterval(puzzleTimer);
    
    const updateTimer = () => {
        const elapsed = Date.now() - puzzleStartTime;
        const remaining = Math.max(0, PUZZLE_CONFIG_VIRUS.timeLimit - elapsed);
        const seconds = Math.ceil(remaining / 1000);
        
        // Update host timer
        const hostTimer = document.getElementById('puzzle-timer-host');
        if (hostTimer) {
            hostTimer.textContent = seconds;
            hostTimer.classList.toggle('timer-critical', seconds <= 15);
        }
        
        // Check for timeout
        if (remaining <= 0) {
            clearInterval(puzzleTimer);
            puzzleTimer = null;
            endPuzzle(false, nextWaveData);
        }
    };
    
    updateTimer();
    puzzleTimer = setInterval(updateTimer, 100);
}

/**
 * Start the Symbol puzzle (Wave 4) - players must describe abstract symbols
 * @param {Object} nextWaveData - Data needed to start the next wave after puzzle
 */
async function startSymbolPuzzle(nextWaveData) {
    puzzleActive = true;
    puzzleStartTime = Date.now();
    
    // Generate 6-symbol code (array of symbol IDs)
    const symbolCode = [];
    for (let i = 0; i < PUZZLE_CONFIG_SYMBOLS.codeLength; i++) {
        symbolCode.push(Math.floor(Math.random() * PUZZLE_SYMBOLS.length));
    }
    
    // Store as string for comparison (e.g., "3,6,2,0,11,4")
    puzzleCode = symbolCode.join(',');
    
    // Distribute symbols to players
    const players = Object.keys(nextWaveData.players || {});
    const playerDigits = {};
    
    if (players.length > 0) {
        const positions = [0, 1, 2, 3, 4, 5];
        
        // Assign symbols round-robin to players
        positions.forEach((pos, idx) => {
            const playerId = players[idx % players.length];
            if (!playerDigits[playerId]) {
                playerDigits[playerId] = [];
            }
            
            const symbolId = symbolCode[pos];
            const symbolData = PUZZLE_SYMBOLS[symbolId];
            
            playerDigits[playerId].push({
                position: pos + 1,
                symbolId: symbolId,
                symbol: symbolData.symbol,
                name: symbolData.name
            });
        });
    }
    
    // Update Firebase with puzzle state
    await updateData(`games/${roomCode}`, {
        status: 'PUZZLE',
        puzzle: {
            active: true,
            type: 'symbols',
            code: puzzleCode, // Host can see this (comma-separated symbol IDs)
            symbolCode: symbolCode, // Array of symbol IDs for easier handling
            playerDigits: playerDigits,
            startTime: puzzleStartTime,
            timeLimit: PUZZLE_CONFIG_SYMBOLS.timeLimit,
            attempts: [],
            solved: false
        },
        nextWaveData: {
            waveNum: nextWaveData.waveNum,
            waveName: nextWaveData.wave.name,
            waveHp: nextWaveData.scaledHp,
            waveImg: nextWaveData.wave.img
        }
    });
    
    // Show host puzzle UI
    show('view-puzzle-host');
    renderHostPuzzle();
    
    // Start puzzle timer
    startSymbolPuzzleTimer(nextWaveData);
}

/**
 * Start the symbol puzzle countdown timer
 * @param {Object} nextWaveData - Data for next wave
 */
function startSymbolPuzzleTimer(nextWaveData) {
    if (puzzleTimer) clearInterval(puzzleTimer);
    
    const updateTimer = () => {
        const elapsed = Date.now() - puzzleStartTime;
        const remaining = Math.max(0, PUZZLE_CONFIG_SYMBOLS.timeLimit - elapsed);
        const seconds = Math.ceil(remaining / 1000);
        
        // Update host timer
        const hostTimer = document.getElementById('puzzle-timer-host');
        if (hostTimer) {
            hostTimer.textContent = seconds;
            hostTimer.classList.toggle('timer-critical', seconds <= 20);
        }
        
        // Check for timeout
        if (remaining <= 0) {
            clearInterval(puzzleTimer);
            puzzleTimer = null;
            endPuzzle(false, nextWaveData);
        }
    };
    
    updateTimer();
    puzzleTimer = setInterval(updateTimer, 100);
}

/**
 * Render the puzzle display on host screen
 */
function renderHostPuzzle() {
    const puzzle = localState?.puzzle;
    const isVirus = puzzle?.type === 'virus';
    const isSymbols = puzzle?.type === 'symbols';
    
    // Update title based on puzzle type
    const titleEl = document.querySelector('#view-puzzle-host h1');
    if (titleEl) {
        if (isSymbols) {
            titleEl.innerHTML = 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â® ANCIENT TRANSMISSION';
        } else if (isVirus) {
            titleEl.innerHTML = 'ÃƒÂ¢Ã‹Å“Ã‚Â£ÃƒÂ¯Ã‚Â¸Ã‚Â CORRUPTED TRANSMISSION';
        } else {
            titleEl.innerHTML = 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â RAID PUZZLE';
        }
    }
    
    // Update subtitle
    const subtitleEl = document.querySelector('#view-puzzle-host p');
    if (subtitleEl) {
        if (isSymbols) {
            subtitleEl.textContent = 'Squad must describe and match the ancient symbols!';
        } else if (isVirus) {
            subtitleEl.textContent = 'WARNING: One squad member has corrupted data!';
        } else {
            subtitleEl.textContent = 'Squad must combine their code fragments!';
        }
    }
    
    // Render the code display
    const codeDisplay = document.getElementById('puzzle-code-display');
    if (codeDisplay) {
        if (isSymbols && puzzle.symbolCode) {
            // Render symbols for symbol puzzle
            codeDisplay.innerHTML = puzzle.symbolCode.map((symbolId, idx) => {
                const symbolData = PUZZLE_SYMBOLS[symbolId];
                return `
                    <div class="puzzle-digit-box symbol-box">
                        <div class="puzzle-digit-position">${idx + 1}</div>
                        <div class="puzzle-symbol-value">${symbolData.symbol}</div>
                        <div class="puzzle-symbol-name">${symbolData.name}</div>
                    </div>
                `;
            }).join('');
        } else {
            // Render digits for standard/virus puzzle
            codeDisplay.innerHTML = puzzleCode.split('').map((digit, idx) => `
                <div class="puzzle-digit-box">
                    <div class="puzzle-digit-position">${idx + 1}</div>
                    <div class="puzzle-digit-value">${digit}</div>
                </div>
            `).join('');
        }
    }
    
    // Show additional info for special puzzles
    const attemptsDisplay = document.getElementById('puzzle-attempts-display');
    if (attemptsDisplay) {
        if (isVirus && puzzle.infectedPlayerName) {
            attemptsDisplay.innerHTML = `
                <div class="text-warrior mb-2">ÃƒÂ¢Ã‹Å“Ã‚Â£ÃƒÂ¯Ã‚Â¸Ã‚Â INFECTED: <span class="text-white">${puzzle.infectedPlayerName}</span></div>
                <div class="text-gray-500">Waiting for input...</div>
            `;
        } else if (isSymbols) {
            // Show symbol legend for teacher reference
            attemptsDisplay.innerHTML = `
                <div class="text-gray-400 mb-3 text-sm">Symbol Reference:</div>
                <div class="flex flex-wrap justify-center gap-2">
                    ${PUZZLE_SYMBOLS.map(s => `
                        <div class="symbol-legend-item">
                            <span class="symbol-legend-icon">${s.symbol}</span>
                            <span class="symbol-legend-name">${s.name}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }
    }
}

/**
 * Start the puzzle countdown timer
 * @param {Object} nextWaveData - Data for next wave
 */
function startPuzzleTimer(nextWaveData) {
    if (puzzleTimer) clearInterval(puzzleTimer);
    
    const updateTimer = () => {
        const elapsed = Date.now() - puzzleStartTime;
        const remaining = Math.max(0, PUZZLE_CONFIG.timeLimit - elapsed);
        const seconds = Math.ceil(remaining / 1000);
        
        // Update host timer
        const hostTimer = document.getElementById('puzzle-timer-host');
        if (hostTimer) {
            hostTimer.textContent = seconds;
            hostTimer.classList.toggle('timer-critical', seconds <= 10);
        }
        
        // Check for timeout
        if (remaining <= 0) {
            clearInterval(puzzleTimer);
            puzzleTimer = null;
            endPuzzle(false, nextWaveData);
        }
    };
    
    updateTimer();
    puzzleTimer = setInterval(updateTimer, 100);
}

/**
 * Handle puzzle code submission from a player
 * @param {string} submittedCode - The code submitted
 * @param {string} submitterName - Name of the player who submitted
 */
export async function handlePuzzleSubmission(submittedCode, submitterName) {
    if (!puzzleActive) return;
    
    // Get current puzzle state
    const puzzleData = localState?.puzzle;
    if (!puzzleData || puzzleData.solved) return;
    
    // Record attempt
    const attempts = puzzleData.attempts || [];
    attempts.push({
        code: submittedCode,
        player: submitterName,
        timestamp: Date.now()
    });
    
    // Update attempts display
    const attemptsDisplay = document.getElementById('puzzle-attempts-display');
    if (attemptsDisplay) {
        // For symbol puzzles, show the actual symbols
        if (puzzleData.type === 'symbols') {
            const symbolIds = submittedCode.split(',').map(id => parseInt(id));
            const symbolsDisplay = symbolIds.map(id => {
                const sym = PUZZLE_SYMBOLS[id];
                return sym ? sym.symbol : '?';
            }).join(' ');
            attemptsDisplay.innerHTML = `<span class="text-gold">${submitterName}</span> submitted: <span class="text-white text-3xl tracking-widest">${symbolsDisplay}</span>`;
        } else {
            attemptsDisplay.innerHTML = `<span class="text-gold">${submitterName}</span> submitted: <span class="text-white tracking-widest">${submittedCode}</span>`;
        }
    }
    
    // Check if correct
    if (submittedCode === puzzleCode) {
        // SUCCESS!
        await updateData(`games/${roomCode}/puzzle`, {
            solved: true,
            solvedBy: submitterName,
            attempts: attempts
        });
        
        // Get next wave data and end puzzle with success
        const nextWaveData = localState?.nextWaveData;
        endPuzzle(true, nextWaveData);
    } else {
        // Wrong - update attempts
        await updateData(`games/${roomCode}/puzzle/attempts`, attempts);
        
        // Visual feedback
        flash('#ff4757', 200);
        shake();
        spawnDamage('WRONG CODE!', { layer: 'host-damage-layer', color: '#ff4757', size: '3rem' });
    }
}

/**
 * End the puzzle phase and transition to next wave
 * @param {boolean} success - Whether puzzle was solved
 * @param {Object} nextWaveData - Data for next wave
 */
async function endPuzzle(success, nextWaveData) {
    puzzleActive = false;
    if (puzzleTimer) {
        clearInterval(puzzleTimer);
        puzzleTimer = null;
    }
    
    // Hide puzzle UI
    hide('view-puzzle-host');
    
    const updates = {};
    
    if (success) {
        // SUCCESS - Apply rewards
        flash('#2ed573', 500);
        shake('heavy');
        spawnDamage('ðŸ§© PUZZLE SOLVED!', { layer: 'host-damage-layer', color: '#2ed573', size: '4rem', isCrit: true });
        notify('Puzzle Complete!', 'heal', '+25% HP, +15% Ult');
        
        // Heal and charge all players
        const players = localState?.players || {};
        Object.keys(players).forEach(pid => {
            const player = players[pid];
            const healAmount = Math.floor(player.maxHealth * PUZZLE_CONFIG.rewards.healPercent);
            const newHealth = Math.min(player.maxHealth, player.health + healAmount);
            updates[`players/${pid}/health`] = newHealth;
            updates[`players/${pid}/ultimateCharge`] = Math.min(100, (player.ultimateCharge || 0) + PUZZLE_CONFIG.rewards.ultCharge);
        });
        
        updates['puzzleResult'] = { success: true, timestamp: Date.now() };
        
    } else {
        // FAILURE - Apply penalty
        flash('#ff4757', 500);
        shake('heavy');
        spawnDamage('â° TIME UP!', { layer: 'host-damage-layer', color: '#ff4757', size: '4rem', isCrit: true });
        spawnDamage('BOSS EMPOWERED!', { layer: 'host-damage-layer', color: '#ff4757', size: '2.5rem' });
        notify('Puzzle Failed!', 'crit', 'Boss +25% DMG');
        
        updates['puzzleResult'] = { 
            success: false, 
            timestamp: Date.now(),
            bossBuff: {
                damageMultiplier: PUZZLE_CONFIG.penalty.bossDamageBuff,
                endTime: Date.now() + PUZZLE_CONFIG.penalty.duration
            }
        };
    }
    
    // Clear puzzle state
    updates['puzzle'] = null;
    updates['nextWaveData'] = null;
    
    await updateData(`games/${roomCode}`, updates);
    
    // Start next wave after short delay
    setTimeout(() => {
        startNextWaveAfterPuzzle(nextWaveData, !success);
    }, 2000);
}

/**
 * Actually start the next wave after puzzle
 * @param {Object} nextWaveData - Wave data
 * @param {boolean} bossBuff - Whether boss has damage buff from failed puzzle
 */
async function startNextWaveAfterPuzzle(nextWaveData, bossBuff) {
    if (!nextWaveData) return;
    
    const updates = {
        status: 'ACTIVE',
        currentWave: nextWaveData.waveNum,
        enemy: {
            name: nextWaveData.waveName,
            health: nextWaveData.waveHp,
            maxHealth: nextWaveData.waveHp,
            img: nextWaveData.waveImg,
            phase: 'NORMAL'
        },
        bossAttack: null,
        timerEnraged: null
    };
    
    // Apply boss buff if puzzle failed
    if (bossBuff) {
        updates['enemy/puzzleBuff'] = {
            active: true,
            damageMultiplier: PUZZLE_CONFIG.penalty.bossDamageBuff,
            endTime: Date.now() + PUZZLE_CONFIG.penalty.duration
        };
    }
    
    // Reset shields between waves
    const players = localState?.players || {};
    Object.keys(players).forEach(pid => {
        updates[`players/${pid}/shield`] = 0;
    });
    
    await updateData(`games/${roomCode}`, updates);
    
    // Start new wave's attacks and timer
    startBossAttacks();
    startWaveTimer();
}

/**
 * Get current phase multipliers
 * @returns {Object} { speedMult, damageMult }
 */
function getPhaseMultipliers() {
    // Timer enrage takes precedence
    if (timerEnraged) {
        return { speedMult: TIMER_ENRAGE.speedMult, damageMult: TIMER_ENRAGE.damageMult };
    }
    
    const phaseConfig = BOSS_PHASES[currentPhase] || BOSS_PHASES.NORMAL;
    return { speedMult: phaseConfig.speedMult, damageMult: phaseConfig.damageMult };
}

/**
 * Start boss attack timers for current wave
 */
function startBossAttacks() {
    stopBossAttacks(); // Clear any existing timers
    
    const wave = WAVES[(localState?.currentWave || 1) - 1];
    if (!wave?.attacks) return;
    
    raidStartTime = Date.now();
    isEnraged = false;
    attackCooldowns = {};
    
    // Initialize cooldowns for each attack
    wave.attacks.forEach((attack, index) => {
        attackCooldowns[index] = Date.now() + attack.cooldown * 0.5; // First attack at half cooldown
    });
    
    // Main attack loop - check every second
    const mainTimer = setInterval(() => {
        if (localState?.status !== 'ACTIVE') {
            stopBossAttacks();
            return;
        }
        
        const { speedMult, damageMult } = getPhaseMultipliers();
        
        // Check each attack's cooldown
        wave.attacks.forEach((attack, index) => {
            if (Date.now() >= attackCooldowns[index]) {
                // In desperate phase, override to target lowest HP
                const modifiedAttack = { ...attack };
                if (currentPhase === 'DESPERATE' && BOSS_PHASES.DESPERATE.targetLowest) {
                    modifiedAttack.type = 'lowest_hp';
                }
                
                executeBossAttack(modifiedAttack, damageMult);
                
                // Reset cooldown (adjusted by speed multiplier)
                const cd = attack.cooldown / speedMult;
                attackCooldowns[index] = Date.now() + cd;
            }
        });
    }, 1000);
    
    bossAttackTimers.push(mainTimer);
}

/**
 * Stop all boss attack timers
 */
function stopBossAttacks() {
    bossAttackTimers.forEach(timer => clearInterval(timer));
    bossAttackTimers = [];
    attackCooldowns = {};
    
    // Clear particle interval
    if (particleInterval) {
        clearInterval(particleInterval);
        particleInterval = null;
    }
    currentParticlePhase = null;
}

/**
 * Execute a boss attack
 * @param {Object} attack - Attack config
 * @param {number} damageMult - Damage multiplier from phase
 */
async function executeBossAttack(attack, damageMult = 1) {
    const players = Object.entries(localState?.players || {}).filter(([id, p]) => p.health > 0);
    if (players.length === 0) return;
    
    let targets = [];
    
    // Select targets based on attack type
    if (attack.type === 'aoe') {
        // AOE hits everyone
        targets = players.map(([id, p]) => ({ id, name: p.name, maxHealth: p.maxHealth }));
    } else if (attack.type === 'lowest_hp') {
        // Target lowest HP players
        const sorted = [...players].sort((a, b) => {
            const aPercent = a[1].health / a[1].maxHealth;
            const bPercent = b[1].health / b[1].maxHealth;
            return aPercent - bPercent;
        });
        const count = Math.min(attack.targetCount || 1, sorted.length);
        targets = sorted.slice(0, count).map(([id, p]) => ({ id, name: p.name, maxHealth: p.maxHealth }));
    } else {
        // Random targets
        const shuffled = [...players].sort(() => Math.random() - 0.5);
        const count = Math.min(attack.targetCount || 1, shuffled.length);
        targets = shuffled.slice(0, count).map(([id, p]) => ({ id, name: p.name, maxHealth: p.maxHealth }));
    }
    
    // Check for puzzle failure buff
    let puzzleBuff = 1;
    const puzzleBuffData = localState?.enemy?.puzzleBuff;
    if (puzzleBuffData && puzzleBuffData.active && Date.now() < puzzleBuffData.endTime) {
        puzzleBuff = puzzleBuffData.damageMultiplier;
    }
    
    // Calculate damage for each target (with phase multiplier and puzzle buff)
    const targetData = targets.map(t => ({
        ...t,
        damage: Math.floor(t.maxHealth * attack.damagePercent * damageMult * puzzleBuff)
    }));
    
    // Broadcast warning to all players
    await updateData(`games/${roomCode}`, {
        'bossAttack': {
            name: attack.name,
            type: attack.type,
            warningText: attack.warningText,
            icon: attack.icon,
            targets: targetData,
            warningTime: attack.warningTime,
            timestamp: Date.now(),
            resolveAt: Date.now() + attack.warningTime
        }
    });
    
    // Host visual feedback
    const targetNames = targetData.map(t => t.name).join(', ');
    spawnDamage(`${attack.icon} ${attack.name}`, { layer: 'host-damage-layer', color: '#ff4757', size: '2.5rem' });
    notify(`${attack.name}`, 'crit', attack.type === 'aoe' ? 'ALL' : targetNames);
    
    // Trigger boss attack windup animation
    triggerBossAttackWindup();
    
    // Schedule damage application
    setTimeout(() => {
        applyBossAttackDamage(targetData, attack.name);
    }, attack.warningTime);
}

/**
 * Apply damage from boss attack after warning period
 * @param {Array} targets - Array of target data with damage amounts
 * @param {string} attackName - Name of the attack for logging
 */
async function applyBossAttackDamage(targets, attackName) {
    if (localState?.status !== 'ACTIVE') return;
    
    const updates = {};
    const currentPlayers = localState?.players || {};
    
    // Check if Iron Dome is active
    const ironDome = localState?.ironDome;
    const ironDomeActive = ironDome && ironDome.active && Date.now() < ironDome.endTime;
    
    if (ironDomeActive) {
        // Iron Dome blocks all damage!
        updates['bossAttack'] = null;
        
        // Host feedback - attack blocked
        flash('#3742fa', 300);
        spawnDamage('ðŸ›¡ï¸ IRON DOME BLOCKED!', { layer: 'host-damage-layer', color: '#3742fa', size: '3rem', isCrit: true });
        notify('Attack Blocked!', 'normal', 'Iron Dome');
        
        await updateData(`games/${roomCode}`, updates);
        return;
    }
    
    for (const target of targets) {
        const player = currentPlayers[target.id];
        if (!player || player.health <= 0) continue; // Skip dead players
        
        let damage = target.damage;
        const currentShield = player.shield || 0;
        
        // Shield absorbs damage first
        if (currentShield > 0) {
            if (currentShield >= damage) {
                // Shield absorbs all damage
                updates[`players/${target.id}/shield`] = currentShield - damage;
                damage = 0;
            } else {
                // Shield breaks, remaining damage goes through
                damage = damage - currentShield;
                updates[`players/${target.id}/shield`] = 0;
            }
        }
        
        if (damage > 0) {
            const newHealth = Math.max(0, player.health - damage);
            updates[`players/${target.id}/health`] = newHealth;
        }
    }
    
    // Clear the boss attack from state
    updates['bossAttack'] = null;
    
    await updateData(`games/${roomCode}`, updates);
    
    // Host feedback
    shake('heavy');
    flash('#ff4757', 200);
}

/**
 * Start the raid
 */
export async function startRaid() {
    if (!localState) return;
    
    const wave = WAVES[0];
    const playerCount = Math.max(1, Object.keys(localState.players || {}).length);
    const scaledHp = wave.hp + wave.scale * playerCount;
    
    // Reset state
    currentPhase = 'NORMAL';
    timerEnraged = false;
    currentParticlePhase = null; // Reset particle phase
    
    await updateData(`games/${roomCode}`, {
        status: 'ACTIVE',
        enemy: {
            name: wave.name,
            health: scaledHp,
            maxHealth: scaledHp,
            img: wave.img,
            phase: 'NORMAL'
        },
        bossAttack: null,
        timerEnraged: null
    });
    
    // Initialize boss particles (normal state)
    updateBossParticles(null);
    
    // Start boss attack timers and wave timer
    startBossAttacks();
    startWaveTimer();
}

/**
 * Trigger airstrike (host ability)
 */
export async function triggerAirstrike() {
    if (!localState) return;
    
    const newHealth = Math.max(0, localState.enemy.health - 10000);
    await updateData(`games/${roomCode}`, { 'enemy/health': newHealth });
    
    shake('heavy');
    flash('#ff4757', 300);
}

/**
 * Trigger supply drop (host ability)
 */
export async function triggerSupplyDrop() {
    if (!localState?.players) return;
    
    const updates = {};
    Object.keys(localState.players).forEach(pid => {
        updates[`players/${pid}/ultimateCharge`] = Math.min(100, (localState.players[pid].ultimateCharge || 0) + 25);
    });
    
    await updateData(`games/${roomCode}`, updates);
    flash('#2ed573', 200);
}

/**
 * Toggle pause state
 */
export async function togglePause() {
    if (!localState) return;
    
    const newStatus = localState.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
    await updateData(`games/${roomCode}`, { status: newStatus, bossAttack: null });
    
    if (newStatus === 'PAUSED') {
        stopBossAttacks();
        // Pause timer (store remaining time)
        if (waveTimerInterval && waveStartTime && waveTimeLimit) {
            const elapsed = Date.now() - waveStartTime;
            waveTimeLimit = Math.max(0, waveTimeLimit - elapsed);
            stopWaveTimer();
        }
    } else {
        startBossAttacks();
        // Resume timer
        if (waveTimeLimit > 0) {
            waveStartTime = Date.now();
            startWaveTimer();
        }
    }
}

/**
 * Open battle set manager for host to select/create question sets
 * @param {Function} onSelect - Callback when questions are selected
 */
export async function openMissionSelect(onSelect) {
    openBattleSetManager(onSelect);
}

// ============================================
// CHAOS MODE
// ============================================

let chaosModeEnabled = false;
let meteorCooldownTimer = null;
let drainCooldownTimer = null;
const CHAOS_COOLDOWN = 15000; // 15 seconds

/**
 * Toggle Chaos Mode on/off
 */
export function toggleChaosMode() {
    chaosModeEnabled = !chaosModeEnabled;
    
    const abilitiesDiv = document.getElementById('chaos-abilities');
    const sidebar = document.querySelector('#view-host .w-80');
    
    if (chaosModeEnabled) {
        abilitiesDiv?.classList.remove('hidden');
        sidebar?.classList.add('chaos-active');
        notify('CHAOS MODE ENABLED', 'crit', 'ðŸ’€');
    } else {
        abilitiesDiv?.classList.add('hidden');
        sidebar?.classList.remove('chaos-active');
        notify('Chaos Mode disabled', 'normal', '');
    }
}

/**
 * Chaos Mode: Meteor Strike - AOE damage to all players
 */
export async function chaosMeteorStrike() {
    if (!chaosModeEnabled || !localState?.players) return;
    
    const btn = document.getElementById('btn-meteor-strike');
    if (btn?.disabled) return;
    
    // Apply 20% max HP damage to all living players
    const updates = {};
    const players = localState.players;
    
    Object.keys(players).forEach(pid => {
        const player = players[pid];
        if (player.health > 0) {
            const damage = Math.floor(player.maxHealth * 0.20);
            const newHealth = Math.max(0, player.health - damage);
            updates[`players/${pid}/health`] = newHealth;
        }
    });
    
    // Broadcast to players
    updates['chaosEvent'] = {
        type: 'meteor_strike',
        warningText: 'METEOR STRIKE!',
        icon: 'â˜„ï¸',
        timestamp: Date.now()
    };
    
    await updateData(`games/${roomCode}`, updates);
    
    // Host feedback
    flash('#ff4757', 500);
    shake('heavy');
    spawnDamage('â˜„ï¸ METEOR STRIKE!', { layer: 'host-damage-layer', color: '#ff4757', size: '4rem', isCrit: true });
    notify('METEOR STRIKE!', 'crit', '-20% HP ALL');
    
    // Start cooldown
    startChaosCooldown('meteor');
}

/**
 * Chaos Mode: Shield Drain - Remove all shields from squad
 */
export async function chaosShieldDrain() {
    if (!chaosModeEnabled || !localState?.players) return;
    
    const btn = document.getElementById('btn-shield-drain');
    if (btn?.disabled) return;
    
    // Remove all shields
    const updates = {};
    const players = localState.players;
    let totalDrained = 0;
    
    Object.keys(players).forEach(pid => {
        const player = players[pid];
        if (player.shield && player.shield > 0) {
            totalDrained += player.shield;
            updates[`players/${pid}/shield`] = 0;
        }
    });
    
    if (totalDrained === 0) {
        notify('No shields to drain!', 'normal', '');
        return;
    }
    
    // Broadcast to players
    updates['chaosEvent'] = {
        type: 'shield_drain',
        warningText: 'SHIELDS DRAINED!',
        icon: 'ðŸ”¥',
        timestamp: Date.now()
    };
    
    await updateData(`games/${roomCode}`, updates);
    
    // Host feedback
    flash('#3742fa', 500);
    shake('heavy');
    spawnDamage('ðŸ”¥ SHIELDS DRAINED!', { layer: 'host-damage-layer', color: '#3742fa', size: '4rem', isCrit: true });
    notify('SHIELD DRAIN!', 'crit', `${totalDrained} ABSORBED`);
    
    // Start cooldown
    startChaosCooldown('drain');
}

/**
 * Start cooldown for a chaos ability
 * @param {string} ability - 'meteor' or 'drain'
 */
function startChaosCooldown(ability) {
    const btnId = ability === 'meteor' ? 'btn-meteor-strike' : 'btn-shield-drain';
    const cooldownId = ability === 'meteor' ? 'meteor-cooldown' : 'drain-cooldown';
    
    const btn = document.getElementById(btnId);
    const cooldownEl = document.getElementById(cooldownId);
    
    if (!btn || !cooldownEl) return;
    
    btn.disabled = true;
    btn.classList.add('on-cooldown');
    cooldownEl.classList.remove('hidden');
    
    let remaining = CHAOS_COOLDOWN / 1000;
    cooldownEl.textContent = `${remaining}s`;
    
    const timer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(timer);
            btn.disabled = false;
            btn.classList.remove('on-cooldown');
            cooldownEl.classList.add('hidden');
        } else {
            cooldownEl.textContent = `${remaining}s`;
        }
    }, 1000);
    
    if (ability === 'meteor') {
        meteorCooldownTimer = timer;
    } else {
        drainCooldownTimer = timer;
    }
}
