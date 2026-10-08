// Raid Review rules engine.
//
// Pure game logic: no Firebase, no DOM. The host owns the one true game state,
// feeds student intents and clock ticks through these functions, and gets back
// a list of events that drive the visuals. Functions mutate `state` in place and
// return events. `now` is a timestamp in ms; `rng` is a () => [0,1) function so
// tests and the balance simulator can be deterministic.

import { CLASSES, SYNERGY_WINDOW, SYNERGY_MULT, STREAK_BONUS, ULT_PER_CORRECT, ULT_PER_SUPPORT, SPIRIT_RALLY_PER_CORRECT } from '../content/classes.js';
import { BOSSES, PHASES, TIMER_ENRAGE, ROLE_CALL_REFLECT, INFECTION_SPREAD_MS, MIN_SCALING_PLAYERS, WIPE_REGROUP_MS, WIPE_BOSS_HEAL, RAID_LIVES, PLAYER_LIVES, DIFFICULTY } from '../content/raid.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
    const maxHp = Math.round(c.hp * difficultyOf(state).playerHp);
    state.players[pid] = {
        id: pid, name, cls,
        hp: maxHp, maxHp, lives: PLAYER_LIVES, status: 'alive',
        ult: 0, cd: 0, streak: 0, armed: false,
        shield: false, infected: 0, revive: 0,
        stats: { dmg: 0, heal: 0, shields: 0, correct: 0, wrong: 0, downs: 0, revives: 0, bestStreak: 0, ults: 0, roleCalls: 0 }
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
    return SYNERGY_MULT[synergyLevel(state, now)];
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
            p.ult = Math.min(100, p.ult + ULT_PER_CORRECT);
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
            if (p.shield) { p.shield = false; ev.push({ type: 'shieldBlock', pid }); }
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
                base = ab.comboPower; combo = 'SHATTER';
                b.exposedUntil = 0; // the combo consumes the Expose
            } else if (ability === 'special' && exposed) {
                base *= 1.5; crit = true;
            }
            const mult = (1 + streakBonus(p)) * synergyMult(state, now) * (exposed ? 1 + b.exposeBonus : 1);
            const amount = Math.round(base * mult);
            b.hp = Math.max(0, b.hp - amount);
            p.stats.dmg += amount;
            ev.push({ type: 'hit', pid, ability, amount, crit, combo });
            if (combo) ev.push({ type: 'combo', name: combo, pid });
            break;
        }
        case 'shield': {
            if (ally.status !== 'alive') return [{ type: 'rejected', pid, reason: 'target is down' }];
            ally.shield = true;
            p.stats.shields++;
            p.ult = Math.min(100, p.ult + ULT_PER_SUPPORT);
            ev.push({ type: 'shield', pid, target: ally.id });
            break;
        }
        case 'heal': {
            if (ally.status === 'down') {
                revive(state, ally, ab.reviveAmount, pid, ev);
            } else if (ally.status === 'alive') {
                const amount = Math.min(ally.maxHp - ally.hp, Math.round(ally.maxHp * ab.amount));
                ally.hp += amount;
                p.stats.heal += amount;
                if (ally.infected) { ally.infected = 0; ev.push({ type: 'cured', pid, target: ally.id }); }
                ev.push({ type: 'heal', pid, target: ally.id, amount });
            } else {
                return [{ type: 'rejected', pid, reason: 'target is out' }];
            }
            p.ult = Math.min(100, p.ult + ULT_PER_SUPPORT);
            break;
        }
        case 'expose': {
            b.exposedUntil = now + ab.duration;
            b.exposeBonus = ab.bonus;
            p.ult = Math.min(100, p.ult + ULT_PER_SUPPORT);
            ev.push({ type: 'expose', pid, until: b.exposedUntil });
            break;
        }
        case 'dome': {
            state.team.dome = now + ab.duration;
            ev.push({ type: 'dome', pid, until: state.team.dome });
            break;
        }
        case 'massHeal': {
            for (const a of playersOf(state)) {
                if (a.status === 'down') revive(state, a, ab.reviveAmount, pid, ev);
                else if (a.status === 'alive') {
                    const amount = Math.min(a.maxHp - a.hp, Math.round(a.maxHp * ab.amount));
                    a.hp += amount; a.infected = 0;
                    p.stats.heal += amount;
                }
            }
            ev.push({ type: 'massHeal', pid });
            break;
        }
        case 'breach': {
            if (b.attack) { ev.push({ type: 'interrupt', pid, attack: b.attack.id }); b.attack = null; }
            b.stunUntil = now + ab.stun;
            b.exposedUntil = now + ab.expose;
            b.exposeBonus = CLASSES.TACTICIAN.abilities.special.bonus;
            ev.push({ type: 'breach', pid });
            break;
        }
    }

    if (ability === 'special') p.cd = Math.max(1, ab.cooldown + d.cooldownMod);
    if (ability === 'ult') { p.ult = 0; p.stats.ults++; ev.push({ type: 'ult', pid, name: ab.name }); }

    countRoleCall(state, p, ability, ev);
    checkPhase(state, ev);
    checkDefeat(state, now, ev);
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
    p.revive = 0; p.shield = false; p.infected = 0; p.armed = false; p.streak = 0;
    p.stats.downs++;
    ev.push({ type: p.status === 'out' ? 'eliminated' : 'down', pid: p.id });
}

