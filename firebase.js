/* ============================================ */
/* RAID REVIEW - Firebase Database Module       */
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
import { firebaseConfig } from './config.js';

// Initialize Firebase
const appInstance = initializeApp(firebaseConfig);
const db = getDatabase(appInstance);

/**
 * Get a database reference
 * @param {string} path - Database path
 * @returns {DatabaseReference}
 */
export function getRef(path) {
    return ref(db, path);
}

/**
 * Set data at a path (overwrites)
 * @param {string} path - Database path
 * @param {*} data - Data to set
 */
export async function setData(path, data) {
    try {
        await set(ref(db, path), data);
        return true;
    } catch (e) {
        console.error('Firebase set error:', e);
        return false;
    }
}

/**
 * Update data at a path (merges)
 * @param {string} path - Database path
 * @param {Object} data - Data to update
 */
export async function updateData(path, data) {
    try {
        await update(ref(db, path), data);
        return true;
    } catch (e) {
        console.error('Firebase update error:', e);
        return false;
    }
}

/**
 * Get data once from a path
 * @param {string} path - Database path
 * @returns {*} Data or null
 */
export async function getData(path) {
    try {
        const snap = await get(ref(db, path));
        return snap.exists() ? snap.val() : null;
    } catch (e) {
        console.error('Firebase get error:', e);
        return null;
    }
}

/**
 * Listen for data changes
 * @param {string} path - Database path
 * @param {Function} callback - Called with data on each change
 * @returns {Function} Unsubscribe function
 */
export function listenData(path, callback) {
    const dbRef = ref(db, path);
    const unsubscribe = onValue(dbRef, (snap) => {
        callback(snap.val());
    });
    return unsubscribe;
}

/**
 * Set up auto-removal on disconnect
 * @param {string} path - Database path to remove on disconnect
 */
export function setupDisconnect(path) {
    const dbRef = ref(db, path);
    onDisconnect(dbRef).remove();
}

/**
 * Remove data at a path
 * @param {string} path - Database path
 */
export async function removeData(path) {
    try {
        await remove(ref(db, path));
        return true;
    } catch (e) {
        console.error('Firebase remove error:', e);
        return false;
    }
}

/**
 * Generate a unique room code
 * @returns {string} 6-digit room code
 */
export function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Check if a game room exists
 * @param {string} code - Room code
 * @returns {boolean}
 */
export async function roomExists(code) {
    const data = await getData(`games/${code}`);
    return data !== null;
}
