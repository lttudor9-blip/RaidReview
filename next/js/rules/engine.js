// Raid Review rules engine.
//
// Pure game logic: no Firebase, no DOM. The host owns the one true game state,
// feeds student intents and clock ticks through these functions, and gets back
// a list of events that drive the visuals. Functions mutate `state` in place and
// return events. `now` is a timestamp in ms; `rng` is a () => [0,1) function so
// tests and the balance simulator can be deterministic.

import { CLASSES, SYNERGY_WINDOW, SYNERGY_MULT, MONO_CLASS_PENALTY, STREAK_BONUS, ULT_PER_CORRECT, ULT_PER_SUPPORT, SPIRIT_RALLY_PER_CORRECT } from '../content/classes.js';
import { PERKS } from '../content/perks.js';
import { BOSSES, PHASES, TIMER_ENRAGE, ROLE_CALL_REFLECT, ESHIELD_LEAK, ESHIELD_BREAK, INFECTION_SPREAD_MS, MIN_SCALING_PLAYERS, WIPE_REGROUP_MS, WIPE_BOSS_HEAL, RAID_LIVES, PLAYER_LIVES, DIFFICULTY } from '../content/raid.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Upgrades the class has unlocked in the vote after each boss (see rules/perks.js)
export const hasPerk = (state, id) => !!PERKS[id] && ((state.perks || {})[PERKS[id].cls] || []).includes(id);
const ULT_PERK = { WARRIOR: 'w_fury', GUARDIAN: 'g_rallycry', MEDIC: 'm_triage', TACTICIAN: 't_overwatch' };
const HP_PERK = { WARRIOR: 'w_ironskin', GUARDIAN: 'g_fortress', MEDIC: 'm_vitality', TACTICIAN: 't_firewall' };
const ultGain = (state, p, n) => Math.round(n * (hasPerk(state, ULT_PERK[p.cls]) ? 1.3 : 1));
// a shield is a count of hits it will still block (Aegis shields block two)
function useShield(p) {
    p.shield = Math.max(0, (p.shield === true ? 1 : p.shield || 0) - 1) || false;
    if (!p.shield) p.shieldBy = null;
}

export function difficultyOf(state) {
    return DIFFICULTY[state.difficulty] || DIFFICULTY.regular;
}

// ---------------------------------------------------------------- setup

export function createRaid({ difficulty = 'regular' } = {}) {
    return {
        v: 2,
        difficulty,
        status: 'lobby',          // lobby | boss | stage | victory | defeat
        raidLives: RAID_LIVES,
        regroupUntil: 0,
        team: { syn: {}, synLevel: 1, dome: 0, rally: 0 },
        players: {},
        boss: null
    };
}

export function addPlayer(state, pid, { name, cls }) {
    const c = CLASSES[cls];
    if (!c) throw new Error(`unknown class ${cls}`);
    const maxHp = Math.round(c.hp * difficultyOf(state).playerHp * (hasPerk(state, HP_PERK[cls]) ? 1.25 : 1));
    state.players[pid] = {
        id: pid, name, cls,
        hp: maxHp, maxHp, lives: PLAYER_LIVES, status: 'alive',
        ult: 0, cd: 0, streak: 0, armed: false,
        shield: false, infected: 0, silenced: 0, revive: 0,
        stats: { dmg: 0, heal: 0, shields: 0, saves: 0, correct: 0, wrong: 0, downs: 0, revives: 0, bestStreak: 0, ults: 0, roleCalls: 0 }
    };
    return state.players[pid];
}

export function removePlayer(state, pid) {
    delete state.players[pid];
}

const playersOf = state => Object.values(state.players);
const alivePlayers = state => playersOf(state).filter(p => p.status === 'alive');

// ---------------------------------------------------------------- team synergy

export function synergyLevel(state, now) {
    let n = 0;
    for (const t of Object.values(state.team.syn)) if (now - t <= SYNERGY_WINDOW) n++;
    return Math.max(1, n);
}
export function synergyMult(state, now) {
    const classes = new Set(playersOf(state).map(p => p.cls)).size;
    return SYNERGY_MULT[synergyLevel(state, now)] * (classes === 1 && playersOf(state).length > 1 ? MONO_CLASS_PENALTY : 1);
}

function streakBonus(p) {
    const tier = STREAK_BONUS.find(s => p.streak >= s.at);
    const bonus = tier ? tier.bonus : 0;
    return p.cls === 'WARRIOR' ? bonus * 2 : bonus;
}

// ---------------------------------------------------------------- answers

// Called once per answered question. `correct` is validated by the host.
export function answer(state, pid, correct, now) {
    const p = state.players[pid];
    if (!p) return [];
    const ev = [];
    const d = difficultyOf(state);
    if (correct) {
        p.stats.correct++;
        p.streak++;
        p.stats.bestStreak = Math.max(p.stats.bestStreak, p.streak);
        if (p.status === 'alive') {
            p.armed = true;
            if (!p.infected) p.ult = Math.min(100, p.ult + ultGain(state, p, ULT_PER_CORRECT)); // the virus jams your ultimate
            if (p.cd > 0) p.cd--;
        } else if (p.status === 'down') {
            p.revive++;
            ev.push({ type: 'reviveProgress', pid, have: p.revive, need: d.reviveNeed });
            if (p.revive >= d.reviveNeed) revive(state, p, 0.5, null, ev);
        } else if (p.status === 'out') {
            // eliminated students keep answering to power the team's rally
            state.team.rally += SPIRIT_RALLY_PER_CORRECT;
            if (state.team.rally >= 100) {
                state.team.rally = 0;
                for (const a of alivePlayers(state)) a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * 0.2));
                ev.push({ type: 'rally' });
            }
        }
    } else {
        p.stats.wrong++;
        p.streak = 0;
        if (p.status === 'alive') {
            // wrong answers sting but never knock a student out
            const dmg = Math.round(p.maxHp * d.wrongDmg);
            if (p.shield) { useShield(p); ev.push({ type: 'shieldBlock', pid }); }
            else { p.hp = Math.max(1, p.hp - dmg); ev.push({ type: 'selfDamage', pid, amount: dmg }); }
        } else if (p.status === 'down') {
            p.revive = 0;
        }
    }
    ev.push({ type: 'answer', pid, correct });
    return ev;
}

