// Ability icons: one code-drawn SVG per ability (viewBox 0 0 100 100).
// Drawn with `currentColor` accents so each picks up its class color.

const I = {
    // ---------------- WARRIOR
    strike: `<path d="M22 80 L66 22 L78 18 L74 30 L30 86 Z" fill="#e8ebf2" stroke="#111" stroke-width="4" stroke-linejoin="round"/>
        <path d="M18 70 L34 86" stroke="#c9a34a" stroke-width="8" stroke-linecap="round"/><path d="M12 92 L22 82" stroke="#5a3a20" stroke-width="7" stroke-linecap="round"/>
        <path d="M52 16 Q78 22 86 48" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".9"/>`,
    cleave: `<path d="M50 10 L54 90" stroke="#5a3a20" stroke-width="8" stroke-linecap="round"/>
        <path d="M54 18 Q92 22 90 52 Q74 46 56 50 Z" fill="#e8ebf2" stroke="#111" stroke-width="4" stroke-linejoin="round"/>
        <path d="M50 18 Q12 22 14 52 Q30 46 48 50 Z" fill="#c9ced8" stroke="#111" stroke-width="4" stroke-linejoin="round"/>
        <path d="M8 70 Q50 40 92 70" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`,
    wrath: `<path d="M50 4 C64 24 76 34 70 58 C66 74 56 82 50 86 C44 82 34 74 30 58 C24 34 36 24 42 12 C44 26 48 30 52 32 C50 22 48 14 50 4 Z" fill="#ffb020" stroke="#2a0408" stroke-width="4"/>
        <path d="M46 30 L54 30 L54 76 L50 84 L46 76 Z" fill="#fff6d8" stroke="#2a0408" stroke-width="3"/><path d="M34 74 L66 74" stroke="#c9a34a" stroke-width="7" stroke-linecap="round"/>
        <path d="M50 78 L50 96" stroke="#5a3a20" stroke-width="7" stroke-linecap="round"/>`,
    // ---------------- GUARDIAN
    bash: `<path d="M50 8 L84 20 V50 Q84 76 50 92 Q16 76 16 50 V20 Z" fill="#26357a" stroke="#c8d4ff" stroke-width="5" stroke-linejoin="round"/>
        <path d="M38 40 h24 v18 h-24 z" fill="#c8d4ff" stroke="#0a1030" stroke-width="3"/><path d="M66 32 L90 26 M66 50 L94 50 M66 66 L90 74" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`,
    shield: `<path d="M50 6 L86 18 V48 Q86 76 50 94 Q14 76 14 48 V18 Z" fill="#26357a" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>
        <path d="M44 30 h12 v14 h14 v12 h-14 v14 h-12 v-14 h-14 v-12 h14 z" fill="#e8eeff" stroke="#0a1030" stroke-width="3"/>`,
    dome: `<path d="M8 78 Q8 22 50 18 Q92 22 92 78 Z" fill="rgba(125,149,255,.25)" stroke="currentColor" stroke-width="6"/>
        <path d="M22 78 Q24 40 50 34 Q76 40 78 78" fill="none" stroke="#c8d4ff" stroke-width="3" stroke-dasharray="6 5"/>
        <path d="M4 80 H96" stroke="#c8d4ff" stroke-width="6" stroke-linecap="round"/><circle cx="50" cy="60" r="8" fill="#e8eeff"/>`,
    // ---------------- MEDIC
    jab: `<path d="M24 76 L62 38" stroke="#e8f8ee" stroke-width="16" stroke-linecap="round"/><path d="M24 76 L62 38" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
        <path d="M62 38 L84 16" stroke="#c9ced8" stroke-width="4" stroke-linecap="round"/><path d="M58 30 L70 42" stroke="#111" stroke-width="5" stroke-linecap="round"/><path d="M14 86 L26 74" stroke="#5a5e68" stroke-width="7" stroke-linecap="round"/>`,
    heal: `<path d="M50 88 C20 66 8 50 10 34 C12 18 32 12 50 30 C68 12 88 18 90 34 C92 50 80 66 50 88 Z" fill="#0f5a35" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>
        <path d="M44 30 h12 v12 h12 v12 h-12 v12 h-12 v-12 h-12 v-12 h12 z" fill="#ffffff" stroke="#03200f" stroke-width="3"/>`,
    hospital: `<path d="M50 6 L94 30 V40 H6 V30 Z" fill="currentColor" stroke="#03200f" stroke-width="4" stroke-linejoin="round"/>
        <rect x="14" y="40" width="72" height="50" fill="#0f5a35" stroke="#03200f" stroke-width="4"/>
        <path d="M44 48 h12 v12 h12 v12 h-12 v12 h-12 v-12 h-12 v-12 h12 z" fill="#ffffff" stroke="#03200f" stroke-width="3"/>`,
    // ---------------- TACTICIAN
    disrupt: `<path d="M58 4 L22 54 H46 L38 96 L80 40 H54 Z" fill="currentColor" stroke="#12052a" stroke-width="4" stroke-linejoin="round"/><path d="M52 18 L34 46" stroke="#fff" stroke-width="3" opacity=".6"/>`,
    expose: `<circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="50" cy="50" r="12" fill="#ff4757"/>
        <path d="M50 6 V26 M50 74 V94 M6 50 H26 M74 50 H94" stroke="#e6d4ff" stroke-width="6" stroke-linecap="round"/>`,
    breach: `<path d="M50 6 L88 28 V72 L50 94 L12 72 V28 Z" fill="#1a0a33" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>
        <path d="M50 6 L44 36 L58 48 L40 62 L50 94" fill="none" stroke="#4de1ff" stroke-width="5" stroke-linejoin="round"/><path d="M58 48 L84 40 M44 36 L16 42" stroke="#4de1ff" stroke-width="4"/>`
};

export function abilityIcon(id, { size = 56, color = 'currentColor' } = {}) {
    const body = I[id];
    if (!body) return '';
    return `<svg class="ab-icon" viewBox="0 0 100 100" width="${size}" height="${size}" style="color:${color};overflow:visible">${body}</svg>`;
}

// One-glance stat for each ability, shown big on its button
export const ABILITY_STAT = {
    strike: '800 DMG', cleave: '1,400 DMG', wrath: '6,000 DMG',
    bash: '650 DMG', shield: 'BLOCKS 1 HIT', dome: '8s INVULNERABLE',
    jab: '550 DMG', heal: '+30% HP', hospital: 'HEAL ALL + REVIVE',
    disrupt: '750 DMG', expose: '+25% TEAM DMG', breach: 'STUN 10s'
};

// What the ready ultimate shouts at you
export const ULT_CALL = { WARRIOR: 'UNLEASH', GUARDIAN: 'RAISE', MEDIC: 'OPEN', TACTICIAN: 'EXECUTE' };
