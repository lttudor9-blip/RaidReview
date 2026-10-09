// Upgrades ("loot") the squad votes on after each boss. Each class has its own
// pool; one upgrade per class unlocks per vote and lasts the rest of the raid,
// so by the final boss every class has its own build (a small skill tree).

export const PERKS = {
    // ------------------------------------------------ Warrior
    w_bloodlust: { cls: 'WARRIOR', name: 'BLOODLUST', icon: '🩸', rarity: 'epic', desc: 'All Warrior attacks deal +20% damage.' },
    w_executioner: { cls: 'WARRIOR', name: 'EXECUTIONER', icon: '🪓', rarity: 'rare', desc: 'Cleave always lands as a critical hit (×1.5).' },
    w_shatterpoint: { cls: 'WARRIOR', name: 'SHATTERPOINT', icon: '💥', rarity: 'legendary', desc: 'SHATTER combos deal +50% damage.' },
    w_fury: { cls: 'WARRIOR', name: 'TITAN\'S FURY', icon: '⚡', rarity: 'epic', desc: 'Your ultimate charges 30% faster.' },
    w_ironskin: { cls: 'WARRIOR', name: 'IRON SKIN', icon: '🛡️', rarity: 'rare', desc: '+25% max HP for every Warrior.' },
    // ------------------------------------------------ Guardian
    g_aegis: { cls: 'GUARDIAN', name: 'AEGIS', icon: '🔰', rarity: 'legendary', desc: 'Shields block TWO hits instead of one.' },
    g_bastion: { cls: 'GUARDIAN', name: 'BASTION', icon: '🏰', rarity: 'epic', desc: 'Iron Dome lasts 12 seconds instead of 8.' },
    g_spikes: { cls: 'GUARDIAN', name: 'SPIKED SHIELD', icon: '🌵', rarity: 'rare', desc: 'Every hit a shield blocks strikes the boss back.' },
    g_rallycry: { cls: 'GUARDIAN', name: 'RALLY CRY', icon: '📯', rarity: 'epic', desc: 'Your ultimate charges 30% faster.' },
    g_fortress: { cls: 'GUARDIAN', name: 'FORTRESS', icon: '🧱', rarity: 'rare', desc: '+25% max HP for every Guardian.' },
    // ------------------------------------------------ Medic
    m_overflow: { cls: 'MEDIC', name: 'OVERFLOW', icon: '💧', rarity: 'epic', desc: 'Heals restore 45% HP instead of 30%.' },
    m_secondwind: { cls: 'MEDIC', name: 'SECOND WIND', icon: '🌬️', rarity: 'legendary', desc: 'Revived teammates come back at 70% HP.' },
    m_splash: { cls: 'MEDIC', name: 'SPLASH HEAL', icon: '🌊', rarity: 'epic', desc: 'Each heal also heals the two lowest teammates for half.' },
    m_triage: { cls: 'MEDIC', name: 'TRIAGE', icon: '⚡', rarity: 'rare', desc: 'Your ultimate charges 30% faster.' },
    m_vitality: { cls: 'MEDIC', name: 'VITALITY', icon: '❤️', rarity: 'rare', desc: '+25% max HP for every Medic.' },
    // ------------------------------------------------ Tactician
    t_deepscan: { cls: 'TACTICIAN', name: 'DEEP SCAN', icon: '🔭', rarity: 'epic', desc: 'Expose lasts twice as long (16 seconds).' },
    t_weakpoint: { cls: 'TACTICIAN', name: 'WEAK POINT', icon: '🎯', rarity: 'legendary', desc: 'Exposed bosses take +40% damage instead of +25%.' },
    t_overclock: { cls: 'TACTICIAN', name: 'OVERCLOCK', icon: '⏱️', rarity: 'rare', desc: 'System Breach stuns the boss for 15 seconds.' },
    t_overwatch: { cls: 'TACTICIAN', name: 'OVERWATCH', icon: '⚡', rarity: 'epic', desc: 'Your ultimate charges 30% faster.' },
    t_firewall: { cls: 'TACTICIAN', name: 'FIREWALL', icon: '🧯', rarity: 'rare', desc: '+25% max HP for every Tactician.' }
};

export const RARITY = {
    rare: { label: 'RARE', color: '#4a8cff' },
    epic: { label: 'EPIC', color: '#b06cff' },
    legendary: { label: 'LEGENDARY', color: '#ffb020' }
};

export const VOTE_MS = 30000;      // how long the vote runs
export const VOTE_MIN_MS = 8000;   // never ends earlier than this, even if everyone voted
export const REVEAL_MS = 7000;     // how long the winners stay on screen