// ---------------------------------------------------------------- actions

// What an ability needs before it can be used. Returns an error string or ''.
export function canAct(state, pid, ability, now) {
    const p = state.players[pid];
    if (!p) return 'no such player';
    if (p.status !== 'alive') return 'not alive';
    if (!p.armed) return 'answer a question first';
    if (state.status !== 'boss' || !state.boss || state.boss.defeatedAt) return 'no fight';
    if (state.regroupUntil > now) return 'regrouping';
    if (ability !== 'basic' && p.silenced > now) return 'silenced';
    if (ability === 'special' && p.cd > 0 && !callIsFor(state, p)) return 'special on cooldown';
    if (ability === 'ult' && p.ult < 100) return 'ultimate not charged';
    if (!CLASSES[p.cls].abilities[ability]) return 'unknown ability';
    return '';
}

export function act(state, pid, { ability, target } = {}, now) {
    const err = canAct(state, pid, ability, now);
    if (err) return [{ type: 'rejected', pid, reason: err }];
    const p = state.players[pid];
    const b = state.boss;
    const d = difficultyOf(state);
    const ab = CLASSES[p.cls].abilities[ability];
    const ev = [];
    state.now = now;

    p.armed = false;
    state.team.syn[p.cls] = now;
    const lvl = synergyLevel(state, now);
    if (lvl > state.team.synLevel) ev.push({ type: 'synergy', level: lvl, mult: SYNERGY_MULT[lvl] });
    state.team.synLevel = lvl;

    const exposed = b.exposedUntil > now;
    const ally = (target && state.players[target]) || p;

    switch (ab.kind) {
        case 'damage': {
            let base = ab.power, crit = false, combo = null;
            if (ability === 'ult' && ab.comboPower && exposed) {
                base = ab.comboPower * (hasPerk(state, 'w_shatterpoint') ? 1.5 : 1); combo = 'SHATTER';
                b.exposedUntil = 0; // the combo consumes the Expose
            } else if (ability === 'special' && (exposed || (p.cls === 'WARRIOR' && hasPerk(state, 'w_executioner')))) {
                base *= 1.5; crit = true;
            }
            if (p.cls === 'WARRIOR' && hasPerk(state, 'w_bloodlust')) base *= 1.2;
            const weak = isWeak(state, p, now);
            const mult = (1 + streakBonus(p)) * synergyMult(state, now) * (exposed ? 1 + b.exposeBonus : 1) * (b.mods?.dmg || 1) * (weak ? weakMult(b) : 1);
            let amount = Math.round(base * mult), resisted = false;
            if (b.eshield) {
                // only the shield's class can crack it; everyone else barely scratches the boss
                const r = hitElementShield(state, p, amount, now, ev);
                b.hp = Math.max(0, b.hp - r.toBoss);
                resisted = r.resisted; amount = r.shown;
            } else b.hp = Math.max(0, b.hp - amount);
            p.stats.dmg += amount;
            ev.push({ type: 'hit', pid, ability, amount, crit, combo, weak, resisted });
            if (combo) {
                ev.push({ type: 'combo', name: combo, pid });
                const setter = state.players[b.exposedBy];
                if (setter && setter.id !== pid) ev.push({ type: 'hero', kind: 'perfectCombo', pids: [setter.id, pid], amount });
            }
            break;
        }
        case 'shield': {
            if (ally.status !== 'alive') return [{ type: 'rejected', pid, reason: 'target is down' }];
            ally.shield = hasPerk(state, 'g_aegis') ? 2 : 1;
            ally.shieldBy = p.id; // remember who to credit when it blocks a hit
            p.stats.shields++;
            p.ult = Math.min(100, p.ult + ultGain(state, p, ULT_PER_SUPPORT));
            ev.push({ type: 'shield', pid, target: ally.id });
            break;
        }
        case 'heal': {
            const healFrac = hasPerk(state, 'm_overflow') ? 0.45 : ab.amount;
            if (ally.status === 'down') {
                revive(state, ally, hasPerk(state, 'm_secondwind') ? 0.7 : ab.reviveAmount, pid, ev);
            } else if (ally.status === 'alive') {
                const amount = Math.min(ally.maxHp - ally.hp, Math.round(ally.maxHp * healFrac));
                ally.hp += amount;
                p.stats.heal += amount;
                if (ally.infected || ally.silenced > now) { ally.infected = 0; ally.silenced = 0; ev.push({ type: 'cured', pid, target: ally.id }); }
                ev.push({ type: 'heal', pid, target: ally.id, amount });
            } else {
                return [{ type: 'rejected', pid, reason: 'target is out' }];
            }
            if (hasPerk(state, 'm_splash')) {
                // the two lowest other teammates get half a heal too
                const others = alivePlayers(state).filter(a => a.id !== ally.id).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp).slice(0, 2);
                for (const a of others) { const amt = Math.min(a.maxHp - a.hp, Math.round(a.maxHp * healFrac / 2)); if (amt > 0) { a.hp += amt; p.stats.heal += amt; ev.push({ type: 'heal', pid, target: a.id, amount: amt, splash: true }); } }
            }
            p.ult = Math.min(100, p.ult + ultGain(state, p, ULT_PER_SUPPORT));
            break;
        }
        case 'expose': {
            b.exposedUntil = now + ab.duration * (hasPerk(state, 't_deepscan') ? 2 : 1);
            b.exposeBonus = hasPerk(state, 't_weakpoint') ? 0.4 : ab.bonus;
            b.exposedBy = p.id;
            p.ult = Math.min(100, p.ult + ultGain(state, p, ULT_PER_SUPPORT));
            ev.push({ type: 'expose', pid, until: b.exposedUntil });
            break;
        }
        case 'dome': {
            state.team.dome = now + (hasPerk(state, 'g_bastion') ? 12000 : ab.duration);
            state.team.domeBy = p.id;
            ev.push({ type: 'dome', pid, until: state.team.dome });
            break;
        }
        case 'massHeal': {
            const squad = playersOf(state).filter(a => a.status !== 'out');
            const standing = squad.filter(a => a.status === 'alive').length;
            const downBefore = squad.length - standing;
            for (const a of playersOf(state)) {
                if (a.status === 'down') revive(state, a, hasPerk(state, 'm_secondwind') ? 0.7 : ab.reviveAmount, pid, ev);
                else if (a.status === 'alive') {
                    const amount = Math.min(a.maxHp - a.hp, Math.round(a.maxHp * ab.amount));
                    a.hp += amount; a.infected = 0; a.silenced = 0;
                    p.stats.heal += amount;
                }
            }
            ev.push({ type: 'massHeal', pid });
            // the squad was on the brink and one Medic brought it back
            if (downBefore >= 2 || (downBefore >= 1 && standing <= Math.max(1, Math.floor(squad.length / 3)))) {
                ev.push({ type: 'hero', kind: 'squadSave', pids: [pid], revived: downBefore });
            }
            break;
        }
        case 'breach': {
            if (b.attack) {
                const big = b.attack.kind === 'aoe' || !!b.attack.call;
                ev.push({ type: 'interrupt', pid, attack: b.attack.id });
                if (big && !b.attack.call?.done) ev.push({ type: 'hero', kind: 'interrupt', pids: [pid], attack: b.attack.name });
                b.attack = null;
            }
            b.stunUntil = now + (hasPerk(state, 't_overclock') ? 15000 : ab.stun);
            b.telegraph = null;
            b.exposedUntil = now + ab.expose;
            b.exposeBonus = hasPerk(state, 't_weakpoint') ? 0.4 : CLASSES.TACTICIAN.abilities.special.bonus;
            b.exposedBy = p.id;
            ev.push({ type: 'breach', pid });
            break;
        }
    }

    if (ability === 'special') p.cd = Math.max(1, ab.cooldown + d.cooldownMod);
    if (ability === 'ult') { p.ult = 0; p.stats.ults++; ev.push({ type: 'ult', pid, name: ab.name }); }

    countRoleCall(state, p, ability, ev);
    if (ability === 'ult') countLastStand(state, p, now, ev);
    checkPhase(state, ev);
    checkDefeat(state, now, ev, pid);
    return ev;
}