function damagePlayer(state, p, amount, ev, source) {
    if (p.status !== 'alive') return;
    if (p.shield) { p.shield = false; ev.push({ type: 'shieldBlock', pid: p.id, source }); return; }
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
    if (have >= call.need) { call.done = true; ev.push({ type: 'roleCallMet' }); }
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
        need = cls === 'ANY' ? clamp(Math.ceil(alive.length * 0.4), 1, 8) : clamp(Math.ceil(ofClass * 0.4), 1, 3);
    }
    return { cls, need: Math.max(1, need), who: {}, done: false, text };
}

// ---------------------------------------------------------------- bosses

export function startBoss(state, bossId, now) {
    const B = BOSSES[bossId];
    if (!B) throw new Error(`unknown boss ${bossId}`);
    const d = difficultyOf(state);
    const n = Math.max(MIN_SCALING_PLAYERS, playersOf(state).length);
    const maxHp = Math.round(B.hpPerPlayer * n * d.bossHp);
    state.boss = {
        id: bossId, name: B.name, hp: maxHp, maxHp,
        phase: 'NORMAL', enraged: false,
        startedAt: now, endsAt: now + B.timeLimit,
        exposedUntil: 0, exposeBonus: 0, stunUntil: 0,
        attack: null, cds: {}, defeatedAt: 0
    };
    B.attacks.forEach((a, i) => { state.boss.cds[a.id] = now + a.cooldown * 0.5 + i * 4000; });
    state.team.dome = 0;
    for (const p of playersOf(state)) { p.infected = 0; p.armed = false; }
    state.status = 'boss';
    return [{ type: 'bossStart', boss: bossId, maxHp }];
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

function checkDefeat(state, now, ev) {
    const b = state.boss;
    if (b && b.hp <= 0 && !b.defeatedAt) {
        b.hp = 0;
        b.defeatedAt = now;
        b.attack = null;
        ev.push({ type: 'bossDefeated', boss: b.id });
    }
}

function attackMult(state) {
    const b = state.boss;
    const ph = PHASES.find(p => p.id === b.phase);
    // small groups have fewer bodies to spread hits across, so the boss eases off
    const smallRoom = clamp(0.55 + playersOf(state).length * 0.035, 0.6, 1);
    return {
        speed: ph.speed * (b.enraged ? TIMER_ENRAGE.speed : 1),
        dmg: ph.dmg * (b.enraged ? TIMER_ENRAGE.dmg : 1) * difficultyOf(state).bossDmg * smallRoom
    };
}

function pickTargets(state, a, rng) {
    const alive = alivePlayers(state);
    if (a.kind === 'aoe') return alive.map(p => p.id);
    const count = Math.min(alive.length, (a.targets || 1) + Math.floor(alive.length / 8));
    if (a.kind === 'lowest') {
        return [...alive].sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp).slice(0, count).map(p => p.id);
    }
    const pool = [...alive];
    const out = [];
    while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0].id);
    return out;
}

function startAttack(state, a, now, rng) {
    const targets = pickTargets(state, a, rng);
    if (!targets.length) return null;
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
    const m = attackMult(state);
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
    if (state.team.dome > now) { ev.push({ type: 'domeBlock', attack: atk.id }); return; }

    ev.push({ type: 'attack', attack: atk.id, name: atk.name, targets: atk.targets });
    for (const pid of atk.targets) {
        const p = state.players[pid];
        if (!p) continue;
        damagePlayer(state, p, Math.round(p.maxHp * def.dmg * m.dmg), ev, atk.id);
        if (atk.kind === 'infect' && p.status === 'alive') {
            p.infected = now + INFECTION_SPREAD_MS;
            ev.push({ type: 'infected', pid });
        }
    }
}

function tickInfection(state, now, rng, ev) {
    for (const p of alivePlayers(state)) {
        if (!p.infected || now < p.infected) continue;
        // the virus bites its host and jumps to someone new
        damagePlayer(state, p, Math.round(p.maxHp * 0.08), ev, 'virus');
        if (p.status === 'alive') p.infected = now + INFECTION_SPREAD_MS;
        const clean = alivePlayers(state).filter(x => !x.infected);
        if (clean.length) {
            const v = clean[Math.floor(rng() * clean.length)];
            v.infected = now + INFECTION_SPREAD_MS;
            ev.push({ type: 'infectionSpread', from: p.id, pid: v.id });
        }
    }
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

    const lvl = synergyLevel(state, now);
    if (lvl !== state.team.synLevel) {
        if (lvl < state.team.synLevel) ev.push({ type: 'synergyDrop', level: lvl, mult: SYNERGY_MULT[lvl] });
        state.team.synLevel = lvl;
    }

    tickInfection(state, now, rng, ev);

    if (b.attack) {
        if (now >= b.attack.landsAt) resolveAttack(state, now, ev);
    } else if (now >= b.stunUntil) {
        const ready = BOSSES[b.id].attacks.filter(a => (b.cds[a.id] || 0) <= now);
        if (ready.length) {
            const a = ready[Math.floor(rng() * ready.length)];
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
