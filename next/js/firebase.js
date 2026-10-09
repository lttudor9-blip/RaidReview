// One Firebase setup for the whole new app.
// App name 'raidreview' matters: Firebase Auth keeps a teacher signed in per app
// name, so the landing page and the game must use the same one.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, set, update, onValue, get, remove, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

export const RR_CONFIG = {
    apiKey: 'AIzaSyAZEr2hAQSSfJKEO4w1x2f_qziWIAytocQ',
    authDomain: 'raid-review-d6ad0.firebaseapp.com',
    databaseURL: 'https://raid-review-d6ad0-default-rtdb.firebaseio.com',
    projectId: 'raid-review-d6ad0'
};

export const app = initializeApp(RR_CONFIG, 'raidreview');
export const db = getDatabase(app);
export const auth = getAuth(app);

export async function dbGet(path) {
    const s = await get(ref(db, path));
    return s.exists() ? s.val() : null;
}
export const dbSet = (path, value) => set(ref(db, path), value);
export const dbUpdate = (path, value) => update(ref(db, path), value);
export const dbRemove = path => remove(ref(db, path));
export function dbListen(path, cb) {
    return onValue(ref(db, path), s => cb(s.val()));
}
export function removeOnDisconnect(path) {
    onDisconnect(ref(db, path)).remove();
}

// Resolves with the signed-in teacher, or null if nobody signs in within `ms`.
// Firebase reports null first while it restores a saved session, so wait for a user.
export function waitForTeacher(ms = 4000) {
    return new Promise(resolve => {
        let done = false;
        const finish = u => { if (!done) { done = true; resolve(u); } };
        const stop = onAuthStateChanged(auth, u => { if (u) { finish(u); stop && stop(); } });
        setTimeout(() => finish(auth.currentUser || null), ms);
    });
}

export const teacherAuth = {
    signIn: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
    signUp: (email, pw) => createUserWithEmailAndPassword(auth, email, pw),
    reset: email => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),
    onChange: cb => onAuthStateChanged(auth, cb)
};