function revive(state, p, frac, byPid, ev) {
    p.status = 'alive';
    p.hp = Math.round(p.maxHp * frac);
    p.revive = 0;
    if (byPid && state.players[byPid]) state.players[byPid].stats.revives++;
    ev.push({ type: 'revive', pid: p.id, by: byPid || null });
}

function knockDown(state, p, ev) {
    p.hp = 0;
    p.lives--;
    p.status = p.lives > 0 ? 'down' : 'out';
    p.revive = 0; p.shield = false; p.infected = 0; p.silenced = 0; p.armed = false; p.streak = 0;
    p.stats.downs++;
    if (state.boss) state.boss.downs = (state.boss.downs || 0) + 1;
    ev.push({ type: p.status === 'out' ? 'eliminated' : 'down', pid: p.id });
}

function damagePlayer(state, p, amount, ev, source) {
    if (p.status !== 'alive') return;
    if (p.shield) {
        // a shield from a teammate that eats a boss hit is a SAVE
        const by = p.shieldBy && p.shieldBy !== p.id && state.players[p.shieldBy] ? p.shieldBy : null;
        if (by) state.players[by].stats.saves++;
        const caster = p.shieldBy && state.players[p.shieldBy];
        useShield(p);
        ev.push({ type: 'shieldBlock', pid: p.id, source, by, amount });
        if (caster && caster.cls === 'GUARDIAN' && hasPerk(state, 'g_spikes') && state.boss && !state.boss.defeatedAt) {
            const back = 1500;
            state.boss.hp = Math.max(0, state.boss.hp - back);
            caster.stats.dmg += back;
            ev.push({ type: 'hit', pid: caster.id, ability: 'spikes', amount: back, crit: false });
        }
        return 'blocked';
    }
    p.hp -= amount;
    ev.push({ type: 'playerHit', pid: p.id, amount, source });
    if (p.hp <= 0) knockDown(state, p, ev);
}

// ---------------------------------------------------------------- role calls

// Is the boss calling on this player's class right now? Their special skips its
// cooldown while it is, so anyone who notices the call can answer it.
export function callIsFor(state, p) {
    const call = state.boss?.attack?.call;
    return !!call && !call.done && call.cls === p.cls;
}

function countRoleCall(state, p, ability, ev) {
    const call = state.boss?.attack?.call;
    if (!call || call.done) return;
    let counts = false;
    if (call.cls === 'ANY') counts = true;
    else if (call.cls === 'ALL') counts = !call.who[p.cls];
    else counts = p.cls === call.cls && (ability === 'special' || ability === 'ult'); // a deliberate answer, not an accident
    if (!counts) return;
    const key = call.cls === 'ALL' ? p.cls : p.id;
    if (call.who[key]) return;
    call.who[key] = p.id;
    const have = Object.keys(call.who).length;
    ev.push({ type: 'roleCallProgress', pid: p.id, have, need: call.need });
    if (have >= call.need) {
        call.done = true;
        ev.push({ type: 'roleCallMet' });
        const left = state.boss.attack.landsAt - (state.now || 0);
        if (state.now && left <= 2000) ev.push({ type: 'hero', kind: 'clutchCall', pids: Object.values(call.who), secs: Math.max(0, left / 1000) });
    }
}

