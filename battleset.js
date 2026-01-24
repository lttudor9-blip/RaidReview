/* ============================================ */
/* BATTLE SET MANAGER                           */
/* battleset.js                                 */
/* ============================================ */

import { DEFAULT_QUESTIONS } from './config.js';
import { getData, setData, removeData } from './firebase.js';
import { show, hide, getInputValue } from './ui.js';

let currentTeacherId = 'demo'; 
let currentSets = {};
let editingSetId = null;
let editingQuestionIndex = null;

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

export async function openBattleSetManager(onSelectSet) {
    await loadBattleSets();
    renderBattleSetList();
    show('view-battleset-manager');
    window.battleSetCallback = onSelectSet;
}

export function closeBattleSetManager() {
    hide('view-battleset-manager');
    hide('view-question-editor');
}

async function loadBattleSets() {
    try {
        const sets = await getData(`battleSets/${currentTeacherId}`);
        currentSets = sets || {};
    } catch (e) {
        console.error('Error loading battle sets:', e);
        currentSets = {};
    }
}

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

function renderBattleSetList() {
    const container = document.getElementById('battleset-list');
    if (!container) return;
    const allSets = { [DEMO_SET.id]: DEMO_SET, ...currentSets };
    if (Object.keys(allSets).length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 py-12">
                <div class="text-4xl mb-4">📚</div>
                <p class="text-lg mb-2">No battle sets yet</p>
                <p class="text-sm text-gray-600">Click "Create New Set" to get started!</p>
            </div>`;
        return;
    }
    container.innerHTML = Object.values(allSets).sort((a, b) => {
        if (a.builtin) return -1;
        if (b.builtin) return 1;
        return b.modified - a.modified;
    }).map(set => {
        const questionCount = set.questions?.length || 0;
        const isBuiltin = set.builtin;
        return `
            <div class="battleset-card" data-set-id="${set.id}">
                <div class="flex items-start justify-between mb-2">
                    <div class="flex-1">
                        <h3 class="text-xl font-bold mb-1" style="font-family: 'Orbitron';">
                            📖 ${set.title}
                            ${isBuiltin ? '<span class="text-xs text-gold ml-2 px-2 py-1 bg-gold/20 rounded">DEMO</span>' : ''}
                        </h3>
                        <p class="text-sm text-gray-400">${questionCount} question${questionCount !== 1 ? 's' : ''}</p>
                        ${set.subject ? `<p class="text-xs text-gray-500">${set.subject}${set.grade ? ` • ${set.grade}` : ''}</p>` : ''}
                    </div>
                </div>
                <div class="flex gap-2 mt-3">
                    <button onclick="window.battleSetManager.selectSet('${set.id}')" class="battleset-btn-small primary">▶ START RAID</button>
                    ${!isBuiltin ? `<button onclick="window.battleSetManager.editSet('${set.id}')" class="battleset-btn-small secondary">✏️ EDIT</button>` : ''}
                    <button onclick="window.battleSetManager.duplicateSet('${set.id}')" class="battleset-btn-small secondary">📋 DUPLICATE</button>
                    ${!isBuiltin ? `<button onclick="window.battleSetManager.deleteSet('${set.id}')" class="battleset-btn-small danger">🗑</button>` : ''}
                </div>
            </div>`;
    }).join('');
}

function selectSet(setId) {
    const set = setId === DEMO_SET.id ? DEMO_SET : currentSets[setId];
    if (!set) return;
    if (window.battleSetCallback) window.battleSetCallback(set.questions);
    closeBattleSetManager();
}

function createNewSet() {
    editingSetId = null;
    editingQuestionIndex = null;
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

function editSet(setId, providedSet = null) {
    editingSetId = setId;
    const set = providedSet || (setId === DEMO_SET.id ? {...DEMO_SET, id: `set_${Date.now()}`, builtin: false} : currentSets[setId]);
    if (!set) return;
    storeEditingSet(set);
    renderQuestionEditor(set);
    hide('view-battleset-manager');
    show('view-question-editor');
}

function duplicateSet(setId) {
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

function deleteSet(setId) { deleteBattleSet(setId); }

function renderQuestionEditor(set) {
    document.getElementById('editor-set-title').value = set.title;
    document.getElementById('editor-set-subject').value = set.subject || '';
    document.getElementById('editor-set-grade').value = set.grade || '';
    renderQuestionList(set.questions || []);
}

function renderQuestionList(questions) {
    const container = document.getElementById('question-list');
    if (!container) return;
    if (questions.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 py-8"><p class="text-lg mb-2">No questions yet</p><p class="text-sm">Click "Add Question" to create your first question!</p></div>`;
        return;
    }
    container.innerHTML = questions.map((q, idx) => `
        <div class="question-item" data-index="${idx}">
            <div class="flex items-start gap-3">
                <div class="text-2xl font-bold text-gray-600" style="font-family: 'Orbitron';">${idx + 1}</div>
                <div class="flex-1">
                    <p class="text-lg mb-2">${q.text}</p>
                    <div class="flex flex-wrap gap-2 mb-2">
                        ${q.answers.map((ans, i) => `<span class="answer-chip ${i === q.correct ? 'correct' : ''}">${String.fromCharCode(65 + i)}) ${ans} ${i === q.correct ? ' ✓' : ''}</span>`).join('')}
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="window.battleSetManager.moveQuestion(${idx}, -1)" class="icon-btn" ${idx === 0 ? 'disabled' : ''}>↑</button>
                    <button onclick="window.battleSetManager.moveQuestion(${idx}, 1)" class="icon-btn" ${idx === questions.length - 1 ? 'disabled' : ''}>↓</button>
                    <button onclick="window.battleSetManager.editQuestion(${idx})" class="icon-btn">✏️</button>
                    <button onclick="window.battleSetManager.deleteQuestion(${idx})" class="icon-btn">🗑</button>
                </div>
            </div>
        </div>`).join('');
}

