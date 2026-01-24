/* ============================================ */
/* RAID REVIEW - Configuration                  */
/* ============================================ */

// Firebase Configuration
export const firebaseConfig = {
    apiKey: "AIzaSyAZEr2hAQSSfJKEO4w1x2f_qziWIAytocQ",
    authDomain: "raid-review-d6ad0.firebaseapp.com",
    databaseURL: "https://raid-review-d6ad0-default-rtdb.firebaseio.com",
    projectId: "raid-review-d6ad0"
};

// Class Definitions
export const CLASSES = {
    'WARRIOR': {
        color: '#ff4757',
        hp: 12000,
        ultName: "TITAN'S WRATH",
        basic: { name: 'SLASH', dmg: 800 },
        special: { name: 'RAGE', dmg: 2500, desc: '2500 DMG' },
        specialCooldown: 2,
        ultimate: {
            type: 'damage',
            baseDamage: 15000,
            comboCondition: 'armorShattered',
            comboDamage: 30000,
            comboName: 'CRITICAL SHATTER',
            consumesDebuff: true
        }
    },
    'GUARDIAN': {
        color: '#3742fa',
        hp: 20000,
        ultName: "IRON DOME",
        basic: { name: 'BASH', dmg: 800 },
        special: { name: 'SHIELD', type: 'shield', amount: 3000, desc: 'PROTECT' },
        specialCooldown: 4,
        ultimate: {
            type: 'protection',
            duration: 8000, // 8 seconds
            effect: 'invulnerability'
        }
    },
    'MEDIC': {
        color: '#2ed573',
        hp: 10000,
        ultName: "FIELD HOSPITAL",
        basic: { name: 'JAB', dmg: 600 },
        special: { name: 'HEAL', type: 'heal', amount: 0.35, desc: 'HEAL' },
        specialCooldown: 3,
        ultimate: {
            type: 'massHeal',
            healPercent: 0.4, // 40% max HP
            revivePercent: 0.3, // Revive at 30% HP
            effect: 'squadHeal'
        }
    },
    'TACTICIAN': {
        color: '#a55eea',
        hp: 11000,
        ultName: "SYSTEM BREACH",
        basic: { name: 'DISRUPT', dmg: 1000 },
        special: { name: 'BOOST', type: 'buff', damageBonus: 1.5, desc: 'BUFF' },
        specialCooldown: 3,
        ultimate: {
            type: 'debuff',
            duration: 15000, // 15 seconds
            effect: 'armorShattered',
            damageMultiplier: 1.5 // Boss takes 50% more damage
        }
    }
};

// Support class names (classes that can target allies)
export const SUPPORT_CLASSES = ['GUARDIAN', 'MEDIC', 'TACTICIAN'];

// Boss Phase Thresholds
export const BOSS_PHASES = {
    NORMAL: { threshold: 0.5, name: 'NORMAL', speedMult: 1.0, damageMult: 1.0, color: null },
    ENRAGED: { threshold: 0.25, name: 'ENRAGED', speedMult: 1.5, damageMult: 1.25, color: '#ffa502' },
    DESPERATE: { threshold: 0, name: 'DESPERATE', speedMult: 1.75, damageMult: 1.25, targetLowest: true, color: '#ff4757' }
};

// Timer enrage settings (when wave timer expires)
export const TIMER_ENRAGE = {
    speedMult: 2.0,
    damageMult: 2.0
};

// Wave/Boss Definitions (rebalanced for faster, more fun gameplay)
export const WAVES = [
    {
        name: "WASTELAND RAIDER",
        hp: 20000,
        scale: 2000,
        timeLimit: 120000, // 2 minutes
        img: "https://i.imgur.com/2E3BETA.png",
        attacks: [
            {
                name: "RAIDER STRIKE",
                type: "targeted",
                targetCount: 2,
                damagePercent: 0.15,
                cooldown: 45000,
                warningTime: 5000,
                warningText: "RAIDER IS TARGETING",
                icon: "âš”ï¸"
            }
        ]
    },
    {
        name: "ELITE ENFORCER",
        hp: 35000,
        scale: 3000,
        timeLimit: 150000, // 2.5 minutes
        img: "https://i.imgur.com/0HB8hSb.png",
        attacks: [
            {
                name: "SUPPRESSING FIRE",
                type: "targeted",
                targetCount: 3,
                damagePercent: 0.18,
                cooldown: 35000,
                warningTime: 4000,
                warningText: "ENFORCER IS TARGETING",
                icon: "ðŸ”«"
            },
            {
                name: "HEAVY STRIKE",
                type: "targeted",
                targetCount: 1,
                damagePercent: 0.28,
                cooldown: 60000,
                warningTime: 4000,
                warningText: "HEAVY STRIKE INCOMING",
                icon: "ðŸ’¥"
            }
        ]
    },
    {
        name: "APEX CONSTRUCT",
        hp: 50000,
        scale: 4000,
        timeLimit: 180000, // 3 minutes
        img: "https://i.imgur.com/womxFfo.png",
        attacks: [
            {
                name: "SYSTEM PULSE",
                type: "aoe",
                damagePercent: 0.10,
                cooldown: 30000,
                warningTime: 3000,
                warningText: "SYSTEM PULSE CHARGING",
                icon: "âš¡"
            },
            {
                name: "LOCK ON",
                type: "lowest_hp",
                targetCount: 1,
                damagePercent: 0.35,
                cooldown: 50000,
                warningTime: 4000,
                warningText: "LOCK ON ACQUIRED",
                icon: "ðŸŽ¯"
            }
        ]
    },
    {
        name: "OMEGA WEAPON",
        hp: 75000,
        scale: 5000,
        timeLimit: 240000, // 4 minutes
        img: "https://i.imgur.com/zlNufo0.png",
        attacks: [
            {
                name: "OMEGA BARRAGE",
                type: "targeted",
                targetCount: 4,
                damagePercent: 0.20,
                cooldown: 25000,
                warningTime: 3000,
                warningText: "OMEGA BARRAGE INCOMING",
                icon: "âš”ï¸"
            },
            {
                name: "ANNIHILATE",
                type: "lowest_hp",
                targetCount: 1,
                damagePercent: 0.40,
                cooldown: 45000,
                warningTime: 3500,
                warningText: "ANNIHILATE TARGET",
                icon: "ðŸ”¥"
            },
            {
                name: "EXTINCTION WAVE",
                type: "aoe",
                damagePercent: 0.15,
                cooldown: 60000,
                warningTime: 4000,
                warningText: "EXTINCTION WAVE CHARGING",
                icon: "ðŸ’€"
            }
        ]
    }
];

