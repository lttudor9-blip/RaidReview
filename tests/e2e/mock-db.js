// In-memory stand-in for firebase-database.js, synced across tabs with BroadcastChannel.
const chan = new BroadcastChannel('mockfb');
let tree = {};
const listeners = new Set();
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
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
    if (val === null || val === undefined) delete n[last]; else n[last] = clone(val);
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
export const onValue = (r, cb) => {
    const l = { path: r.path, cb, last: undefined };
    listeners.add(l);
    setTimeout(() => { l.last = JSON.stringify(clone(getAt(r.path))); cb(snap(getAt(r.path))); }, 0);
    return () => listeners.delete(l);
};
export const onDisconnect = () => ({ remove: () => {}, set: () => {} });
export const runTransaction = async (r, fn) => {
    const v = fn(clone(getAt(r.path)));
    if (v !== undefined) apply({ t: 'set', path: r.path, val: v }, true);
    return { committed: true, snapshot: snap(v) };
};
export const increment = n => n;
export const serverTimestamp = () => Date.now();
