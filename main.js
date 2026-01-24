/* ============================================ */
/* RAID REVIEW - Main Entry Point               */
/* ============================================ */

import { showView, show, hide, onClick } from './ui.js';
import { ripple } from './juice.js';
import * as host from './host.js';
import * as player from './player.js';
import './battleset.js'; // Initialize battleset manager

/**
 * Main application class
 * Coordinates between host and player modules
 */
class RaidApp {
    constructor() {
        this.isHost = false;
        this.bindEvents();
    }

    /**
     * Bind all UI event listeners
     */
    bindEvents() {
        // Landing page
        onClick('btn-host-mode', () => this.enterHostMode());
        onClick('btn-join-mode', () => show('view-student-login'));
        onClick('btn-close-mission', () => hide('view-mission-select'));
        
        // Login
        onClick('btn-enter-lobby', () => player.joinLobby());
        onClick('btn-back-home', () => showView('view-landing'));
        
        // Host controls
        onClick('btn-start-raid', () => host.startRaid());
        
        // Global ripple effect on buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('answer-btn') || 
                e.target.classList.contains('action-btn')) {
                ripple(e.target, e.clientX, e.clientY);
            }
        });
    }

    /**
     * Enter host mode - show mission selection
     */
    enterHostMode() {
        this.isHost = true;
        host.openMissionSelect((questions) => {
            host.initHost(questions);
        });
    }

    /**
     * Select a class (called from HTML onclick)
     * @param {string} cls - Class name
     */
    selectClass(cls) {
        player.selectClass(cls);
    }

    /**
     * Submit an answer (called from HTML onclick)
     * @param {number} idx - Answer index
     * @param {HTMLElement} btn - Button element
     */
    submitAnswer(idx, btn) {
        player.submitAnswer(idx, btn);
    }

    /**
     * Perform an action (called from HTML onclick)
     * @param {string} type - Action type
     * @param {HTMLElement} btn - Button element
     */
    performAction(type, btn) {
        player.performAction(type, btn);
    }

    /**
     * Host: Trigger airstrike
     */
    triggerAirstrike() {
        host.triggerAirstrike();
    }

    /**
     * Host: Trigger supply drop
     */
    triggerSupplyDrop() {
        host.triggerSupplyDrop();
    }

    /**
     * Host: Toggle pause
     */
    togglePause() {
        host.togglePause();
    }

    /**
     * Cancel targeting mode (if active)
     */
    cancelTargeting() {
        player.cancelTargeting();
    }

    /**
     * Host: Toggle Chaos Mode
     */
    toggleChaosMode() {
        host.toggleChaosMode();
    }

    /**
     * Host: Chaos Mode - Meteor Strike
     */
    chaosMeteorStrike() {
        host.chaosMeteorStrike();
    }

    /**
     * Host: Chaos Mode - Shield Drain
     */
    chaosShieldDrain() {
        host.chaosShieldDrain();
    }

    /**
     * Player: Handle puzzle input
     */
    onPuzzleInput(value) {
        player.onPuzzleInput(value);
    }

    /**
     * Player: Submit puzzle code
     */
    submitPuzzleCode() {
        player.submitPuzzleCode();
    }

    /**
     * Player: Pick a symbol in symbol puzzle
     */
    pickSymbol(symbolId) {
        player.pickSymbol(symbolId);
    }

    /**
     * Player: Clear symbol selection
     */
    clearSymbolSelection() {
        player.clearSymbolSelection();
    }

    /**
     * Player: Submit symbol code
     */
    submitSymbolCode() {
        player.submitSymbolCode();
    }
}

// Initialize app and expose to window for HTML onclick handlers
window.app = new RaidApp();

console.log(' Raid Review initialized');
