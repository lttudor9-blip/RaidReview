// Dark Zone lives in its own Firebase project. The original dashboard signed
// teachers into it with the same email/password; we keep doing that so Dark
// Zone launches keep working, and look up Dark Zone rooms for students.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const DZ_CONFIG = {
    apiKey: 'AIzaSyBw3RMEsrw0nxf2IHxNADtuhY-V19oRmpo',
    authDomain: 'raid-review-dark-zone.firebaseapp.com',
    databaseURL: 'https://raid-review-dark-zone-default-rtdb.firebaseio.com',
    projectId: 'raid-review-dark-zone',
    storageBucket: 'raid-review-dark-zone.firebasestorage.app',
    messagingSenderId: '1044981105489',
    appId: '1:1044981105489:web:34d225d4950ff05ece4970'
};

let dz = null;
function app() {
    if (!dz) { const a = initializeApp(DZ_CONFIG, 'darkzone'); dz = { db: getDatabase(a), auth: getAuth(a) }; }
    return dz;
}

// Best effort: a Dark Zone hiccup must never block signing in to Raid Review.
export async function mirrorSignIn(email, password) {
    try { await signInWithEmailAndPassword(app().auth, email, password); }
    catch (e) { try { await createUserWithEmailAndPassword(app().auth, email, password); } catch (e2) { /* ignore */ } }
}
export async function mirrorSignOut() { try { await signOut(app().auth); } catch (e) { /* ignore */ } }

export async function darkZoneRoomExists(code) {
    try { return (await get(ref(app().db, `darkzone/${code}`))).exists(); } catch (e) { return false; }
}
