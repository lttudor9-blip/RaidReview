// BattleSets in Firebase: battleSets/{uid}/{setId}
// Same shape the original dashboard used, so every existing set just works:
//   { id, title, created, modified, questions: [{ text, answers[], correct, type }], subject? }

import { dbGet, dbSet, dbRemove } from '../firebase.js';
import { DEMO_QUESTIONS } from '../content/questions.js';

export const DEMO_SET = {
    id: 'demo-egypt', title: 'Ancient Egypt (Demo)', subject: 'Social Studies', builtin: true,
    created: 0, modified: 0, questions: DEMO_QUESTIONS
};

export async function listSets(uid) {
    const all = (await dbGet(`battleSets/${uid}`)) || {};
    return Object.values(all).filter(s => s && s.id).map(s => ({ ...s, questions: s.questions || [] }));
}

export async function saveSet(uid, set) {
    const clean = {
        id: set.id, title: (set.title || 'Untitled set').trim(), subject: (set.subject || '').trim(),
        created: set.created || Date.now(), modified: Date.now(),
        questions: (set.questions || []).map(cleanQuestion)
    };
    await dbSet(`battleSets/${uid}/${set.id}`, clean);
    return clean;
}

// Blank answer boxes are dropped so games never show an empty button; the
// right answer keeps pointing at the same text.
function cleanQuestion(q) {
    const type = q.type === 'tf' ? 'tf' : 'mc';
    const raw = (q.answers || []).map(a => String(a ?? '').trim());
    if (type === 'tf') return { text: (q.text || '').trim(), answers: ['True', 'False'], correct: q.correct === 1 ? 1 : 0, type };
    const right = raw[q.correct || 0] || '';
    const answers = raw.filter(Boolean);
    return { text: (q.text || '').trim(), answers, correct: Math.max(0, answers.indexOf(right)), type };
}

export const deleteSet = (uid, id) => dbRemove(`battleSets/${uid}/${id}`);
export const newSetId = () => `set_${Date.now()}`;

// Hand a set to the game page (the contract play.html reads)
export function launch(set) {
    localStorage.setItem('rr_launch_questions', JSON.stringify(set.questions));
    localStorage.setItem('rr_launch_set_title', set.title);
    location.href = 'play.html?host=1';
}
