// The four classes. Every number that affects balance lives here or in raid.js,
// so tuning never means hunting through game code.

export const CLASS_IDS = ['WARRIOR', 'GUARDIAN', 'MEDIC', 'TACTICIAN'];

export const CLASSES = {
    WARRIOR: {
        id: 'WARRIOR', name: 'Warrior', role: 'Damage', color: '#ff4757', hp: 1200,
        tagline: 'Hit first. Hit hardest.',
        passive: 'Rage: answer streaks boost your damage twice as much as other classes.',
        abilities: {
            basic: { id: 'strike', name: 'Strike', kind: 'damage', power: 800, desc: 'Deal 800 damage.' },
            special: { id: 'cleave', name: 'Cleave', kind: 'damage', power: 1400, cooldown: 2, desc: 'Deal 1,400 damage. Crits for ×1.5 on an Exposed boss.' },
            ult: { id: 'wrath', name: "Titan's Wrath", kind: 'damage', power: 6000, comboPower: 12000, desc: 'Deal 6,000 damage, or 12,000 on an Exposed boss (SHATTER).' }
        }
    },
    GUARDIAN: {
        id: 'GUARDIAN', name: 'Guardian', role: 'Protect', color: '#3742fa', hp: 1800,
        tagline: 'Nobody falls on my watch.',
        passive: 'Bulwark: you have the most HP of any class, and your Shield answers the boss\'s Guardian role calls.',
        abilities: {
            basic: { id: 'bash', name: 'Bash', kind: 'damage', power: 650, desc: 'Deal 650 damage.' },
            special: { id: 'shield', name: 'Shield', kind: 'shield', target: 'ally', cooldown: 2, desc: 'Shield an ally (or yourself). Blocks their next hit.' },
            ult: { id: 'dome', name: 'Iron Dome', kind: 'dome', duration: 8000, desc: 'The whole squad is invulnerable for 8 seconds.' }
        }
    },
    MEDIC: {
        id: 'MEDIC', name: 'Medic', role: 'Sustain', color: '#2ed573', hp: 1000,
        tagline: 'Keep them standing.',
        passive: 'Lifeline: healing a downed ally revives them on the spot. Your heals cure infection.',
        abilities: {
            basic: { id: 'jab', name: 'Jab', kind: 'damage', power: 550, desc: 'Deal 550 damage.' },
            special: { id: 'heal', name: 'Heal', kind: 'heal', target: 'ally', amount: 0.3, reviveAmount: 0.4, cooldown: 2, desc: 'Heal an ally for 30% HP, cure infection, or revive a downed ally.' },
            ult: { id: 'hospital', name: 'Field Hospital', kind: 'massHeal', amount: 0.3, reviveAmount: 0.4, desc: 'Heal everyone 30% and revive every downed ally.' }
        }
    },
    TACTICIAN: {
        id: 'TACTICIAN', name: 'Tactician', role: 'Control', color: '#a55eea', hp: 1100,
        tagline: 'Find the weak point. Exploit it.',
        passive: 'Insight: your Expose makes the whole team hit harder and answers JAM calls.',
        abilities: {
            basic: { id: 'disrupt', name: 'Disrupt', kind: 'damage', power: 750, desc: 'Deal 750 damage.' },
            special: { id: 'expose', name: 'Expose', kind: 'expose', duration: 8000, bonus: 0.25, cooldown: 2, desc: 'Expose the boss: it takes +25% damage from everyone for 8 seconds.' },
            ult: { id: 'breach', name: 'System Breach', kind: 'breach', stun: 10000, expose: 12000, desc: 'Cancel the boss\'s attack, stun it for 10 seconds, and Expose it for 12.' }
        }
    }
};

// Team synergy: distinct classes that acted in the last SYNERGY_WINDOW ms
export const SYNERGY_WINDOW = 10000;
export const SYNERGY_MULT = [1, 1, 1.1, 1.2, 1.35]; // index = number of distinct classes
// A raid made of a single class can never build synergy and hits weaker
export const MONO_CLASS_PENALTY = 0.7;

// Answer streak damage bonus (Warriors get double)
export const STREAK_BONUS = [
    { at: 8, bonus: 0.3 },
    { at: 5, bonus: 0.2 },
    { at: 3, bonus: 0.1 }
];

export const ULT_PER_CORRECT = 8;
export const ULT_PER_SUPPORT = 4;   // extra charge for shielding / healing / exposing
export const SPIRIT_RALLY_PER_CORRECT = 8; // eliminated students still help the team
