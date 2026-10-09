// Student Chromebook view of a raid puzzle. Each class sees only its own
// piece: clues for OTHER classes, and controls only it can use.

import { CLASSES } from '../content/classes.js';
import { PUZZLES, SYMBOLS, COLORS, MAX_STRIKES } from '../content/puzzles.js';
import { crest } from '../content/crests.js';
import { esc, fmtClock } from '../ui.js';

const plural = cls => CLASSES[cls].name.toUpperCase() + 'S';
const colorHex = id => COLORS.find(c => c.id === id)?.hex || '#fff';

// What on screen depends on: redraw only when this changes, so buttons are
// never swapped out from under a finger by a clock tick.
export function puzzleKey(live) {
    const st = live.stage || {}, pz = live.puzzle;
    if (st.phase !== 'puzzle' || !pz) return `${st.phase}|${st.outcome?.solved}`;
    const v = pz.vault ? pz.vault.slots.map(x => x.value ?? '_').join('') + (pz.vault.checkAt ? 'L' : '') : '';
    const r = pz.reactor ? `${pz.reactor.round}.${pz.reactor.progress}` : '';
    return `puzzle|${pz.status}|${pz.strikes}|${v}|${r}`;
}

// The clock ticks without redrawing anything else
export function puzzleTick(live, now) {
    const el = document.getElementById('spz-t');
    const pz = live.puzzle;
    if (!el || !pz) return;
    const left = Math.max(0, pz.endsAt - now);
    el.textContent = fmtClock(left);
    el.classList.toggle('danger', left < 30000);
}