// Flavor text for damage numbers
export const DAMAGE_FLAVOR = {
    hit: ["BOOM!", "POW!", "WHAM!", "SMACK!", "THWACK!"],
    crit: ["DEVASTATING!", "OBLITERATED!", "CRUSHED!", "ANNIHILATED!", "ðŸ”¥"],
    miss: ["YIKES!", "OOF!", "NOPE!", "WHOOPS!", "MISS!"],
    heal: ["PATCHED UP!", "RESTORED!", "REFRESHED!", "MENDED!"],
    shield: ["BLOCKED!", "DENIED!", "DEFLECTED!", "ABSORBED!"]
};

// Default Question Set
export const DEFAULT_QUESTIONS = [
    {
        text: "Which river was essential to Egyptian life?",
        answers: ["Nile", "Amazon", "Tigris", "Yangtze"],
        correct: 0
    },
    {
        text: "Who was the first female Pharaoh?",
        answers: ["Cleopatra", "Nefertiti", "Hatshepsut", "Isis"],
        correct: 2
    },
    {
        text: "What structure served as a tomb for Pharaohs?",
        answers: ["Ziggurat", "Pyramid", "Temple", "Obelisk"],
        correct: 1
    },
    {
        text: "The writing system of ancient Egypt was?",
        answers: ["Cuneiform", "Latin", "Hieroglyphs", "Greek"],
        correct: 2
    },
    {
        text: "Which pharaoh's tomb was found intact in 1922?",
        answers: ["Ramses II", "Tutankhamun", "Akhenaten", "Khufu"],
        correct: 1
    },
    {
        text: "Who was the sun god?",
        answers: ["Osiris", "Ra", "Thoth", "Set"],
        correct: 1
    },
    {
        text: "The Great Sphinx has the body of a?",
        answers: ["Lion", "Eagle", "Bull", "Dog"],
        correct: 0
    },
    {
        text: "Paper was made from which plant?",
        answers: ["Papyrus", "Bamboo", "Wheat", "Cotton"],
        correct: 0
    }
];

// Combo streak thresholds and names
export const STREAK_MILESTONES = {
    3: 'TRIPLE!',
    5: 'RAMPAGE!',
    7: 'DOMINATING!',
    10: 'UNSTOPPABLE!',
    15: 'GODLIKE!'
};

// Combo multiplier thresholds
export const COMBO_MULTIPLIERS = [
    { threshold: 10, mult: 2.0 },
    { threshold: 7, mult: 1.75 },
    { threshold: 5, mult: 1.5 },
    { threshold: 3, mult: 1.25 },
    { threshold: 0, mult: 1.0 }
];

// Raid Puzzle Configuration (Wave 2 - Standard)
export const PUZZLE_CONFIG = {
    timeLimit: 45000, // 45 seconds
    codeLength: 6,
    rewards: {
        healPercent: 0.25, // 25% max HP heal
        ultCharge: 15      // 15% ult charge
    },
    penalty: {
        bossDamageBuff: 1.25, // 25% more damage
        duration: 30000       // 30 seconds
    }
};

// Raid Puzzle Configuration (Wave 3 - Virus/Infected)
export const PUZZLE_CONFIG_VIRUS = {
    timeLimit: 90000, // 90 seconds - need time to deduce
    codeLength: 6,
    infectedCount: 1, // Number of infected players
    rewards: {
        healPercent: 0.25,
        ultCharge: 15
    },
    penalty: {
        bossDamageBuff: 1.25,
        duration: 30000
    }
};

// Raid Puzzle Configuration (Wave 4 - Symbols)
export const PUZZLE_CONFIG_SYMBOLS = {
    timeLimit: 120000, // 120 seconds - need time to describe symbols
    codeLength: 6,
    rewards: {
        healPercent: 0.30, // Slightly better rewards for final puzzle
        ultCharge: 20
    },
    penalty: {
        bossDamageBuff: 1.5, // Harsher penalty before final boss
        duration: 45000
    }
};
};

// Symbol set for Wave 4 puzzle
export const PUZZLE_SYMBOLS = [
    { id: 0, symbol: '●', name: 'Circle' },
    { id: 1, symbol: '▲', name: 'Triangle' },
    { id: 2, symbol: '◆', name: 'Diamond' },
    { id: 3, symbol: '★', name: 'Star' },
    { id: 4, symbol: '⬡', name: 'Hexagon' },
    { id: 5, symbol: '✚', name: 'Cross' },
    { id: 6, symbol: '≈', name: 'Waves' },
    { id: 7, symbol: '⊕', name: 'Circle Plus' },
    { id: 8, symbol: '◐', name: 'Half Circle' },
    { id: 9, symbol: '⚡', name: 'Zigzag' },
    { id: 10, symbol: '◆', name: 'Filled Diamond' },
    { id: 11, symbol: '⚡', name: 'Lightning' }
];
