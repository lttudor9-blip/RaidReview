/* ============================================ */
/* RAID REVIEW - Battle Set Manager            */
/* ============================================ */

import { DEFAULT_QUESTIONS } from './config.js';
import { setData, getData, updateData, removeData } from './firebase.js';
import { show, hide, setText, setHTML, getInputValue } from './ui.js';
import { ripple } from './juice.js';

// Current state
let currentTeacherId = 'demo'; // For now, single teacher (later: auth)
let currentSets = {};
let editingSetId = null;
let editingQuestionIndex = null;

/**
 * Built-in demo set (Ancient Egypt)
 */
const DEMO_SET = {
    id: 'demo-egypt',
    title: 'Ancient Egypt (Demo)',
    subject: 'History',
    grade: '6th',
    builtin: true,
    created: Date.now(),
    modified: Date.now(),
    questions: DEFAULT_QUESTIONS
};

/**
 * Open Battle Set Manager
 * @param {Function} onSelectSet - Callback when set is selected
 */
export async function openBattleSetManager(onSelectSet) {
    // Load teacher's sets
    await loadBattleSets();
    
    // Render manager
    renderBattleSetList();
    
    // Show modal
    show('view-battleset-manager');
    
    // Store callback for when set is selected
    window.battleSetCallback = onSelectSet;
}

/**
 * Close Battle Set Manager
 */
export function closeBattleSetManager() {
    hide('view-battleset-manager');
    hide('view-question-editor');
}

/**
 * Load all battle sets for current teacher
 */
async function loadBattleSets() {
    try {
        const sets = await getData(`battleSets/${currentTeacherId}`);
        currentSets = sets || {};
    } catch (e) {
        console.error('Error loading battle sets:', e);
        currentSets = {};
    }
}

/**
 * Save a battle set
 * @param {Object} set - Battle set to save
 */
async function saveBattleSet(set) {
    try {
        set.modified = Date.now();
        await setData(`battleSets/${currentTeacherId}/${set.id}`, set);
        currentSets[set.id] = set;
        return true;
    } catch (e) {
        console.error('Error saving battle set:', e);
        return false;
    }
}

/**
 * Delete a battle set
 * @param {string} setId - ID of set to delete
 */
async function deleteBattleSet(setId) {
    if (!confirm('Delete this battle set? This cannot be undone.')) {
        return;
    }
    
    try {
        await removeData(`battleSets/${currentTeacherId}/${setId}`);
        delete currentSets[setId];
        renderBattleSetList();
    } catch (e) {
        console.error('Error deleting battle set:', e);
    }
}

/**
 * Render the battle set list
 */