function makeCall(state, roleCall, text) {
    const alive = alivePlayers(state);
    let cls = roleCall;
    let need;
    if (cls === 'ALL') {
        need = new Set(alive.map(p => p.cls)).size;
    } else {
        const ofClass = alive.filter(p => p.cls === cls).length;
        if (!ofClass) cls = 'ANY';
        // a missing class makes the call harder, not easier: the whole squad has to cover for it
        need = cls === 'ANY' ? clamp(Math.ceil(alive.length * 0.75), 1, 16) : clamp(Math.ceil(ofClass * 0.4), 1, 3);
    }
    return { cls, need: Math.max(1, need), who: {}, done: false, text };
}

// ---------------------------------------------------------------- bosses

export function startBoss(state, bossId, now) {
    const B = BOSSES[bossId];
    if (!B) throw new Error(`unknown boss ${bossId}`);
    const d = difficultyOf(state);
    const n = Math.max(MIN_SCALING_PLAYERS, playersOf(state).length);
    // a failed or solved raid puzzle leaves its mark on the next boss
    const mods = { bossHp: 1, bossDmg: 1, dmg: 1, ...(state.nextMods || {}) };
    state.nextMods = null;
    // small rooms can't keep all four classes busy at once, so the boss is a little softer
    const smallRoom = clamp(0.5 + n * 0.025, 0.65, 1);
    const maxHp = Math.round(B.hpPerPlayer * n * smallRoom * d.bossHp * mods.bossHp);
    state.boss = {
        id: bossId, name: B.name, hp: maxHp, maxHp,
        phase: 'NORMAL', enraged: false,
        startedAt: now, endsAt: now + B.timeLimit * (d.time || 1),
        exposedUntil: 0, exposeBonus: 0, stunUntil: 0,
        attack: null, cds: {}, defeatedAt: 0, mods, weak: null, eshield: null
    };
    B.attacks.forEach((a, i) => { state.boss.cds[a.id] = now + a.cooldown * 0.5 + i * 4000; });
    state.boss.telegraph = null;
    state.team.dome = 0;
    for (const p of playersOf(state)) { p.infected = 0; p.silenced = 0; p.armed = false; }
    state.status = 'boss';
    return [{ type: 'bossStart', boss: bossId, maxHp, mods }];
}

function phaseFor(frac) {
    return PHASES.find(ph => frac < ph.below) || PHASES[PHASES.length - 1];
}

function checkPhase(state, ev) {
    const b = state.boss;
    if (!b) return;
    const ph = phaseFor(b.hp / b.maxHp).id;
    if (ph !== b.phase) {
        const order = { NORMAL: 0, ENRAGED: 1, DESPERATE: 2 };
        // phases only ever escalate (a wipe heal does not calm the boss down)
        if (order[ph] > order[b.phase]) { b.phase = ph; ev.push({ type: 'phase', phase: ph }); }
    }
}

function checkDefeat(state, now, ev, byPid) {
    const b = state.boss;
    if (b && b.hp <= 0 && !b.defeatedAt) {
        b.hp = 0;
        b.defeatedAt = now;
        b.attack = null;
        ev.push({ type: 'bossDefeated', boss: b.id, by: byPid || null });
        const killer = byPid && state.players[byPid];
        if (killer) ev.push({ type: 'hero', kind: killer.hp / killer.maxHp < 0.25 ? 'lastStand' : 'finalBlow', pids: [killer.id], boss: b.name });
        if (!b.downs) ev.push({ type: 'hero', kind: 'flawless', pids: [], boss: b.name });
    }
}

export function enrageStacks(b, now) {
    return b.enraged && now > b.endsAt ? Math.floor((now - b.endsAt) / TIMER_ENRAGE.stackMs) : 0;
}

function attackMult(state, now) {
    const b = state.boss;
    const st = enrageStacks(b, now);
    const ph = PHASES.find(p => p.id === b.phase);
    // small groups have fewer bodies to spread hits across, so the boss eases off
    const smallRoom = clamp(0.4 + playersOf(state).length * 0.03, 0.55, 1);
    return {
        speed: ph.speed * (b.enraged ? TIMER_ENRAGE.speed * (1 + st * TIMER_ENRAGE.stackSpeed) : 1),
        dmg: ph.dmg * (b.enraged ? TIMER_ENRAGE.dmg * (1 + st * TIMER_ENRAGE.stackDmg) : 1) * difficultyOf(state).bossDmg * smallRoom * (b.mods?.bossDmg || 1)
    };
}

// attacks that don't pick a few students ahead of time (the threat radar skips them)
const UNTARGETED = new Set(['aoe', 'drones', 'silence']);

function pickTargets(state, a, rng) {
    const alive = alivePlayers(state);
    if (a.kind === 'aoe') return alive.map(p => p.id);
    if (a.kind === 'drones') return [];
    if (a.kind === 'silence') {
        // a whole class goes quiet; the rest of the squad has to cover for it
        const classes = [...new Set(alive.map(p => p.cls))];
        if (!classes.length) return [];
        const cls = classes[Math.floor(rng() * classes.length)];
        return alive.filter(p => p.cls === cls).map(p => p.id);
    }
    // fewer targets in small rooms (a 6-person squad can't lose half its people to one hit)
    const base = Math.max(1, Math.round((a.targets || 1) * Math.min(1, alive.length / 10)));
    // a sniper only has so many bullets: marks grow slower with the room
    const count = Math.min(alive.length, base + Math.floor(alive.length / (a.kind === 'mark' ? 12 : 8)));
    if (a.kind === 'lowest') {
        return [...alive].sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp).slice(0, count).map(p => p.id);
    }
    const pool = [...alive];
    const out = [];
    while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0].id);
    return out;
}

