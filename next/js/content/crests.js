// Class crests: iconic, code-drawn SVG emblems (crisp at any size, no image files).
//   WARRIOR   "Blood Edge"  crossed greatswords and a war-flame on a spiked shield
//   GUARDIAN  "Bastion"     winged tower shield with a glowing hex core
//   MEDIC     "Lifeline"    winged badge, bold cross and a heartbeat line
//   TACTICIAN "Overwatch"   all-seeing eye in a targeting reticle on a circuit hexagon

let uid = 0;

const CRESTS = {
    WARRIOR: id => `
        <defs>
            <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a0d16"/><stop offset="1" stop-color="#1a0306"/></linearGradient>
            <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d939e"/><stop offset=".5" stop-color="#f4f6fa"/><stop offset="1" stop-color="#8d939e"/></linearGradient>
            <radialGradient id="${id}fl" cx=".5" cy=".75" r=".7"><stop offset="0" stop-color="#fff3c4"/><stop offset=".35" stop-color="#ffb020"/><stop offset=".75" stop-color="#ff4757"/><stop offset="1" stop-color="#8a0c18"/></radialGradient>
        </defs>
        <path d="M100 8 L150 22 L186 16 L178 58 L172 122 Q160 166 100 194 Q40 166 28 122 L22 58 L14 16 L50 22 Z" fill="url(#${id}f)" stroke="#ff4757" stroke-width="6" stroke-linejoin="round"/>
        <path d="M100 24 L146 36 L164 34 L158 64 L154 120 Q146 152 100 176 Q54 152 46 120 L42 64 L36 34 L54 36 Z" fill="none" stroke="#ff4757" stroke-opacity=".35" stroke-width="3"/>
        ${[-1, 1].map(s => `
        <g transform="translate(100 104) rotate(${s * 38})">
            <path d="M-7 -82 L0 -96 L7 -82 L7 36 L-7 36 Z" fill="url(#${id}b)" stroke="#1a0306" stroke-width="3"/>
            <line x1="0" y1="-86" x2="0" y2="32" stroke="#6b707a" stroke-width="2"/>
            <rect x="-24" y="34" width="48" height="10" rx="4" fill="#c9a34a" stroke="#1a0306" stroke-width="3"/>
            <rect x="-5" y="44" width="10" height="28" rx="3" fill="#3a2214" stroke="#1a0306" stroke-width="3"/>
            <circle cx="0" cy="77" r="7" fill="#c9a34a" stroke="#1a0306" stroke-width="3"/>
        </g>`).join('')}
        <path d="M100 58 C120 82 132 96 126 118 C122 134 110 142 100 146 C90 142 78 134 74 118 C68 96 82 84 88 70 C92 84 96 90 102 92 C100 80 98 70 100 58 Z" fill="url(#${id}fl)" stroke="#2a0408" stroke-width="4" stroke-linejoin="round"/>
        <path d="M100 98 C108 108 110 118 106 126 C104 130 100 132 100 132 C96 130 92 126 92 120 C92 112 98 108 100 98 Z" fill="#fff6d8" opacity=".9"/>`,

    GUARDIAN: id => `
        <defs>
            <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26357a"/><stop offset="1" stop-color="#0a1030"/></linearGradient>
            <linearGradient id="${id}w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8d4ff"/><stop offset="1" stop-color="#4a5fb8"/></linearGradient>
            <radialGradient id="${id}c" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff"/><stop offset=".4" stop-color="#8ea4ff"/><stop offset="1" stop-color="#3742fa"/></radialGradient>
        </defs>
        ${[-1, 1].map(s => `
        <g transform="translate(100 0) scale(${s} 1)">
            <path d="M56 46 L96 26 L92 46 L84 54 L98 50 L92 72 L80 78 L94 78 L84 100 L60 104 Z" transform="translate(0 0)" fill="url(#${id}w)" stroke="#0a1030" stroke-width="3" stroke-linejoin="round"/>
        </g>`).join('')}
        <path d="M100 14 L162 34 V108 Q162 156 100 190 Q38 156 38 108 V34 Z" fill="url(#${id}f)" stroke="#4a6cff" stroke-width="7" stroke-linejoin="round"/>
        <path d="M100 30 L148 46 V108 Q148 146 100 174 Q52 146 52 108 V46 Z" fill="none" stroke="#9fb4ff" stroke-opacity=".45" stroke-width="3"/>
        <g transform="translate(100 100)">
            <polygon points="0,-44 38,-22 38,22 0,44 -38,22 -38,-22" fill="#0f1a4a" stroke="#4a6cff" stroke-width="5"/>
            <polygon points="0,-28 24,-14 24,14 0,28 -24,14 -24,-14" fill="url(#${id}c)" stroke="#e8eeff" stroke-width="3"/>
            ${[0, 60, 120, 180, 240, 300].map(a => `<line x1="0" y1="-48" x2="0" y2="-58" stroke="#9fb4ff" stroke-width="4" stroke-linecap="round" transform="rotate(${a})"/>`).join('')}
        </g>`,

    MEDIC: id => `
        <defs>
            <radialGradient id="${id}f" cx=".5" cy=".4" r=".65"><stop offset="0" stop-color="#0f5a35"/><stop offset="1" stop-color="#03200f"/></radialGradient>
            <linearGradient id="${id}x" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9ff5c2"/></linearGradient>
            <linearGradient id="${id}w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2ed573"/><stop offset="1" stop-color="#d9ffe9"/></linearGradient>
        </defs>
        ${[-1, 1].map(s => `
        <g transform="translate(100 0) scale(${s} 1)">
            ${[0, 1, 2, 3].map(i => `<path d="M${-58 - i * 10} ${78 + i * 18} Q${-96 - i * 4} ${60 + i * 22} ${-92 - i * 6} ${40 + i * 30} Q${-74 - i * 8} ${62 + i * 20} ${-56 - i * 6} ${70 + i * 20} Z" fill="url(#${id}w)" opacity="${0.95 - i * 0.12}" stroke="#03200f" stroke-width="2.5"/>`).join('')}
        </g>`).join('')}
        <circle cx="100" cy="100" r="74" fill="url(#${id}f)" stroke="#2ed573" stroke-width="7"/>
        <circle cx="100" cy="100" r="62" fill="none" stroke="#7bed9f" stroke-opacity=".4" stroke-width="3" stroke-dasharray="6 6"/>
        <path d="M84 52 H116 V84 H148 V116 H116 V148 H84 V116 H52 V84 H84 Z" fill="url(#${id}x)" stroke="#03200f" stroke-width="5" stroke-linejoin="round"/>
        <polyline points="36,104 70,104 80,88 92,126 106,70 118,112 128,104 164,104" fill="none" stroke="#ff4757" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
        <polyline points="36,104 70,104 80,88 92,126 106,70 118,112 128,104 164,104" fill="none" stroke="#ffd0d6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`,

    TACTICIAN: id => `
        <defs>
            <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a1866"/><stop offset="1" stop-color="#12052a"/></linearGradient>
            <radialGradient id="${id}e" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#4de1ff"/><stop offset=".8" stop-color="#2a1050"/><stop offset="1" stop-color="#0a0614"/></radialGradient>
        </defs>
        <polygon points="100,10 178,55 178,145 100,190 22,145 22,55" fill="url(#${id}f)" stroke="#a55eea" stroke-width="7" stroke-linejoin="round"/>
        <g stroke="#c9a2ff" stroke-opacity=".5" stroke-width="2.5" fill="none">
            <path d="M34 70 H58 L66 78"/><path d="M166 70 H142 L134 78"/><path d="M34 130 H58 L66 122"/><path d="M166 130 H142 L134 122"/>
            <circle cx="34" cy="70" r="3" fill="#c9a2ff"/><circle cx="166" cy="70" r="3" fill="#c9a2ff"/><circle cx="34" cy="130" r="3" fill="#c9a2ff"/><circle cx="166" cy="130" r="3" fill="#c9a2ff"/>
        </g>
        <polygon points="100,36 160,138 40,138" fill="#1a0a33" stroke="#a55eea" stroke-width="5" stroke-linejoin="round"/>
        <g transform="translate(100 104)">
            <path d="M-40 0 Q0 -32 40 0 Q0 32 -40 0 Z" fill="#0a0614" stroke="#e6d4ff" stroke-width="4"/>
            <circle r="19" fill="url(#${id}e)"/>
            <ellipse rx="5" ry="15" fill="#05020a"/>
            <circle cx="-6" cy="-7" r="4" fill="#ffffff"/>
            ${[0, 90, 180, 270].map(a => `<line x1="0" y1="-30" x2="0" y2="-44" stroke="#ff4757" stroke-width="5" stroke-linecap="round" transform="rotate(${a})"/>`).join('')}
        </g>
        ${[[30, 30, 1, 1], [170, 30, -1, 1], [30, 170, 1, -1], [170, 170, -1, -1]].map(([x, y, sx, sy]) => `<path d="M${x} ${y + sy * 22} V${y} H${x + sx * 22}" fill="none" stroke="#4de1ff" stroke-width="5" stroke-linecap="round"/>`).join('')}`
};

export const CREST_NAMES = { WARRIOR: 'Blood Edge', GUARDIAN: 'Bastion', MEDIC: 'Lifeline', TACTICIAN: 'Overwatch' };

// Returns an <svg> string. `size` in px (or any CSS length); `glow` adds a colored halo.
export function crest(cls, { size = 64, glow = false, className = '' } = {}) {
    const draw = CRESTS[cls];
    if (!draw) return '';
    const id = `cr${++uid}`;
    const color = { WARRIOR: '#ff4757', GUARDIAN: '#4a6cff', MEDIC: '#2ed573', TACTICIAN: '#a55eea' }[cls];
    const sz = typeof size === 'number' ? size + 'px' : size;
    return `<svg class="crest ${className}" viewBox="0 0 200 200" width="${sz}" height="${sz}" aria-label="${cls} crest" style="${glow ? `filter:drop-shadow(0 0 12px ${color}) drop-shadow(0 0 28px ${color}80);` : ''}overflow:visible">${draw(id)}</svg>`;
}
