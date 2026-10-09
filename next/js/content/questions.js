// Question helpers shared by the game and the BattleSet creator.

export const DEMO_QUESTIONS = [
    { text: 'What river was essential to Ancient Egyptian civilization?', answers: ['Nile', 'Amazon', 'Tigris', 'Danube'], correct: 0, type: 'mc' },
    { text: 'Who was the boy pharaoh whose tomb was found in 1922?', answers: ['Ramses II', 'Cleopatra', 'Tutankhamun', 'Khufu'], correct: 2, type: 'mc' },
    { text: 'The Great Pyramids of Giza were built as tombs.', answers: ['True', 'False'], correct: 0, type: 'tf' },
    { text: 'What writing system did Ancient Egyptians use?', answers: ['Cuneiform', 'Hieroglyphics', 'Latin', 'Sanskrit'], correct: 1, type: 'mc' },
    { text: 'Which god had the head of a jackal?', answers: ['Ra', 'Osiris', 'Anubis', 'Horus'], correct: 2, type: 'mc' },
    { text: 'Papyrus was used to make paper.', answers: ['True', 'False'], correct: 0, type: 'tf' }
];

// Clean up a question from any source (old BattleSets, imports). Returns null if unusable.
export function normalizeQuestion(q) {
    if (!q || typeof q.text !== 'string' || !q.text.trim()) return null;
    const type = q.type === 'tf' ? 'tf' : 'mc';
    let answers = Array.isArray(q.answers) ? q.answers.map(a => String(a ?? '').trim()) : [];
    if (type === 'tf') answers = [answers[0] || 'True', answers[1] || 'False'];
    else answers = answers.filter(a => a !== '').slice(0, 4);
    if (answers.length < 2) return null;
    let correct = Number.isInteger(q.correct) ? q.correct : 0;
    if (type === 'mc' && Array.isArray(q.answers)) {
        // keep the right answer pointing at the same text after empty answers are dropped
        const want = String(q.answers[correct] ?? '').trim();
        const i = answers.indexOf(want);
        correct = i >= 0 ? i : 0;
    }
    correct = Math.max(0, Math.min(answers.length - 1, correct));
    return { text: q.text.trim(), answers, correct, type };
}

export function normalizeSet(questions) {
    return (questions || []).map(normalizeQuestion).filter(Boolean);
}

export function shuffled(list, rng = Math.random) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Endless shuffled deck of question indexes for one student.
export function questionDeck(count) {
    let deck = [];
    let last = -1;
    return () => {
        if (!deck.length) {
            deck = shuffled([...Array(count).keys()]);
            if (deck.length > 1 && deck[deck.length - 1] === last) deck.unshift(deck.pop()); // no back-to-back repeat across reshuffles
        }
        last = deck.pop();
        return last;
    };
}
