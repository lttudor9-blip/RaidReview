// Room data layer: how the host and students share a game through Firebase.
//
// games/{code}
//   v: 2
//   meta      { title, difficulty, format, created, hostUid, locked, callsigns, shuffle }   host
//   questions [ { text, answers[], type } ]   NO answer key: only the host knows it         host
//   live      { status, stage, boss, team, raidLives, regroupUntil, paused, fx }             host
//   kicked    { [pid]: true }                                                                host
//   players/{pid}
//     profile { name, cls, joinedAt }      student writes
//     away    true while the Chromebook is disconnected (Firebase sets it on disconnect)
//     intents { [key]: intent }            student writes, host deletes once applied
//     pub     { hp, maxHp, lives, status, ult, cd, streak, armed, shield, infected, revive }   host
//     stats   { dmg, heal, ... }           host
//     qlog    { q0: { r, w, m: { a1: n } } } host — per-question results for the teacher report
//
// Students only ever write inside their own players/{pid} node.

import { dbGet, dbSet, dbUpdate, dbListen, presence } from '../firebase.js';

export const roomPath = code => `games/${code}`;

function randomCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

export async function createRoom({ hostUid, title, questions, settings }) {
    for (let i = 0; i < 20; i++) {
        const code = randomCode();
        if (await dbGet(roomPath(code))) continue;
        await dbSet(roomPath(code), {
            v: 2,
            meta: { title: title || 'Raid Review', created: Date.now(), hostUid: hostUid || null, ...settings },
            // students get the questions without the answer key: the host checks
            // every answer, so there's nothing on a Chromebook for a cheat script to read
            questions: questions.map(({ text, answers, type }) => ({ text, answers, type: type || 'mc' })),
            live: { status: 'lobby' }
        });
        return code;
    }
    throw new Error('Could not find a free room code');
}

// A student keeps the same id for a room on this Chromebook, even after the tab
// is closed or the Chromebook restarts, so a frozen screen can rejoin as itself.
const pidKey = code => `rr2_pid_${code}`;
export function playerIdFor(code) {
    let pid = null;
    try { pid = localStorage.getItem(pidKey(code)) || sessionStorage.getItem(pidKey(code)); } catch (e) { /* storage blocked */ }
    if (!pid) pid = 'p' + Math.random().toString(36).slice(2, 10);
    rememberPid(code, pid);
    return pid;
}
function rememberPid(code, pid) {
    try { localStorage.setItem(pidKey(code), pid); } catch (e) { /* storage blocked */ }
}

export async function lookupRoom(code) {
    const room = await dbGet(roomPath(code));
    if (!room) return { error: 'Room not found. Check the code on the projector.' };
    if (room.v !== 2) return { error: 'That room is running the classic version.', classic: true };
    return { room };
}

export async function joinRoom(code, pid, name) {
    const { room, error } = await lookupRoom(code);
    if (error) return { error };
    if (room.kicked && room.kicked[pid]) return { error: 'You were removed from this room.' };
    let existing = room.players && room.players[pid] && room.players[pid].profile ? room.players[pid] : null;
    if (!existing) {
        // a different Chromebook (or cleared storage): typing the same name takes
        // back your disconnected character, so nobody is ever locked out
        const lower = name.toLowerCase();
        const mine = Object.entries(room.players || {}).find(([id, n]) => n.away && n.profile?.name?.toLowerCase() === lower && !room.kicked?.[id]);
        if (mine) { pid = mine[0]; existing = mine[1]; rememberPid(code, pid); }
    }
    if (room.meta.locked && !existing) return { error: 'This room is locked. If you were already in this raid, type the exact same name you used before.' };
    if (!existing) await dbSet(`${roomPath(code)}/players/${pid}/profile`, { name, cls: null, joinedAt: Date.now() });
    // while this Chromebook is connected `away` is cleared; if it drops, Firebase
    // marks it away (the character stays in the raid, ready for the student to return)
    presence(`${roomPath(code)}/players/${pid}/away`);
    return { room, pid, rejoined: !!existing };
}

// Put a profile back if it went missing (e.g. an older version of the game
// deleted it when the Chromebook dropped out)
export const restoreProfile = (code, pid, profile) => dbSet(`${roomPath(code)}/players/${pid}/profile`, profile);

export const chooseClass = (code, pid, cls) => dbSet(`${roomPath(code)}/players/${pid}/profile/cls`, cls);

let intentCounter = 0;
export function sendIntent(code, pid, intent) {
    // keys sort in send order: time in base36 (fixed width for centuries) + counter
    const key = 'i' + Date.now().toString(36) + (intentCounter++ % 1296).toString(36).padStart(2, '0');
    return dbSet(`${roomPath(code)}/players/${pid}/intents/${key}`, intent);
}

export const listenRoom = (code, cb) => dbListen(roomPath(code), cb);
export const updateRoom = (code, changes) => dbUpdate(roomPath(code), changes);