// The boss picks who it will hit a few seconds before it winds up, so Guardians'
// threat radar can see it coming and get a shield up in time.
export const TELEGRAPH_MS = 5000;

function startAttack(state, a, now, rng) {
    const tg = state.boss.telegraph;
    const planned = tg && tg.id === a.id ? tg.targets.filter(id => state.players[id]?.status === 'alive') : [];
    const targets = planned.length ? planned : pickTargets(state, a, rng);
    state.boss.telegraph = null;
    if (!targets.length && a.kind !== 'drones') return null;
    const windup = Math.round(a.windup * difficultyOf(state).windup);
    state.boss.attack = {
        id: a.id, name: a.name, kind: a.kind, targets,
        startedAt: now, landsAt: now + windup,
        call: a.roleCall ? makeCall(state, a.roleCall, a.callText) : null
    };
    return { type: 'windup', attack: a.id, name: a.name, targets, landsAt: now + windup, call: state.boss.attack.call };
}

function resolveAttack(state, now, ev) {
    const b = state.boss;
    const atk = b.attack;
    const def = BOSSES[b.id].attacks.find(x => x.id === atk.id);
    const m = attackMult(state, now);
    b.attack = null;
    b.cds[atk.id] = now + def.cooldown / m.speed;

    if (atk.call && atk.call.done) {
        const reflect = Math.round(b.maxHp * ROLE_CALL_REFLECT);
        b.hp = Math.max(0, b.hp - reflect);
        for (const pid of Object.values(atk.call.who)) if (state.players[pid]) state.players[pid].stats.roleCalls++;
        ev.push({ type: 'roleCallSuccess', attack: atk.id, reflect, call: atk.call });
        checkPhase(state, ev);
        checkDefeat(state, now, ev);
        return;
    }
    if (atk.call) ev.push({ type: 'roleCallFailed', attack: atk.id, call: atk.call });
    if (atk.kind === 'drones') {
        // nobody shot the drones down: they patch the boss back up
        const amount = Math.min(b.maxHp - b.hp, Math.round(b.maxHp * def.heal));
        b.hp += amount;
        ev.push({ type: 'bossRepair', attack: atk.id, amount });
        return;
    }
    if (state.team.dome > now) {
        ev.push({ type: 'domeBlock', attack: atk.id });
        if ((atk.kind === 'aoe' || atk.targets.length >= 3) && state.players[state.team.domeBy]) ev.push({ type: 'hero', kind: 'domeSave', pids: [state.team.domeBy], attack: atk.name });
        return;
    }

    ev.push({ type: 'attack', attack: atk.id, name: atk.name, targets: atk.targets });
    if (atk.kind === 'silence') {
        for (const pid of atk.targets) {
            const p = state.players[pid];
            if (!p || p.status !== 'alive') continue;
            if (p.shield) {
                const by = p.shieldBy && p.shieldBy !== p.id && state.players[p.shieldBy] ? p.shieldBy : null;
                if (by) state.players[by].stats.saves++;
                useShield(p);
                ev.push({ type: 'shieldBlock', pid: p.id, source: atk.id, by, amount: 0 });
            } else {
                p.silenced = now + def.ms;
                ev.push({ type: 'silenced', pid: p.id, until: p.silenced });
            }
        }
        return;
    }
    for (const pid of atk.targets) {
        const p = state.players[pid];
        if (!p) continue;
        const caster = p.shield && p.shieldBy && state.players[p.shieldBy];
        const blocked = damagePlayer(state, p, Math.round(p.maxHp * def.dmg * m.dmg), ev, atk.id) === 'blocked';
        if (atk.kind === 'infect' && p.status === 'alive' && !blocked && !p.infected) {
            p.infected = now + virusOf(b).spreadMs;
            ev.push({ type: 'infected', pid });
        }
        if (atk.kind === 'mark' && blocked && !b.defeatedAt) {
            // the shot bounces off the shield and back into the boss
            const amount = Math.round(b.maxHp * (def.ricochet || 0.04));
            b.hp = Math.max(0, b.hp - amount);
            if (caster) caster.stats.dmg += amount;
            ev.push({ type: 'ricochet', pid: p.id, by: caster ? caster.id : null, amount });
        }
    }
    if (atk.kind === 'mark') { checkPhase(state, ev); checkDefeat(state, now, ev); }
}

// ---------------------------------------------------------------- weak spot + elemental shield

// One class at a time deals extra damage to the boss's weak spot, and the weak
// spot moves every so often. The squad has to notice and let that class go all in.
export function isWeak(state, p, now) {
    const w = state.boss?.weak;
    return !!w && w.cls === p.cls && w.until > now;
}
const weakMult = b => b.weak?.mult || 3;

function tickWeak(state, now, rng, ev) {
    const b = state.boss, W = BOSSES[b.id].weakness;
    if (!W || b.eshield || (b.weak && now < b.weak.until)) return;
    const alive = [...new Set(alivePlayers(state).map(p => p.cls))];
    // a one-class raid has nobody to hand the weak spot to
    if (new Set(playersOf(state).map(p => p.cls)).size < 2 || !alive.length) { b.weak = null; return; }
    const pool = alive.length > 1 ? alive.filter(c => c !== b.weak?.cls) : alive;
    setWeak(b, pool[Math.floor(rng() * pool.length)], now + W.everyMs, W.mult, ev);
}