function editQuestion(index = null) {
    editingQuestionIndex = index;
    const set = getCurrentEditingSet();
    if (!set) return;
    const question = index !== null ? set.questions[index] : { text: '', answers: ['', '', '', ''], correct: 0 };
    document.getElementById('question-text-input').value = question.text;
    document.getElementById('edit-answer-0').value = question.answers[0] || '';
    document.getElementById('edit-answer-1').value = question.answers[1] || '';
    document.getElementById('edit-answer-2').value = question.answers[2] || '';
    document.getElementById('edit-answer-3').value = question.answers[3] || '';
    document.querySelectorAll('input[name="correct-answer"]').forEach((radio, i) => { radio.checked = i === question.correct; });
    show('view-question-modal');
}

function saveQuestion() {
    const set = getCurrentEditingSet();
    if (!set) return;
    const questionText = getInputValue('question-text-input');
    const answers = [
        getInputValue('edit-answer-0'),
        getInputValue('edit-answer-1'),
        getInputValue('edit-answer-2'),
        getInputValue('edit-answer-3')
    ];
    let correct = 0;
    document.querySelectorAll('input[name="correct-answer"]').forEach((radio, i) => { if (radio.checked) correct = i; });
    if (!questionText.trim()) { alert('Please enter a question'); return; }
    if (answers.some(a => !a.trim())) { alert('Please fill in all answer options'); return; }
    const question = { text: questionText, answers: answers, correct: correct };
    if (editingQuestionIndex !== null) { set.questions[editingQuestionIndex] = question; } else { set.questions.push(question); }
    storeEditingSet(set);
    renderQuestionList(set.questions);
    hide('view-question-modal');
    editingQuestionIndex = null;
}

function deleteQuestion(index) {
    if (!confirm('Delete this question?')) return;
    const set = getCurrentEditingSet();
    if (!set) return;
    set.questions.splice(index, 1);
    storeEditingSet(set);
    renderQuestionList(set.questions);
}

function moveQuestion(index, direction) {
    const set = getCurrentEditingSet();
    if (!set) return;
    const questions = set.questions;
    const newIndex = index + direction;
    
    if (newIndex < 0 || newIndex >= questions.length) return;
    
    // Swap
    const temp = questions[index];
    questions[index] = questions[newIndex];
    questions[newIndex] = temp;
    
    storeEditingSet(set);
    renderQuestionList(set.questions);
}

async function saveSet() {
    const title = getInputValue('editor-set-title');
    const subject = getInputValue('editor-set-subject');
    const grade = getInputValue('editor-set-grade');
    if (!title.trim()) { alert('Please enter a set title'); return; }
    const set = getCurrentEditingSet();
    if (!set) return;
    if (set.questions.length === 0) { alert('Please add at least one question'); return; }
    set.title = title; set.subject = subject; set.grade = grade;
    const success = await saveBattleSet(set);
    if (success) { hide('view-question-editor'); show('view-battleset-manager'); renderBattleSetList(); }
    else { alert('Error saving battle set. Please try again.'); }
}

function cancelEdit() {
    if (confirm('Discard changes?')) { hide('view-question-editor'); show('view-battleset-manager'); }
}

function getCurrentEditingSet() {
    if (!editingSetId) return null;
    const tempSet = document.getElementById('view-question-editor').dataset.editingSet;
    if (tempSet) return JSON.parse(tempSet);
    return currentSets[editingSetId];
}

function storeEditingSet(set) {
    document.getElementById('view-question-editor').dataset.editingSet = JSON.stringify(set);
}

// Expose to window for onclick handlers
window.battleSetManager = {
    selectSet, createNewSet, editSet, duplicateSet, deleteSet, editQuestion, saveQuestion, deleteQuestion, moveQuestion, saveSet, cancelEdit
};

export { selectSet, createNewSet, editSet, duplicateSet, deleteSet, editQuestion, saveQuestion, deleteQuestion, moveQuestion, saveSet, cancelEdit };
