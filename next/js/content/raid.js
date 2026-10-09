// Bosses, raid formats and difficulty. All balance numbers in one place.

// roleCall: the class that can stop the attack while it winds up.
//   'GUARDIAN'  — shield anyone        'TACTICIAN' — Expose or System Breach
//   'MEDIC'     — heal anyone          'WARRIOR'   — any damage
//   'ALL'       — one action from every class present
// If the room has no one of that class, the call falls back to ANY.
// Each boss teaches one thing, and the final boss tests all of it. Health bars
// stay short: the challenge comes from the mechanics, not from a bullet sponge.
//
// beats: scripted moments at a boss-HP fraction
//   stagger    the boss reels: stunned and Exposed, "every class hit it NOW"
//   force      the boss immediately starts the named attack
//   lastStand  the boss charges a squad-wiping attack; every class still standing
//              must fire its ultimate before the countdown ends (ultimates are
//              topped up when it starts)
//   eshield    ELEMENTAL SHIELD: only one class can damage the shield (everyone
//              else barely scratches the boss). Break it in time for a stagger;
//              let the timer run out and it bursts on the whole squad.
//
// weakness: one class at a time hits the boss's weak spot for `mult`× damage.
//           The weak spot moves to another class every `everyMs`.
//
// attack kinds beyond strike / aoe / lowest / infect:
//   mark     SNIPER MARK: a near-lethal shot on a few students. A shield on the
//            target blocks it AND ricochets `ricochet` of the boss's HP back.
//   silence  a whole class can only basic-attack for `ms`. Shields block it,
//            Medic heals cleanse it.
//   drones   REPAIR DRONES: shoot them down (role call) or the boss heals `heal`.
export const BOSSES = {
    raider: {
        id: 'raider', name: 'WASTELAND RAIDER', color: '#ff4757', hpPerPlayer: 5000, timeLimit: 150000,
        lesson: 'WARM-UP: answer, act, and talk. Watch the WEAK SPOT: one class at a time deals ×2.5 damage.',
        intro: '"Let\'s see what you\'ve got, kids..."',
        attacks: [
            { id: 'saw', name: 'SAW SWING', kind: 'strike', targets: 2, dmg: 0.22, cooldown: 20000, windup: 6000 },
            { id: 'slam', name: 'GROUND SLAM', kind: 'aoe', dmg: 0.4, cooldown: 34000, windup: 12000, roleCall: 'GUARDIAN', callText: 'RAISE YOUR SHIELDS' }
        ],
        weakness: { everyMs: 20000, mult: 2.5 },
        beats: [{ at: 0.5, kind: 'stagger', stun: 9000, expose: 9000, text: 'IT\'S STAGGERED! EVERY CLASS HIT IT NOW!' }]
    },
    enforcer: {
        id: 'enforcer', name: 'ELITE ENFORCER', color: '#ffa502', hpPerPlayer: 10500, timeLimit: 180000,
        lesson: 'PROTECT THE WEAK: the Rail Shot hunts whoever is lowest on health, and the Sniper Mark must be shielded.',
        intro: '"Your luck just ran out."',
        attacks: [
            { id: 'suppress', name: 'SUPPRESSING FIRE', kind: 'strike', targets: 3, dmg: 0.3, cooldown: 18000, windup: 5000 },
            { id: 'rail', name: 'RAIL SHOT', kind: 'lowest', targets: 3, dmg: 0.85, cooldown: 28000, windup: 10000, roleCall: 'TACTICIAN', callText: 'JAM THE RIFLE' },
            { id: 'flash', name: 'FLASHBANG', kind: 'aoe', dmg: 0.3, cooldown: 40000, windup: 10000, roleCall: 'GUARDIAN', callText: 'SHIELD UP' },
            { id: 'snipe', name: 'SNIPER MARK', kind: 'mark', targets: 1, dmg: 1.3, ricochet: 0.05, cooldown: 26000, windup: 9000 }
        ],
        weakness: { everyMs: 20000, mult: 2.5 },
        beats: [{ at: 0.5, kind: 'stagger', stun: 7000, expose: 7000, text: 'IT\'S STAGGERED! EVERY CLASS HIT IT NOW!' }]
    },
    construct: {
        id: 'construct', name: 'APEX CONSTRUCT', color: '#a55eea', hpPerPlayer: 12500, timeLimit: 210000,
        lesson: 'THE VIRUS: it spreads. Medics cure it, Guardian shields block it. Shoot down the Repair Drones!',
        intro: '"THREAT DETECTED. UPLOADING VIRUS."',
        virus: { spreadMs: 6000, dmg: 0.07, overloadShare: 0.4, overloadDmg: 0.25, overloadCd: 20000 },
        attacks: [
            { id: 'virus', name: 'VIRUS UPLOAD', kind: 'infect', targets: 2, dmg: 0.08, cooldown: 22000, windup: 5000 },
            { id: 'pulse', name: 'SYSTEM PULSE', kind: 'aoe', dmg: 0.45, cooldown: 32000, windup: 10000, roleCall: 'TACTICIAN', callText: 'JAM THE SIGNAL' },
            { id: 'lock', name: 'LOCK ON', kind: 'lowest', targets: 3, dmg: 0.75, cooldown: 30000, windup: 10000, roleCall: 'MEDIC', callText: 'PATCH THEM UP' },
            { id: 'drones', name: 'REPAIR DRONES', kind: 'drones', heal: 0.08, cooldown: 38000, windup: 10000, roleCall: 'WARRIOR', callText: 'SHOOT DOWN THE DRONES' },
            { id: 'silence', name: 'SILENCE PROTOCOL', kind: 'silence', ms: 8000, cooldown: 34000, windup: 7000 }
        ],
        weakness: { everyMs: 20000, mult: 2.5 },
        beats: [{ at: 0.5, kind: 'stagger', stun: 7000, expose: 7000, text: 'SYSTEM CRASH! EVERY CLASS HIT IT NOW!' }]
    },
    omega: {
        id: 'omega', name: 'OMEGA WEAPON', color: '#ff2a3d', hpPerPlayer: 23500, timeLimit: 300000,
        lesson: 'THE FINAL TEST: everything you\'ve learned, then a last stand that needs every class.',
        intro: '"This is where it ends. For ALL of you."',
        virus: { spreadMs: 8000, dmg: 0.06, overloadShare: 0.5, overloadDmg: 0.25, overloadCd: 25000 },
        attacks: [
            { id: 'barrage', name: 'OMEGA BARRAGE', kind: 'strike', targets: 4, dmg: 0.36, cooldown: 16000, windup: 5000 },
            { id: 'annihilate', name: 'ANNIHILATE', kind: 'lowest', targets: 3, dmg: 0.95, cooldown: 28000, windup: 10000, roleCall: 'GUARDIAN', callText: 'PROTECT THEM' },
            { id: 'plague', name: 'PLAGUE ROUND', kind: 'infect', targets: 1, dmg: 0.1, cooldown: 34000, windup: 5000 },
            { id: 'extinction', name: 'EXTINCTION WAVE', kind: 'aoe', dmg: 0.85, cooldown: 45000, windup: 12000, roleCall: 'ALL', callText: 'EVERY CLASS — ACT NOW' },
            { id: 'snipe', name: 'SNIPER MARK', kind: 'mark', targets: 1, dmg: 1.3, ricochet: 0.04, cooldown: 30000, windup: 9000 }
        ],
        weakness: { everyMs: 20000, mult: 2.5 },
        beats: [
            { at: 0.85, kind: 'eshield', hp: 0.03, ms: 25000, dmg: 0.3, text: 'ELEMENTAL SHIELD! ONLY ONE CLASS CAN BREAK IT!' },
            { at: 0.42, kind: 'eshield', hp: 0.03, ms: 25000, dmg: 0.35, text: 'ELEMENTAL SHIELD! ONLY ONE CLASS CAN BREAK IT!' },
            { at: 0.6, kind: 'force', attack: 'extinction', text: 'PHASE 2: EXTINCTION WAVE INCOMING!' },
            { at: 0.25, kind: 'lastStand', ms: 22000, dmg: 0.9, text: 'LAST STAND! EVERY CLASS: FIRE YOUR ULTIMATE!' }
        ]
    }
};

