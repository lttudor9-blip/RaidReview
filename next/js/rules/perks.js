// Upgrade vote rules. Pure: mutate state, return values/events.
//
// state.perks = { WARRIOR: ['w_fury', ...], ... }   upgrades each class has unlocked
// vote = { offers: { CLS: [id, id, id] }, votes: { pid: id } }   (kept by the host)

import { CLASS_IDS, CLASSES } from '../content/classes.js';
import { PERKS } from '../content/perks.js';

const shuffle = (list, rng) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
};

export const perksOf = (state, cls) => (state.perks || {})[cls] || [];

// Three upgrades each class doesn't own yet (fewer if its pool is nearly used up)
export function offerPerks(state, rng = Math.random) {
    const present = new Set(Object.values(state.players).map(p => p.cls));
    const offers = {};
    for (const cls of CLASS_IDS) {
        if (!present.has(cls)) continue;
        const owned = new Set(perksOf(state, cls));
        const pool = Object.keys(PERKS).filter(id => PERKS[id].cls === cls && !owned.has(id));
        if (pool.length) offers[cls] = shuffle(pool, rng).slice(0, 3);
    }
    return offers;
}

// A student may only vote for one of their own class's offers
export function castVote(vote, state, pid, perk) {
    const p = state.players[pid];
    if (!p || !vote.offers[p.cls] || !vote.offers[p.cls].includes(perk)) return false;
    vote.votes[pid] = perk;
    return true;
}

export function tally(vote, state) {
    const out = {};
    for (const [cls, ids] of Object.entries(vote.offers)) out[cls] = Object.fromEntries(ids.map(id => [id, 0]));
    for (const [pid, perk] of Object.entries(vote.votes)) {
        const p = state.players[pid];
        if (p && out[p.cls] && perk in out[p.cls]) out[p.cls][perk]++;
    }
    return out;
}

// Everyone in a class that's voting has cast a vote
export function allVoted(vote, state) {
    return Object.values(state.players).every(p => !vote.offers[p.cls] || vote.votes[p.id]);
}

// Most votes wins; ties (and no votes at all) are broken at random
export function winners(vote, state, rng = Math.random) {
    const t = tally(vote, state), out = {};
    for (const [cls, counts] of Object.entries(t)) {
        const best = Math.max(...Object.values(counts));
        const top = Object.keys(counts).filter(id => counts[id] === best);
        out[cls] = top[Math.floor(rng() * top.length)];
    }
    return out;
}

// Unlock an upgrade. HP upgrades apply right away to everyone in the class.
export function grantPerk(state, cls, id) {
    if (!PERKS[id] || PERKS[id].cls !== cls) return [];
    state.perks = { ...(state.perks || {}) };
    if (state.perks[cls]?.includes(id)) return [];
    state.perks[cls] = [...(state.perks[cls] || []), id];
    if (['w_ironskin', 'g_fortress', 'm_vitality', 't_firewall'].includes(id)) {
        for (const p of Object.values(state.players)) {
            if (p.cls !== cls) continue;
            const grow = Math.round(p.maxHp * 0.25);
            p.maxHp += grow;
            if (p.status === 'alive') p.hp += grow;
        }
    }
    return [{ type: 'perkUnlocked', cls, perk: id, name: PERKS[id].name, className: CLASSES[cls].name }];
}