export function drawPuzzle(box, center, { live, cls, now, send, local }) {
    const st = live.stage, P = PUZZLES[st.id];
    const hide = () => { box.innerHTML = ''; box.style.display = 'none'; };

    if (st.phase === 'intro') {
        hide();
        center.innerHTML = `<div class="spz" style="text-align:center">
            <div class="label gold">${esc(P.kicker)}</div>
            <div class="display" style="font-size:clamp(2.2rem,5vw,3.6rem);color:#ffd32a;animation:slam .6s both">${esc(P.name)}</div>
            <div class="muted" style="font-size:1.15rem">${esc(P.how[1])}</div>
            <div class="muted" style="font-size:1.05rem">Eyes on the projector: your teacher is explaining.</div></div>`;
        return;
    }
    if (st.phase === 'outro') {
        hide();
        const o = st.outcome || {};
        center.innerHTML = `<div class="spz" style="text-align:center">
            <div class="display" style="font-size:clamp(2.4rem,6vw,4rem);color:${o.solved ? '#2ed573' : '#ff4757'};animation:slam .6s both">${esc(o.title || '')}</div>
            <div class="display" style="font-size:1.3rem;color:${o.solved ? '#7bed9f' : '#ff6b81'}">${esc(o.reward || '')}</div>
            <div class="muted" style="font-size:1.15rem">${esc(o.text || '')}</div></div>`;
        return;
    }
    const pz = live.puzzle;
    if (!pz) return hide();
    const top = `<div class="spz-top"><span class="gold">${esc(P.name)}</span><span class="t" id="spz-t">${fmtClock(Math.max(0, pz.endsAt - now))}</span>
        <span class="spz-strikes">${Array.from({ length: MAX_STRIKES }, (_, i) => `<i class="${i < pz.strikes ? 'on' : ''}"></i>`).join('')}</span></div>`;

    if (pz.kind === 'vault') {
        const slots = pz.vault.slots;
        const mine = slots.map((x, i) => ({ ...x, i })).filter(x => x.holder === cls);
        const iSet = slots.map((x, i) => ({ ...x, i })).filter(x => x.setter === cls);
        center.innerHTML = `<div class="spz">${top}
            ${mine.map(x => `<div class="clue-card" style="--to:${CLASSES[x.setter].color}">${crest(x.setter, { size: 46 })}
                <div><div class="cc-say">TELL THE ${plural(x.setter)}: SLOT ${x.i + 1} IS…</div><div class="cc-clue">${clueHtml(x.clue)}</div></div></div>`).join('')}
            <div class="spz-tip">${mine.length ? 'Find it on the SYMBOL WALL on the projector, then shout the symbol\'s name!' : 'Listen for your clue from another class.'}</div>
            <div class="slot-pips">${slots.map(x => `<span class="${x.value !== null ? 'set' : ''}">${x.value !== null ? SYMBOLS[x.value].glyph : '?'}</span>`).join('')}</div>
            ${pz.vault.checkAt ? '<div class="spz-tip gold" style="font-weight:700">ALL SLOTS IN: LOCKING…</div>' : ''}
        </div>`;
        box.style.display = '';
        box.innerHTML = iSet.length
            ? iSet.map(x => `<div class="keypad-row"><div class="label">YOU ENTER SLOT ${x.i + 1} · ${crest(x.holder, { size: 18 })} ${plural(x.holder)} HAVE YOUR CLUE</div>
                <div class="keypad" data-slot="${x.i}">${SYMBOLS.map(sy => `<button data-v="${sy.id}" class="${x.value === sy.id ? 'on' : ''}">${sy.glyph}<small>${sy.name}</small></button>`).join('')}</div></div>`).join('')
            : '<div class="spz-tip">Your class has no slot to enter. Help by reading clues and checking the wall!</div>';
        box.onclick = e => {
            const b = e.target.closest('.keypad button');
            if (!b) return;
            const s = +b.closest('.keypad').dataset.slot, v = +b.dataset.v;
            b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
            send({ t: 'p', a: 'set', s, v });
        };
        return;
    }

    // reactor
    const R = pz.reactor, seq = R.rounds[R.round];
    const intel = R.holder === cls;
    const next = seq[R.progress];
    center.innerHTML = `<div class="spz">${top}
        <div class="label" style="text-align:center">ROUND ${R.round + 1} OF ${R.rounds.length} · STEP ${Math.min(R.progress + 1, seq.length)} OF ${seq.length}</div>
        ${intel ? `
            <div class="seq">${seq.map((c, i) => `<div class="st ${i < R.progress ? 'done' : i === R.progress ? 'now' : ''}" style="color:${CLASSES[c].color}">${crest(c, { size: 34 })}${CLASSES[c].name.toUpperCase()}</div>`).join('')}</div>
            <div class="seq-now">CALL IT: <span style="color:${CLASSES[next].color}">${plural(next)}!</span></div>
            <div class="spz-tip">You're the only ones who can see this. Shout each class when it's their turn.</div>`
        : `<div class="seq">${seq.map((_, i) => `<div class="st ${i < R.progress ? 'done' : i === R.progress ? 'now' : ''}">${i < R.progress ? '✓' : '?'}</div>`).join('')}</div>
            <div class="spz-tip">${crest(R.holder, { size: 22 })} <b style="color:${CLASSES[R.holder].color}">${plural(R.holder)}</b> can see the order. Listen for your class!</div>`}
    </div>`;
    box.style.display = '';
    box.innerHTML = `<button class="press-btn ${local.cool ? 'cool' : ''}" id="spz-press">⚡ PRESS<small>ONLY WHEN ${plural(cls)} ARE CALLED</small></button>`;
    $press(box, send, local);
}

function $press(box, send, local) {
    const b = box.querySelector('#spz-press');
    b.onclick = () => {
        if (local.cool) return;
        local.cool = true; b.classList.add('cool');
        send({ t: 'p', a: 'press' });
        setTimeout(() => { local.cool = false; b.classList.remove('cool'); }, 700);
    };
}

function clueHtml(clue) {
    const c = clue.color ? `<b style="--cc:${colorHex(clue.color)}">${clue.color}</b>` : '';
    if (clue.by === 'color') return `the ${c} symbol`;
    if (clue.by === 'pos') return `symbol <b>#${clue.pos}</b> on the wall<br><span class="muted" style="font-size:.9rem">(count from the left)</span>`;
    if (clue.by === 'rightOf') return `the symbol just <b>RIGHT</b> of the ${c} one`;
    if (clue.by === 'leftOf') return `the symbol just <b>LEFT</b> of the ${c} one`;
    return '?';
}
