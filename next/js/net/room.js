// Room data layer: how the host and students share a game through Firebase.
//
// games/{code}
//   v: 2
//   meta      { title, difficulty, format, created, hostUid, locked, callsigns, shuffle }   host
//   questions [ { text, answers[], correct, type } ]                                          host
//   live      { status, stage, boss, team, raidLives, regroupUntil, paused, fx }             host
//   kicked    { [pid]: true }                                                                host
//   players/{pid}
//     profile { name, cls, joinedAt }      student writes
//     intents { [key]: intent }            student writes, host deletes once applied
//     pub     { hp, maxHp, lives, status, ult, cd, streak, armed, shield, infected, revive }   host
//     stats   { dmg, heal, ... }           host
//     qlog    { q0: { r, w, m: { a1: n } } } host — per-question results for the teacher report
//
// Students only ever write inside their own players/{pid} node.

import { dbGet, dbSet, dbUpdate, dbListen, removeOnDisconnect } from '../firebase.js';

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
            questions,
            live: { status: 'lobby' }
        });
        return code;
    }
    throw new Error('Could not find a free room code');
}

// A student keeps the same id for a room across page reloads, so a dropped
// Chromebook can rejoin as itself.
export function playerIdFor(code) {
    const key = `rr2_pid_${code}`;
    let pid = null;
    try { pid = sessionStorage.getItem(key); } catch (e) { /* private mode */ }
    if (!pid) {
        pid = 'p' + Math.random().toString(36).slice(2, 10);
        try { sessionStorage.setItem(key, pid); } catch (e) { /* private mode */ }
    }
    return pid;
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
    const existing = room.players && room.players[pid];
    if (room.meta.locked && !existing) return { error: 'This room is locked. Ask your teacher to unlock it.' };
    if (!existing) {
        await dbSet(`${roomPath(code)}/players/${pid}/profile`, { name, cls: null, joinedAt: Date.now() });
        // leaving the lobby before the raid starts frees the spot
        if (room.live.status === 'lobby') removeOnDisconnect(`${roomPath(code)}/players/${pid}`);
    }
    return { room, rejoined: !!existing };
}

export const chooseClass = (code, pid, cls) => dbSet(`${roomPath(code)}/players/${pid}/profile/cls`, cls);

let intentCounter = 0;
export function sendIntent(code, pid, intent) {
    // keys sort in send order: time in base36 (fixed width for centuries) + counter
    const key = 'i' + Date.now().toString(36) + (intentCounter++ % 1296).toString(36).padStart(2, '0');
    return dbSet(`${roomPath(code)}/players/${pid}/intents/${key}`, intent);
}

export const listenRoom = (code, cb) => dbListen(roomPath(code), cb);
export const updateRoom = (code, changes) => dbUpdate(roomPath(code), changes);
