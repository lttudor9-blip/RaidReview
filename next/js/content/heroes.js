// Hero moments: the plays a class will talk about after the bell.
// The engine detects them; this turns one into words for the projector and Chromebooks.

const COLORS = { squadSave: '#2ed573', perfectCombo: '#ff9d00', domeSave: '#4a6cff', interrupt: '#a55eea', clutchCall: '#ffd36b', finalBlow: '#ff4757', lastStand: '#ff4757', flawless: '#ffd36b' };

export function heroText(ev, name) {
    const [a, b] = (ev.pids || []).map(name);
    switch (ev.kind) {
        case 'squadSave': return { title: 'SQUAD SAVED!', sub: `${a}'s Field Hospital brought back ${ev.revived} teammate${ev.revived === 1 ? '' : 's'}` };
        case 'perfectCombo': return { title: 'PERFECT COMBO!', sub: `${a} broke the armor and ${b} SHATTERED it` };
        case 'domeSave': return { title: 'IRON DOME HOLDS!', sub: `${a} blocked ${ev.attack} for the whole squad` };
        case 'interrupt': return { title: 'SYSTEM CRASH!', sub: `${a} shut down ${ev.attack}` };
        case 'clutchCall': return { title: 'CLUTCH CALL!', sub: `${(ev.pids || []).map(name).join(' + ')} answered with ${ev.secs.toFixed(1)}s to spare` };
        case 'finalBlow': return { title: 'FINAL BLOW!', sub: `${a} took down ${ev.boss}` };
        case 'lastStand': return { title: 'LAST STAND!', sub: `${a}, nearly out of HP, finished ${ev.boss}` };
        case 'flawless': return { title: 'FLAWLESS!', sub: `${ev.boss} fell and nobody went down` };
        default: return { title: 'HERO MOMENT!', sub: '' };
    }
}
export const heroColor = kind => COLORS[kind] || '#ffa502';