function setWeak(b, cls, until, mult, ev) {
    b.weak = { cls, until, mult };
    ev.push({ type: 'weakShift', cls, until, mult });
}

function raiseElementShield(state, now, { hp = 0.03, ms = 25000, dmg = 0.3, text = '' } = {}, rng, ev) {
    const b = state.boss;
    const alive = [...new Set(alivePlayers(state).map(p => p.cls))];
    if (!alive.length) return;
    const cls = b.weak && alive.includes(b.weak.cls) ? b.weak.cls : alive[Math.floor(rng() * alive.length)];
    const maxHp = Math.round(b.maxHp * hp);
    b.eshield = { cls, hp: maxHp, maxHp, endsAt: now + ms, dmg };
    setWeak(b, cls, b.eshield.endsAt, weakMult(b), ev);
    ev.push({ type: 'eshield', cls, endsAt: b.eshield.endsAt, text });
}

// Returns how much of a hit reaches the boss (toBoss) and what to show (shown)
function hitElementShield(state, p, amount, now, ev) {
    const b = state.boss, sh = b.eshield;
    if (p.cls !== sh.cls) {
        const leak = Math.round(amount * ESHIELD_LEAK);
        return { toBoss: leak, shown: leak, resisted: true };
    }
    const absorbed = Math.min(sh.hp, amount);
    sh.hp -= absorbed;
    if (sh.hp <= 0) {
        b.eshield = null;
        b.weak.until = now; // the weak spot moves on next tick
        b.attack = null; b.telegraph = null;
        b.stunUntil = now + ESHIELD_BREAK.stun;
        b.exposedUntil = now + ESHIELD_BREAK.expose;
        b.exposeBonus = CLASSES.TACTICIAN.abilities.special.bonus;
        b.exposedBy = null;
        ev.push({ type: 'eshieldBreak', pid: p.id, cls: p.cls, until: b.stunUntil });
    }
    return { toBoss: amount - absorbed, shown: amount, resisted: false };
}

function tickElementShield(state, now, ev) {
    const b = state.boss, sh = b.eshield;
    if (!sh || now < sh.endsAt) return;
    b.eshield = null;
    if (b.weak) b.weak.until = now;
    ev.push({ type: 'eshieldBurst', cls: sh.cls });
    if (state.team.dome > now) { ev.push({ type: 'domeBlock', attack: 'eshield' }); return; }
    const m = attackMult(state, now);
    for (const p of alivePlayers(state)) damagePlayer(state, p, Math.round(p.maxHp * sh.dmg * m.dmg), ev, 'eshield');
}

const DEFAULT_VIRUS = { spreadMs: INFECTION_SPREAD_MS, dmg: 0.08, overloadShare: 0.5, overloadDmg: 0.2, overloadCd: 25000 };
const virusOf = b => ({ ...DEFAULT_VIRUS, ...(BOSSES[b.id]?.virus || {}) });

// The virus bites its host and jumps to someone new. A Guardian shield on the
// next victim stops it cold (quarantine). If too much of the squad is infected
// at once, the boss triggers a SYSTEM OVERLOAD on everyone.
function tickInfection(state, now, rng, ev) {
    const b = state.boss, V = virusOf(b);
    for (const p of alivePlayers(state)) {
        if (!p.infected || now < p.infected) continue;
        damagePlayer(state, p, Math.round(p.maxHp * V.dmg), ev, 'virus');
        if (p.status === 'alive') p.infected = now + V.spreadMs;
        const clean = alivePlayers(state).filter(x => !x.infected && x.id !== p.id);
        if (!clean.length) continue;
        const v = clean[Math.floor(rng() * clean.length)];
        if (v.shield) {
            const by = v.shieldBy && v.shieldBy !== v.id && state.players[v.shieldBy] ? v.shieldBy : null;
            if (by) state.players[by].stats.saves++;
            useShield(v);
            ev.push({ type: 'quarantine', pid: v.id, from: p.id, by });
        } else {
            v.infected = now + V.spreadMs;
            ev.push({ type: 'infectionSpread', from: p.id, pid: v.id });
        }
    }
    const alive = alivePlayers(state);
    const sick = alive.filter(p => p.infected).length;
    if (alive.length >= 2 && sick >= Math.max(2, Math.ceil(alive.length * V.overloadShare)) && now >= (b.overloadAt || 0)) {
        b.overloadAt = now + V.overloadCd;
        ev.push({ type: 'overload', infected: sick });
        if (state.team.dome > now) { ev.push({ type: 'domeBlock', attack: 'overload' }); return; }
        const m = attackMult(state, now);
        for (const p of alive) damagePlayer(state, p, Math.round(p.maxHp * V.overloadDmg * m.dmg), ev, 'overload');
    }
}

// ---------------------------------------------------------------- scripted beats

function tickBeats(state, now, rng, ev) {
    const b = state.boss;
    const beats = BOSSES[b.id].beats || [];
    b.beatsDone ||= {};
    const frac = b.hp / b.maxHp;
    beats.forEach((beat, i) => {
        if (b.beatsDone[i] || frac > beat.at) return;
        b.beatsDone[i] = true;
        if (beat.kind === 'stagger') {
            b.attack = null; b.telegraph = null;
            b.stunUntil = now + beat.stun;
            b.exposedUntil = now + beat.expose;
            b.exposeBonus = CLASSES.TACTICIAN.abilities.special.bonus;
            b.exposedBy = null;
            ev.push({ type: 'stagger', until: b.stunUntil, text: beat.text });
        } else if (beat.kind === 'force') {
            b.cds[beat.attack] = now;
            b.attack = null; b.telegraph = null; b.stunUntil = 0;
            ev.push({ type: 'bossBeat', text: beat.text });
        } else if (beat.kind === 'eshield') {
            raiseElementShield(state, now, beat, rng, ev);
        } else if (beat.kind === 'lastStand') {
            const classes = [...new Set(alivePlayers(state).map(p => p.cls))];
            for (const p of alivePlayers(state)) p.ult = 100; // the boss's overload surges every ultimate to full
            b.attack = null; b.telegraph = null;
            b.lastStand = { endsAt: now + beat.ms, startedAt: now, need: classes, who: {}, dmg: beat.dmg, done: false };
            ev.push({ type: 'lastStand', endsAt: b.lastStand.endsAt, need: classes, text: beat.text });
        }
    });
}

