// Bosses, raid formats and difficulty. All balance numbers in one place.

// roleCall: the class that can stop the attack while it winds up.
//   'GUARDIAN'  — shield anyone        'TACTICIAN' — Expose or System Breach
//   'MEDIC'     — heal anyone          'WARRIOR'   — any damage
//   'ALL'       — one action from every class present
// If the room has no one of that class, the call falls back to ANY.
export const BOSSES = {
    raider: {
        id: 'raider', name: 'WASTELAND RAIDER', color: '#ff4757', hpPerPlayer: 16000, timeLimit: 180000,
        intro: '"Let\'s see what you\'ve got, kids..."',
        attacks: [
            { id: 'saw', name: 'SAW SWING', kind: 'strike', targets: 2, dmg: 0.32, cooldown: 18000, windup: 5000 },
            { id: 'slam', name: 'GROUND SLAM', kind: 'aoe', dmg: 0.45, cooldown: 32000, windup: 10000, roleCall: 'GUARDIAN', callText: 'RAISE YOUR SHIELDS' }
        ]
    },
    enforcer: {
        id: 'enforcer', name: 'ELITE ENFORCER', color: '#ffa502', hpPerPlayer: 22000, timeLimit: 210000,
        intro: '"Your luck just ran out."',
        attacks: [
            { id: 'suppress', name: 'SUPPRESSING FIRE', kind: 'strike', targets: 3, dmg: 0.32, cooldown: 18000, windup: 5000 },
            { id: 'rail', name: 'RAIL SHOT', kind: 'lowest', targets: 3, dmg: 0.6, cooldown: 30000, windup: 10000, roleCall: 'TACTICIAN', callText: 'JAM THE RIFLE' }
        ]
    },
    construct: {
        id: 'construct', name: 'APEX CONSTRUCT', color: '#a55eea', hpPerPlayer: 28000, timeLimit: 240000,
        intro: '"THREAT DETECTED. INITIATING ELIMINATION PROTOCOL."',
        attacks: [
            { id: 'pulse', name: 'SYSTEM PULSE', kind: 'aoe', dmg: 0.45, cooldown: 30000, windup: 10000, roleCall: 'TACTICIAN', callText: 'JAM THE SIGNAL' },
            { id: 'virus', name: 'VIRUS UPLOAD', kind: 'infect', targets: 1, dmg: 0.1, cooldown: 35000, windup: 5000 },
            { id: 'lock', name: 'LOCK ON', kind: 'lowest', targets: 3, dmg: 0.6, cooldown: 28000, windup: 10000, roleCall: 'MEDIC', callText: 'PATCH THEM UP' }
        ]
    },
    omega: {
        id: 'omega', name: 'OMEGA WEAPON', color: '#ff2a3d', hpPerPlayer: 36000, timeLimit: 300000,
        intro: '"This is where it ends. For ALL of you."',
        attacks: [
            { id: 'barrage', name: 'OMEGA BARRAGE', kind: 'strike', targets: 4, dmg: 0.35, cooldown: 16000, windup: 5000 },
            { id: 'annihilate', name: 'ANNIHILATE', kind: 'lowest', targets: 3, dmg: 0.75, cooldown: 28000, windup: 10000, roleCall: 'GUARDIAN', callText: 'PROTECT THEM' },
            { id: 'extinction', name: 'EXTINCTION WAVE', kind: 'aoe', dmg: 0.6, cooldown: 42000, windup: 12000, roleCall: 'ALL', callText: 'EVERY CLASS — ACT NOW' }
        ]
    }
};

// Boss phases by HP fraction
export const PHASES = [
    { id: 'DESPERATE', below: 0.2, speed: 1.6, dmg: 1.3 },
    { id: 'ENRAGED', below: 0.5, speed: 1.25, dmg: 1.15 },
    { id: 'NORMAL', below: 1.01, speed: 1, dmg: 1 }
];
export const TIMER_ENRAGE = { speed: 1.35, dmg: 1.2 };

export const ROLE_CALL_REFLECT = 0.04;  // a successful role call reflects 4% of boss max HP
export const INFECTION_SPREAD_MS = 10000;
export const MIN_SCALING_PLAYERS = 3;   // boss HP never scales below 3 players
export const WIPE_REGROUP_MS = 8000;
export const WIPE_BOSS_HEAL = 0.15;
export const RAID_LIVES = 3;
export const PLAYER_LIVES = 3;

// Raid formats: the stage timeline the host director runs
export const FORMATS = {
    full: { name: 'Full Raid', desc: '4 bosses with raid puzzles between them (~25 min)', stages: ['boss:raider', 'puzzle', 'boss:enforcer', 'puzzle', 'boss:construct', 'puzzle', 'boss:omega'] },
    standard: { name: 'Standard Raid', desc: '4 bosses back to back (~18 min)', stages: ['boss:raider', 'boss:enforcer', 'boss:construct', 'boss:omega'] },
    quick: { name: 'Quick Raid', desc: '2 bosses and a puzzle (~10 min)', stages: ['boss:raider', 'puzzle', 'boss:omega'] }
};

export const DIFFICULTY = {
    elementary: { id: 'elementary', label: 'Elementary', desc: 'Forgiving: more HP, softer boss, longer warnings', wrongDmg: 0.05, playerHp: 1.3, bossHp: 0.8, bossDmg: 0.7, windup: 1.3, cooldownMod: -1, reviveNeed: 2 },
    regular: { id: 'regular', label: 'Regular', desc: 'The standard Raid Review experience', wrongDmg: 0.08, playerHp: 1, bossHp: 1, bossDmg: 1, windup: 1, cooldownMod: 0, reviveNeed: 3 },
    heroic: { id: 'heroic', label: 'Heroic', desc: 'For older students who want a real fight', wrongDmg: 0.12, playerHp: 0.85, bossHp: 1.25, bossDmg: 1.7, windup: 0.75, cooldownMod: 0, reviveNeed: 3 }
};
