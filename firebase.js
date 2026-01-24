/* ============================================ */
/* FIREBASE WRAPPER                             */
/* firebase.js                                  */
/* ============================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getDatabase, 
    ref, 
    set, 
    update, 
    onValue, 
    get, 
    onDisconnect, 
    remove 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAZEr2hAQSSfJKEO4w1x2f_qziWIAytocQ",
    authDomain: "raid-review-d6ad0.firebaseapp.com",
    databaseURL: "https://raid-review-d6ad0-default-rtdb.firebaseio.com",
    projectId: "raid-review-d6ad0"
};

const appInstance = initializeApp(firebaseConfig);
const db = getDatabase(appInstance);

export function getRef(path) {
    return ref(db, path);
}

export async function setData(path, data) {
    try {
        await set(ref(db, path), data);
        return true;
    } catch (e) {
        console.error('Firebase set error:', e);
        return false;
    }
}

export async function updateData(path, data) {
    try {
        await update(ref(db, path), data);
        return true;
    } catch (e) {
        console.error('Firebase update error:', e);
        return false;
    }
}

export async function getData(path) {
    try {
        const snap = await get(ref(db, path));
        return snap.exists() ? snap.val() : null;
    } catch (e) {
        console.error('Firebase get error:', e);
        return null;
    }
}

export function listenData(path, callback) {
    const dbRef = ref(db, path);
    const unsubscribe = onValue(dbRef, (snap) => {
        callback(snap.val());
    });
    return unsubscribe;
}

export function setupDisconnect(path) {
    const dbRef = ref(db, path);
    onDisconnect(dbRef).remove();
}

export async function removeData(path) {
    try {
        await remove(ref(db, path));
        return true;
    } catch (e) {
        console.error('Firebase remove error:', e);
        return false;
    }
}

export function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