// Boss phases by HP fraction
export const PHASES = [
    { id: 'DESPERATE', below: 0.2, speed: 1.6, dmg: 1.3 },
    { id: 'ENRAGED', below: 0.5, speed: 1.25, dmg: 1.15 },
    { id: 'NORMAL', below: 1.01, speed: 1, dmg: 1 }
];
// When the clock runs out the boss enrages, then keeps getting stronger every
// `stackMs` until the squad finishes it or wipes. Too slow means you lose.
export const TIMER_ENRAGE = { speed: 1.35, dmg: 1.2, stackMs: 20000, stackDmg: 0.25, stackSpeed: 0.1 };

export const ESHIELD_LEAK = 0.2;                       // other classes' hits that get through an Elemental Shield
export const ESHIELD_BREAK = { stun: 6000, expose: 10000 }; // breaking it staggers the boss
export const ROLE_CALL_REFLECT = 0.08;  // a successful role call reflects 8% of boss max HP: teamwork takes big chunks
export const INFECTION_SPREAD_MS = 8000; // default if a boss doesn't set its own virus
export const MIN_SCALING_PLAYERS = 3;   // boss HP never scales below 3 players
export const WIPE_REGROUP_MS = 8000;
export const WIPE_BOSS_HEAL = 0.15;
export const RAID_LIVES = 3;
export const PLAYER_LIVES = 3;

// Raid formats: the stage timeline the host director runs
export const FORMATS = {
    full: { name: 'Full Raid', desc: 'All 4 bosses and 2 raid puzzles (~25 min)', stages: ['boss:raider', 'puzzle:vault', 'boss:enforcer', 'boss:construct', 'puzzle:reactor', 'boss:omega'] },
    standard: { name: 'Boss Rush', desc: 'All 4 bosses back to back, no puzzles (~18 min)', stages: ['boss:raider', 'boss:enforcer', 'boss:construct', 'boss:omega'] },
    quick: { name: 'Quick Raid', desc: 'Warm-up boss, the Vault, then the final boss (~12 min)', stages: ['boss:raider', 'puzzle:vault', 'boss:omega'] }
};

export const DIFFICULTY = {
    elementary: { id: 'elementary', label: 'Elementary', desc: 'Forgiving: more HP, a softer boss, longer timers. Start here with a new class or tough material', wrongDmg: 0.05, playerHp: 1.3, bossHp: 0.65, bossDmg: 0.85, time: 1.25, windup: 1.3, cooldownMod: -1, reviveNeed: 2 },
    regular: { id: 'regular', label: 'Regular', desc: 'A real raid. Squads that talk to each other win; squads that don\'t, wipe', wrongDmg: 0.08, playerHp: 1, bossHp: 1, bossDmg: 1.15, time: 1, windup: 1, cooldownMod: 0, reviveNeed: 3 },
    heroic: { id: 'heroic', label: 'Heroic', desc: 'Brutal. For veteran squads who want to earn it', wrongDmg: 0.12, playerHp: 0.85, bossHp: 1.5, bossDmg: 2.0, time: 0.95, windup: 0.75, cooldownMod: 0, reviveNeed: 3 }
};