function countLastStand(state, p, now, ev) {
    const ls = state.boss?.lastStand;
    if (!ls || ls.done || now > ls.endsAt || !ls.need.includes(p.cls) || ls.who[p.cls]) return;
    ls.who[p.cls] = p.id;
    ev.push({ type: 'lastStandProgress', pid: p.id, cls: p.cls, have: Object.keys(ls.who).length, need: ls.need.length });
    if (ls.need.every(c => ls.who[c])) {
        const b = state.boss;
        ls.done = true;
        const dmg = Math.round(b.maxHp * 0.15);
        b.hp = Math.max(0, b.hp - dmg);
        b.stunUntil = now + 8000;
        b.exposedUntil = now + 12000; b.exposeBonus = 0.4; b.exposedBy = null;
        ev.push({ type: 'lastStandWon', amount: dmg });
        ev.push({ type: 'hero', kind: 'lastStandSquad', pids: Object.values(ls.who) });
    }
}

function resolveLastStand(state, now, ev) {
    const b = state.boss, ls = b.lastStand;
    if (ls.done) { b.lastStand = null; return; }
    b.lastStand = null;
    ev.push({ type: 'lastStandFailed' });
    if (state.team.dome > now) {
        ev.push({ type: 'domeBlock', attack: 'annihilation' });
        if (state.players[state.team.domeBy]) ev.push({ type: 'hero', kind: 'domeSave', pids: [state.team.domeBy], attack: 'ANNIHILATION' });
        return;
    }
    const m = attackMult(state, now);
    for (const p of alivePlayers(state)) damagePlayer(state, p, Math.round(p.maxHp * ls.dmg * m.dmg), ev, 'annihilation');
}

// Advance the boss fight to `now`. Call about 4 times a second.
export function tick(state, now, rng = Math.random) {
    const b = state.boss;
    if (state.status !== 'boss' || !b || b.defeatedAt) return [];
    const ev = [];

    if (state.regroupUntil) {
        if (now < state.regroupUntil) return ev;
        state.regroupUntil = 0;
        for (const p of playersOf(state)) {
            if (p.status !== 'alive') { p.status = 'alive'; p.lives = Math.max(1, p.lives); }
            p.hp = Math.max(p.hp, Math.round(p.maxHp * 0.5));
            p.revive = 0;
        }
        ev.push({ type: 'regrouped' });
    }

    if (!b.enraged && now >= b.endsAt) { b.enraged = true; ev.push({ type: 'enrage' }); }
    const stacks = enrageStacks(b, now);
    if (stacks > (b.stacks || 0)) { b.stacks = stacks; ev.push({ type: 'enrageStack', stacks, dmg: Math.round(TIMER_ENRAGE.dmg * (1 + stacks * TIMER_ENRAGE.stackDmg) * 100) }); }

    const lvl = synergyLevel(state, now);
    if (lvl !== state.team.synLevel) {
        if (lvl < state.team.synLevel) ev.push({ type: 'synergyDrop', level: lvl, mult: SYNERGY_MULT[lvl] });
        state.team.synLevel = lvl;
    }

    tickInfection(state, now, rng, ev);
    tickBeats(state, now, rng, ev);
    tickElementShield(state, now, ev);
    tickWeak(state, now, rng, ev);

    if (b.lastStand) {
        // the boss is charging: no other attacks until the countdown resolves
        if (b.lastStand.done || now >= b.lastStand.endsAt) resolveLastStand(state, now, ev);
    } else if (b.attack) {
        if (now >= b.attack.landsAt) resolveAttack(state, now, ev);
    } else if (now >= b.stunUntil) {
        const attacks = BOSSES[b.id].attacks;
        // plan the next single-target attack ahead of time (threat radar)
        if (!b.telegraph) {
            const next = attacks.filter(a => !UNTARGETED.has(a.kind)).sort((x, y) => (b.cds[x.id] || 0) - (b.cds[y.id] || 0))[0];
            if (next && (b.cds[next.id] || 0) - now <= TELEGRAPH_MS) {
                const targets = pickTargets(state, next, rng);
                if (targets.length) b.telegraph = { id: next.id, name: next.name, targets, at: Math.max(now, b.cds[next.id] || 0) };
            }
        }
        const ready = attacks.filter(a => (b.cds[a.id] || 0) <= now);
        if (ready.length) {
            // a planned attack goes first so the radar never lies
            const a = (b.telegraph && ready.find(x => x.id === b.telegraph.id)) || ready[Math.floor(rng() * ready.length)];
            const e = startAttack(state, a, now, rng);
            if (e) ev.push(e);
        }
    }

    checkDefeat(state, now, ev);
    if (b.defeatedAt) return ev;

    if (playersOf(state).length && !alivePlayers(state).length) {
        state.raidLives--;
        b.attack = null;
        if (state.raidLives <= 0) {
            state.status = 'defeat';
            ev.push({ type: 'raidDefeat' });
        } else {
            state.regroupUntil = now + WIPE_REGROUP_MS;
            b.hp = Math.min(b.maxHp, b.hp + Math.round(b.maxHp * WIPE_BOSS_HEAL));
            ev.push({ type: 'wipe', raidLives: state.raidLives, regroupUntil: state.regroupUntil });
        }
    }
    return ev;
}

