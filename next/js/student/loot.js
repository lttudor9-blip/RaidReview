// Student loot-drop screen: your class votes on one of three upgrades.
// Full screen over the game, in your class's colors. Tap a card to vote; you
// can change your mind until the timer ends. Then the winner is unlocked.

import { CLASSES } from '../content/classes.js';
import { PERKS, RARITY } from '../content/perks.js';
import { crest } from '../content/crests.js';
import { esc, pct } from '../ui.js';

let el = null;

export function syncLoot({ live, cls, now, send, local }) {
    const up = live.stage?.kind === 'upgrade' ? live.upgrade : null;
    if (!up) { if (el) { el.remove(); el = null; } local.vote = null; return false; }
    if (!el) {
        el = document.createElement('div');
        el.className = 'sloot';
        el.dataset.cls = cls;
        document.body.appendChild(el);
        // vote on press so a refresh mid-tap can't swallow it
        el.addEventListener('pointerdown', e => {
            const card = e.target.closest('[data-perk]');
            if (!card || el.classList.contains('revealed')) return;
            local.vote = card.dataset.perk;
            send({ t: 'v', perk: local.vote });
            el.querySelectorAll('[data-perk]').forEach(c => c.classList.toggle('mine', c === card));
        });
    }
    const offers = (up.offers || {})[cls] || [];
    const counts = (up.tally || {})[cls] || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const reveal = up.phase === 'reveal';
    const won = (up.winners || {})[cls];
    const owned = ((live.perks || {})[cls] || []);
    el.classList.toggle('revealed', reveal);
    const c = CLASSES[cls];
    // Build the screen once per phase; after that only numbers and selection
    // change, so cards never replay their entrance animation (no flashing).
    const shape = [offers.join(','), reveal, won, owned.join(',')].join('|');
    if (el.__shape !== shape) {
        el.__shape = shape;
        const head = `<div class="sl-head">${crest(cls, { size: 64, glow: true })}<div>
                <div class="sl-kicker">LOOT DROP · ${c.name.toUpperCase()} UPGRADE</div>
                <div class="sl-title">${reveal ? 'UPGRADE UNLOCKED!' : 'VOTE WITH YOUR CLASS'}</div></div>
                <div class="sl-timer"></div></div>`;
        if (!offers.length) {
            el.innerHTML = `${head}<div class="sl-note">Your class has unlocked every upgrade. Legendary!</div>`;
        } else {
            const cards = offers.map(id => {
                const P = PERKS[id], R = RARITY[P.rarity];
                return `<button class="sl-card ${reveal ? (id === won ? 'win' : 'lose') : ''}" data-perk="${id}" style="--rc:${R.color}">
                    <span class="sl-rarity">${R.label}</span>
                    <span class="sl-icon">${P.icon}</span>
                    <span class="sl-name">${esc(P.name)}</span>
                    <span class="sl-desc">${esc(P.desc)}</span>
                    <span class="sl-votes"><span class="bar"><i></i></span><b></b></span>
                    <span class="sl-mine">YOUR VOTE ✓</span>
                    <span class="sl-stamp">UNLOCKED!</span>
                </button>`;
            }).join('');
            const tree = owned.length
                ? `<div class="sl-tree"><span class="label">YOUR ${c.name.toUpperCase()} BUILD</span>${owned.map(id => `<span class="sl-perk" style="--rc:${RARITY[PERKS[id].rarity].color}">${PERKS[id].icon} ${esc(PERKS[id].name)}</span>`).join('')}</div>`
                : '';
            el.innerHTML = `${head}<div class="sl-cards">${cards}</div>
                <div class="sl-foot">${reveal ? `Your class unlocked <b>${esc(PERKS[won]?.name || '')}</b> for the rest of the raid.` : 'Talk it over with your class: the card with the most votes wins. Tap to vote, tap another to switch.'}</div>${tree}`;
        }
    }
    const timer = el.querySelector('.sl-timer');
    if (timer) timer.textContent = reveal ? '★' : Math.max(0, Math.ceil((up.endsAt - now) / 1000));
    el.querySelectorAll('.sl-card').forEach(card => {
        const n = counts[card.dataset.perk] || 0;
        card.querySelector('.sl-votes i').style.width = (total ? pct(n, total) : 0) + '%';
        card.querySelector('.sl-votes b').textContent = `${n} vote${n === 1 ? '' : 's'}`;
        card.classList.toggle('mine', local.vote === card.dataset.perk);
    });
    return true;
}
