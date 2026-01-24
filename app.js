/* ============================================ */
/* RAID REVIEW - Main Application               */
/* app.js                                       */
/* ============================================ */

import { onClick } from './ui.js';
import { show } from './ui.js';
import { showView } from './ui.js';
import { ripple } from './juice.js';
import * as Host from './host.js';
import * as Player from './player.js';

class RaidApp {
    constructor() {
        this.isHost = false;
        this.initEventListeners();
        console.log('🎮 Raid Review initialized');
    }

    initEventListeners() {
        onClick('btn-host-mode', () => this.enterHostMode());
        onClick('btn-join-mode', () => show('view-student-login'));
        onClick('btn-enter-lobby', () => Player.joinLobby());
        onClick('btn-back-home', () => showView('view-landing'));
        onClick('btn-start-raid', () => Host.startRaid());
        
        // Add ripple effect to buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('answer-btn') || e.target.classList.contains('action-btn')) {
                ripple(e.target, e.clientX, e.clientY);
            }
        });
    }

    enterHostMode() {
        this.isHost = true;
        Host.openMissionSelect((questions) => Host.initHost(questions));
    }

    selectClass(cls) {
        Player.selectClass(cls);
    }

    submitAnswer(idx, btn) {
        Player.submitAnswer(idx, btn);
    }

    performAction(type, btn) {
        Player.performAction(type, btn);
    }

    triggerAirstrike() {
        Host.triggerAirstrike();
    }

    triggerSupplyDrop() {
        Host.triggerSupplyDrop();
    }

    togglePause() {
        Host.togglePause();
    }

    cancelTargeting() {
        Player.cancelTargeting();
    }

    toggleChaosMode() {
        Host.toggleChaosMode();
    }

    chaosMeteorStrike() {
        Host.chaosMeteorStrike();
    }

    chaosShieldDrain() {
        Host.chaosShieldDrain();
    }
}

// Initialize app and expose to window for HTML onclick handlers
window.app = new RaidApp();