// ---------------------------------------------------------------- between stages

// After a boss falls: everyone is patched up for the next stage. Eliminated
// students come back with one life, so every boss is a fresh chance to play.
export function restoreBetweenStages(state) {
    for (const p of playersOf(state)) {
        if (p.status !== 'alive') { p.status = 'alive'; p.hp = 0; p.lives = Math.max(1, p.lives); }
        p.hp = Math.min(p.maxHp, Math.max(p.hp, 0) + Math.round(p.maxHp * 0.4));
        p.revive = 0; p.infected = 0; p.silenced = 0; p.armed = false;
        p.ult = Math.min(100, p.ult + 15);
    }
    state.team.syn = {};
    state.team.synLevel = 1;
    state.regroupUntil = 0;
    return [{ type: 'restored' }];
}

// Pausing: push every pending timer forward by the time spent paused.
export function shiftTime(state, dt) {
    const b = state.boss;
    if (b) {
        for (const k of ['startedAt', 'endsAt', 'exposedUntil', 'stunUntil']) if (b[k]) b[k] += dt;
        for (const k of Object.keys(b.cds)) b.cds[k] += dt;
        if (b.attack) { b.attack.startedAt += dt; b.attack.landsAt += dt; }
    }
    if (b?.lastStand) b.lastStand.endsAt += dt;
    if (b?.weak) b.weak.until += dt;
    if (b?.eshield) b.eshield.endsAt += dt;
    if (b?.overloadAt) b.overloadAt += dt;
    if (state.team.dome) state.team.dome += dt;
    if (state.regroupUntil) state.regroupUntil += dt;
    for (const k of Object.keys(state.team.syn)) state.team.syn[k] += dt;
    for (const p of playersOf(state)) { if (p.infected) p.infected += dt; if (p.silenced) p.silenced += dt; }
}

// ---------------------------------------------------------------- chaos mode (teacher)

// The teacher's toolbar during a fight. Each tool has its own cooldown so it
// can be used again and again, but not spammed.
export const CHAOS = {
    meteor: { cd: 40000, label: 'METEOR STRIKE', desc: '20% damage to the whole squad' },
    drain: { cd: 40000, label: 'SHIELD DRAIN', desc: 'Strip every shield' },
    patient: { cd: 40000, label: 'PATIENT ZERO', desc: 'Infect a random student' },
    reward: { cd: 12000, label: 'REWARD', desc: '+35% ultimate for one class' },
    strike: { cd: 60000, label: 'AIR STRIKE', desc: '6% damage to the boss' },
    rally: { cd: 60000, label: 'SUPPLY DROP', desc: '+25% ultimate for everyone' },
    silence: { cd: 40000, label: 'SILENCE', desc: 'One class can only basic-attack for 8 seconds' },
    eshield: { cd: 60000, label: 'ELEMENT SHIELD', desc: 'Only one class can hurt the boss until they break the shield' },
    weak: { cd: 30000, label: 'WEAK SPOT', desc: 'A new class deals triple damage for 15 seconds' }
};

export function chaosReady(state, kind, now) {
    return now >= ((state.team.chaos || {})[kind] || 0);
}

export function chaos(state, kind, now, { cls } = {}, rng = Math.random) {
    const b = state.boss;
    if (!CHAOS[kind] || state.status !== 'boss' || !b || b.defeatedAt || state.regroupUntil > now) return [];
    if (!chaosReady(state, kind, now)) return [];
    state.team.chaos = { ...(state.team.chaos || {}), [kind]: now + CHAOS[kind].cd };
    const ev = [{ type: 'chaos', kind, cls: cls || null }];
    const alive = alivePlayers(state);
    if (kind === 'meteor') {
        for (const p of alive) damagePlayer(state, p, Math.round(p.maxHp * 0.2), ev, 'meteor');
    } else if (kind === 'drain') {
        for (const p of alive) { p.shield = false; p.shieldBy = null; }
    } else if (kind === 'patient') {
        const clean = alive.filter(p => !p.infected);
        if (clean.length) {
            const v = clean[Math.floor(rng() * clean.length)];
            v.infected = now + virusOf(b).spreadMs;
            ev.push({ type: 'infected', pid: v.id });
        }
    } else if (kind === 'reward') {
        if (!CLASSES[cls]) return [];
        for (const p of alive.filter(p => p.cls === cls)) p.ult = Math.min(100, p.ult + 35);
        ev.push({ type: 'teacherReward', cls });
    } else if (kind === 'strike') {
        const amount = Math.round(b.maxHp * 0.06);
        b.hp = Math.max(1, b.hp - amount);
        ev.push({ type: 'hit', pid: null, amount, crit: true, ability: 'ult' });
        checkPhase(state, ev);
    } else if (kind === 'rally') {
        for (const p of alive) p.ult = Math.min(100, p.ult + 25);
    } else if (kind === 'silence') {
        const classes = [...new Set(alive.map(p => p.cls))];
        if (!classes.length) return ev;
        const c = classes[Math.floor(rng() * classes.length)];
        for (const p of alive.filter(p => p.cls === c)) { p.silenced = now + 8000; ev.push({ type: 'silenced', pid: p.id, until: p.silenced }); }
    } else if (kind === 'eshield') {
        if (b.eshield) return ev;
        raiseElementShield(state, now, {}, rng, ev);
    } else if (kind === 'weak') {
        if (b.eshield) return ev;
        const classes = [...new Set(alive.map(p => p.cls))];
        const pool = classes.length > 1 ? classes.filter(c => c !== b.weak?.cls) : classes;
        if (pool.length) setWeak(b, pool[Math.floor(rng() * pool.length)], now + 15000, 3, ev);
    }
    return ev;
}