function renderBattleSetList() {
    const container = document.getElementById('battleset-list');
    if (!container) return;
    
    // Combine demo set with user sets
    const allSets = {
        [DEMO_SET.id]: DEMO_SET,
        ...currentSets
    };
    
    if (Object.keys(allSets).length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 py-12">
                <div class="text-4xl mb-4">Ã°Å¸â€œÅ¡</div>
                <p class="text-lg mb-2">No battle sets yet</p>
                <p class="text-sm text-gray-600">Click "Create New Set" to get started!</p>
            </div>
        `;
        return;
    }
    
    // Render sets
    container.innerHTML = Object.values(allSets)
        .sort((a, b) => {
            // Demo always first
            if (a.builtin) return -1;
            if (b.builtin) return 1;
            return b.modified - a.modified;
        })
        .map(set => {
            const questionCount = set.questions?.length || 0;
            const isBuiltin = set.builtin;
            const timeAgo = isBuiltin ? 'Built-in' : getTimeAgo(set.modified);
            
            return `
                <div class="battleset-card" data-set-id="${set.id}">
                    <div class="flex items-start justify-between mb-2">
                        <div class="flex-1">
                            <h3 class="text-xl font-bold mb-1" style="font-family: 'Orbitron';">
                                Ã°Å¸â€œÅ¡ ${set.title}
                                ${isBuiltin ? '<span class="text-xs text-gold ml-2 px-2 py-1 bg-gold/20 rounded">DEMO</span>' : ''}
                            </h3>
                            <p class="text-sm text-gray-400">
                                ${questionCount} question${questionCount !== 1 ? 's' : ''} Ã¢â‚¬Â¢ ${timeAgo}
                            </p>
                            ${set.subject ? `<p class="text-xs text-gray-500">${set.subject}${set.grade ? ` Ã¢â‚¬Â¢ ${set.grade}` : ''}</p>` : ''}
                        </div>
                    </div>
                    <div class="flex gap-2 mt-3">
                        <button onclick="window.battleSetManager.selectSet('${set.id}')" 
                                class="battleset-btn-small primary">
                            Ã¢â€“Â¶ START RAID
                        </button>
                        ${!isBuiltin ? `
                            <button onclick="window.battleSetManager.editSet('${set.id}')" 
                                    class="battleset-btn-small secondary">
                                Ã¢Å“ÂÃ¯Â¸Â EDIT
                            </button>
                        ` : ''}
                        <button onclick="window.battleSetManager.duplicateSet('${set.id}')" 
                                class="battleset-btn-small secondary">
                            Ã°Å¸â€œâ€¹ DUPLICATE
                        </button>
                        ${!isBuiltin ? `
                            <button onclick="window.battleSetManager.deleteSet('${set.id}')" 
                                    class="battleset-btn-small danger">
                                Ã°Å¸â€”â€˜Ã¯Â¸Â
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
}

/**
 * Get time ago string
 * @param {number} timestamp
 * @returns {string}
 */
function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    return `${Math.floor(seconds / 604800)} weeks ago`;
}

/**
 * Select a set to start raid
 * @param {string} setId
 */
export function selectSet(setId) {
    const set = setId === DEMO_SET.id ? DEMO_SET : currentSets[setId];
    if (!set) return;
    
    // Call the callback with questions
    if (window.battleSetCallback) {
        window.battleSetCallback(set.questions);
    }
    
    closeBattleSetManager();
}

/**
 * Create a new battle set
 */
export function createNewSet() {
    editingSetId = null;
    editingQuestionIndex = null;
    
    // Show question editor with empty set
    const newSet = {
        id: `set_${Date.now()}`,
        title: 'New Battle Set',
        subject: '',
        grade: '',
        created: Date.now(),
        modified: Date.now(),
        questions: []
    };
    
    editSet(newSet.id, newSet);
}

/**
 * Edit an existing set
 * @param {string} setId
 */
export function editSet(setId, providedSet = null) {
    editingSetId = setId;
    const set = providedSet || (setId === DEMO_SET.id ? {...DEMO_SET, id: `set_${Date.now()}`, builtin: false} : currentSets[setId]);
    
    if (!set) return;
    
    // Render editor
    renderQuestionEditor(set);
    
    // Show editor
    hide('view-battleset-manager');
    show('view-question-editor');
}

/**
 * Duplicate a set
 * @param {string} setId
 */
export function duplicateSet(setId) {
    const originalSet = setId === DEMO_SET.id ? DEMO_SET : currentSets[setId];
    if (!originalSet) return;
    
    const duplicatedSet = {
        ...originalSet,
        id: `set_${Date.now()}`,
        title: `${originalSet.title} (Copy)`,
        builtin: false,
        created: Date.now(),
        modified: Date.now(),
        questions: [...originalSet.questions]
    };
    
    editSet(duplicatedSet.id, duplicatedSet);
}

/**
 * Delete a set (exposed for window access)
 * @param {string} setId
 */
export function deleteSet(setId) {
    deleteBattleSet(setId);
}

/**
 * Render the question editor
 * @param {Object} set
 */
function renderQuestionEditor(set) {
    // Set header info
    document.getElementById('editor-set-title').value = set.title;
    document.getElementById('editor-set-subject').value = set.subject || '';
    document.getElementById('editor-set-grade').value = set.grade || '';
    
    // Render questions
    renderQuestionList(set.questions || []);
}

/**
 * Render question list in editor
 * @param {Array} questions
 */
function renderQuestionList(questions) {
    const container = document.getElementById('question-list');
    if (!container) return;
    
    if (questions.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 py-8">
                <p class="text-lg mb-2">No questions yet</p>
                <p class="text-sm">Click "Add Question" to create your first question!</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = questions.map((q, idx) => {
        const correctAnswer = q.answers[q.correct];
        return `
            <div class="question-item" data-index="${idx}">
                <div class="flex items-start gap-3">
                    <div class="text-2xl font-bold text-gray-600" style="font-family: 'Orbitron';">${idx + 1}</div>
                    <div class="flex-1">
                        <p class="text-lg mb-2">${q.text}</p>
                        <div class="flex flex-wrap gap-2 mb-2">
                            ${q.answers.map((ans, i) => `
                                <span class="answer-chip ${i === q.correct ? 'correct' : ''}">
                                    ${String.fromCharCode(65 + i)}) ${ans}
                                    ${i === q.correct ? ' Ã¢Å“â€œ' : ''}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="window.battleSetManager.editQuestion(${idx})" 
                                class="icon-btn">Ã¢Å“ÂÃ¯Â¸Â</button>
                        <button onclick="window.battleSetManager.deleteQuestion(${idx})" 
                                class="icon-btn">Ã°Å¸â€”â€˜Ã¯Â¸Â</button>
                        ${idx > 0 ? `<button onclick="window.battleSetManager.moveQuestion(${idx}, -1)" class="icon-btn">Ã¢â€ â€˜</button>` : ''}
                        ${idx < questions.length - 1 ? `<button onclick="window.battleSetManager.moveQuestion(${idx}, 1)" class="icon-btn">Ã¢â€ â€œ</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Add or edit a question
 * @param {number} index - Question index (null for new)
 */
export function editQuestion(index = null) {
    editingQuestionIndex = index;
    
    const set = getCurrentEditingSet();
    if (!set) return;
    
    const question = index !== null ? set.questions[index] : {
        text: '',
        answers: ['', '', '', ''],
        correct: 0
    };
    
    // Populate modal
    document.getElementById('question-text-input').value = question.text;
    document.getElementById('answer-0').value = question.answers[0] || '';
    document.getElementById('answer-1').value = question.answers[1] || '';
    document.getElementById('answer-2').value = question.answers[2] || '';
    document.getElementById('answer-3').value = question.answers[3] || '';
    
    // Set correct answer radio
    document.querySelectorAll('input[name="correct-answer"]').forEach((radio, i) => {
        radio.checked = i === question.correct;
    });
    
    // Show modal
    show('view-question-modal');
}

/**
 * Save the current question
 */
export function saveQuestion() {
    const set = getCurrentEditingSet();
    if (!set) return;
    
    const questionText = getInputValue('question-text-input');
    const answers = [
        getInputValue('answer-0'),
        getInputValue('answer-1'),
        getInputValue('answer-2'),
        getInputValue('answer-3')
    ];
    
    // Get correct answer
    let correct = 0;
    document.querySelectorAll('input[name="correct-answer"]').forEach((radio, i) => {
        if (radio.checked) correct = i;
    });
    
    // Validate
    if (!questionText.trim()) {
        alert('Please enter a question');
        return;
    }
    
    if (answers.some(a => !a.trim())) {
        alert('Please fill in all answer options');
        return;
    }
    
    // Create question object
    const question = {
        text: questionText,
        answers: answers,
        correct: correct
    };
    
    // Add or update
    if (editingQuestionIndex !== null) {
        set.questions[editingQuestionIndex] = question;
    } else {
        set.questions.push(question);
    }
    
    // Update display
    renderQuestionList(set.questions);
    
    // Close modal
    hide('view-question-modal');
    editingQuestionIndex = null;
}

/**
 * Delete a question
 * @param {number} index
 */
export function deleteQuestion(index) {
    if (!confirm('Delete this question?')) return;
    
    const set = getCurrentEditingSet();
    if (!set) return;
    
    set.questions.splice(index, 1);
    renderQuestionList(set.questions);
}

/**
 * Move question up or down
 * @param {number} index
 * @param {number} direction - -1 for up, 1 for down
 */
export function moveQuestion(index, direction) {
    const set = getCurrentEditingSet();
    if (!set) return;
    
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= set.questions.length) return;
    
    // Swap
    [set.questions[index], set.questions[newIndex]] = [set.questions[newIndex], set.questions[index]];
    
    renderQuestionList(set.questions);
}

/**
 * Save the entire set
 */
export async function saveSet() {
    const title = getInputValue('editor-set-title');
    const subject = getInputValue('editor-set-subject');
    const grade = getInputValue('editor-set-grade');
    
    if (!title.trim()) {
        alert('Please enter a set title');
        return;
    }
    
    const set = getCurrentEditingSet();
    if (!set) return;
    
    if (set.questions.length === 0) {
        alert('Please add at least one question');
        return;
    }
    
    // Update set info
    set.title = title;
    set.subject = subject;
    set.grade = grade;
    
    // Save to Firebase
    const success = await saveBattleSet(set);
    
    if (success) {
        // Return to manager
        hide('view-question-editor');
        show('view-battleset-manager');
        renderBattleSetList();
    } else {
        alert('Error saving battle set. Please try again.');
    }
}

/**
 * Cancel editing
 */
export function cancelEdit() {
    if (confirm('Discard changes?')) {
        hide('view-question-editor');
        show('view-battleset-manager');
    }
}

/**
 * Get the currently editing set
 * @returns {Object}
 */
function getCurrentEditingSet() {
    if (!editingSetId) return null;
    
    // Check if it's a new set stored temporarily
    const tempSet = document.getElementById('view-question-editor').dataset.editingSet;
    if (tempSet) {
        return JSON.parse(tempSet);
    }
    
    return currentSets[editingSetId];
}

/**
 * Store editing set temporarily
 * @param {Object} set
 */
function storeEditingSet(set) {
    document.getElementById('view-question-editor').dataset.editingSet = JSON.stringify(set);
}

// Expose functions to window for HTML onclick handlers
window.battleSetManager = {
    selectSet,
    createNewSet,
    editSet,
    duplicateSet,
    deleteSet,
    editQuestion,
    saveQuestion,
    deleteQuestion,
    moveQuestion,
    saveSet,
    cancelEdit
};
