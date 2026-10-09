// Raid puzzles: played between bosses. Every class holds a piece of the
// answer, so the squad only gets through by talking to each other.
// Solving powers the squad up for the next boss; failing makes it harder.

export const SYMBOLS = [
    { id: 0, glyph: '▲', name: 'TRIANGLE' },
    { id: 1, glyph: '●', name: 'CIRCLE' },
    { id: 2, glyph: '■', name: 'SQUARE' },
    { id: 3, glyph: '◆', name: 'DIAMOND' },
    { id: 4, glyph: '✚', name: 'CROSS' },
    { id: 5, glyph: '★', name: 'STAR' }
];

export const COLORS = [
    { id: 'RED', hex: '#ff4757' },
    { id: 'BLUE', hex: '#4a8cff' },
    { id: 'GREEN', hex: '#2ed573' },
    { id: 'YELLOW', hex: '#ffd32a' },
    { id: 'PURPLE', hex: '#b06cff' },
    { id: 'ORANGE', hex: '#ff8c2a' }
];

export const MAX_STRIKES = 3;

export const PUZZLES = {
    vault: {
        id: 'vault',
        name: 'THE VAULT',
        kicker: 'RAID PUZZLE: LOCKDOWN',
        time: 120000,
        how: [
            'The vault needs a 4-symbol code.',
            'Your Chromebook shows a clue for a slot ANOTHER class has to enter.',
            'Shout your clue across the room. Clues point at the symbol wall on the projector.',
            'A wrong code is a strike. Three strikes and the alarm trips.'
        ],
        solved: { title: 'VAULT CRACKED', reward: 'ARMORY UNLOCKED', text: 'Full heal and +50% ultimate charge for everyone', heal: 1, ult: 50, mods: null },
        failed: { title: 'ALARM TRIPPED', reward: 'BOSS REINFORCED', text: 'No heal, and the next boss has +25% HP', heal: 0, ult: 0, mods: { bossHp: 1.25 } }
    },
    reactor: {
        id: 'reactor',
        name: 'REACTOR CORE',
        kicker: 'RAID PUZZLE: OVERLOAD',
        time: 120000,
        how: [
            'Restart the reactor by pressing in the right class order.',
            'Only the INTEL class can see the order. Everyone else listens.',
            'Press ONLY when your class is called. One press per step!',
            'A wrong press surges the core and resets the round. Three surges and it blacks out.'
        ],
        solved: { title: 'REACTOR STABLE', reward: 'OVERCHARGED', text: 'Full heal and +20% damage against the next boss', heal: 1, ult: 0, mods: { dmg: 1.2 } },
        failed: { title: 'BLACKOUT', reward: 'POWER LOST', text: 'No heal, ultimates drained, and the next boss hits 20% harder', heal: 0, ult: -100, mods: { bossDmg: 1.2 } }
    }
};

// Time allowed scales with difficulty
export const PUZZLE_TIME = { elementary: 1.3, regular: 1, heroic: 0.8 };
