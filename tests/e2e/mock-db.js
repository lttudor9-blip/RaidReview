// In-memory stand-in for firebase-database.js, synced across tabs with BroadcastChannel.
const chan = new BroadcastChannel('mockfb');
let tree = {};
const listeners = new Set();
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
// Real Firebase never stores null or empty objects/arrays: they simply vanish.
// Arrays come back as arrays; nulls inside them become missing entries.
function prune(v) {
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) { const a = v.map(prune); return a.some(x => x !== undefined) ? a.map(x => (x === undefined ? null : x)) : undefined; }
    if (typeof v === 'object') {
        const o = {};
        for (const [k, x] of Object.entries(v)) { const p = prune(x); if (p !== undefined) o[k] = p; }
        return Object.keys(o).length ? o : undefined;
    }
    return v;
}
const parts = p => p.split('/').filter(Boolean);

function getAt(path) {
    let n = tree;
    for (const k of parts(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; }
    return n === undefined ? null : n;
}
function setAt(path, val) {
    const ks = parts(path);
    if (!ks.length) { tree = val ?? {}; return; }
    let n = tree;
    for (const k of ks.slice(0, -1)) { if (n[k] == null || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
    const last = ks[ks.length - 1];
    const v = prune(clone(val));
    if (v === undefined) delete n[last]; else n[last] = v;
}
function notify() {
    for (const l of [...listeners]) {
        const v = clone(getAt(l.path));
        const sv = JSON.stringify(v);
        if (sv !== l.last) { l.last = sv; l.cb(snap(v)); }
    }
}
const snap = v => ({ val: () => clone(v), exists: () => v !== null && v !== undefined });
function apply(op, local) {
    if (op.t === 'set') setAt(op.path, op.val);
    if (op.t === 'update') for (const [k, v] of Object.entries(op.val)) setAt(op.path + '/' + k, v);
    if (local) chan.postMessage(op);
    notify();
}
chan.onmessage = e => {
    const op = e.data;
    if (op.t === 'hello') { chan.postMessage({ t: 'state', tree }); return; }
    if (op.t === 'state') { if (!Object.keys(tree).length) { tree = op.tree; notify(); } return; }
    apply(op, false);
};
chan.postMessage({ t: 'hello' });
window.__mockfb = { tree: () => tree, write: (path, val) => apply({ t: 'set', path, val }, true), update: (path, val) => apply({ t: 'update', path, val }, true), get: getAt };

export const getDatabase = () => ({});
export const ref = (db, path) => ({ path });
export const set = async (r, val) => apply({ t: 'set', path: r.path, val: clone(val) }, true);
export const update = async (r, val) => apply({ t: 'update', path: r.path, val: clone(val) }, true);
export const remove = async r => apply({ t: 'set', path: r.path, val: null }, true);
export const get = async r => snap(clone(getAt(r.path)));
// Connection state for this tab. __mockfb.drop() simulates a Chromebook losing
// its connection: the server runs this tab's onDisconnect writes, then the tab
// reconnects (as a real one does when the wifi comes back or the page reloads).
let connected = true;
const connListeners = new Set();
const onDisc = [];
const setConnected = v => { connected = v; for (const cb of connListeners) cb(snap(v)); };
window.__mockfb.drop = () => {
    setConnected(false);
    for (const op of onDisc.splice(0)) apply(op, true);
};
window.__mockfb.reconnect = () => setConnected(true);
export const onValue = (r, cb) => {
    if (r.path === '.info/connected') {
        connListeners.add(cb);
        setTimeout(() => cb(snap(connected)), 0);
        return () => connListeners.delete(cb);
    }
    const l = { path: r.path, cb, last: undefined };
    listeners.add(l);
    setTimeout(() => { l.last = JSON.stringify(clone(getAt(r.path))); cb(snap(getAt(r.path))); }, 0);
    return () => listeners.delete(l);
};
export const onDisconnect = r => ({
    remove: async () => { onDisc.push({ t: 'set', path: r.path, val: null }); },
    set: async v => { onDisc.push({ t: 'set', path: r.path, val: clone(v) }); },
    cancel: async () => { for (let i = onDisc.length - 1; i >= 0; i--) if (onDisc[i].path === r.path) onDisc.splice(i, 1); }
});
export const runTransaction = async (r, fn) => {
    const v = fn(clone(getAt(r.path)));
    if (v !== undefined) apply({ t: 'set', path: r.path, val: v }, true);
    return { committed: true, snapshot: snap(v) };
};
export const increment = n => n;
export const serverTimestamp = () => Date.now();
