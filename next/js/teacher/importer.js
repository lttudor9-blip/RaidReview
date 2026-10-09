// Bulk question import: turn pasted text or a CSV into BattleSet questions.
// Pure functions (no DOM) so they're unit tested in tests/importer.test.mjs.
//
// Formats it understands, one question per line:
//   Raid format    Question? | correct answer | wrong | wrong | wrong
//                  T/F: The sun is a star | true
//   Two-column     term <TAB> definition     (Quizlet export, or two spreadsheet columns)
//                  term - definition  /  term : definition  /  term, definition
//                  → multiple choice: "What is <term>?" with other definitions as wrong answers
//   CSV            question,correct,wrong1,wrong2,wrong3   (header row optional)

const TF_TRUE = /^(t|true|yes|y|correct)$/i;
const TF_FALSE = /^(f|false|no|n|incorrect)$/i;

function shuffle(a, rng) {
    const out = [...a];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
}

// Split one CSV line, honoring "quoted, values"
export function splitCsv(line) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') q = false;
            else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
}

// Build a correct-first MC question; the game shuffles answer order itself.
function mc(text, correct, wrongs) {
    const answers = [correct, ...wrongs].map(s => s.trim()).filter(Boolean);
    const unique = [...new Set(answers.map(a => a.toLowerCase()))].length === answers.length;
    return { text: text.trim(), answers, correct: 0, type: 'mc', _dupes: !unique };
}

function tf(text, value) {
    return { text: text.trim(), answers: ['True', 'False'], correct: value ? 0 : 1, type: 'tf' };
}

// Raid-format line → question or { error }
export function parseRaidLine(line) {
    const tfm = line.match(/^\s*(?:t\/?f|true\/false)\s*[:\-]\s*(.+)$/i);
    if (tfm) {
        const [stmt, val] = tfm[1].split('|').map(s => s.trim());
        if (!stmt) return { error: 'missing the statement' };
        if (val === undefined || val === '') return { error: 'add | true or | false after the statement' };
        if (TF_TRUE.test(val)) return tf(stmt, true);
        if (TF_FALSE.test(val)) return tf(stmt, false);
        return { error: `"${val}" isn't true or false` };
    }
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 2) return { error: 'use | between the question and answers' };
    const [text, correct, ...wrongs] = parts;
    if (!text) return { error: 'missing the question' };
    if (!correct) return { error: 'missing the correct answer' };
    if (parts.length === 2 && (TF_TRUE.test(correct) || TF_FALSE.test(correct))) return tf(text, TF_TRUE.test(correct));
    const real = wrongs.filter(Boolean);
    if (!real.length) return { error: 'add at least one wrong answer' };
    if (real.length > 3) return { error: 'at most 3 wrong answers' };
    const q = mc(text, correct, real);
    if (q._dupes) return { error: 'two answers are the same' };
    delete q._dupes;
    return q;
}

// Two-column pair (term, definition) detection for one line
export function splitPair(line) {
    if (line.includes('\t')) { const [a, ...b] = line.split('\t'); return [a.trim(), b.join(' ').trim()]; }
    for (const sep of [' - ', ' – ', ' — ', ': ', ' = ']) {
        const i = line.indexOf(sep);
        if (i > 0) return [line.slice(0, i).trim(), line.slice(i + sep.length).trim()];
    }
    return null;
}

// Term/definition pairs → MC questions using other definitions as distractors
export function pairsToQuestions(pairs, { ask = 'definition', rng = Math.random } = {}) {
    const clean = pairs.filter(([t, d]) => t && d);
    if (clean.length < 2) return { questions: [], errors: [{ line: 0, error: 'need at least 2 term/definition pairs to make wrong answers' }] };
    const questions = clean.map(([term, def], i) => {
        const others = shuffle(clean.filter((_, j) => j !== i), rng).slice(0, 3);
        return ask === 'definition'
            ? { text: `What is "${term}"?`, answers: [def, ...others.map(o => o[1])], correct: 0, type: 'mc' }
            : { text: `Which term means: ${def}`, answers: [term, ...others.map(o => o[0])], correct: 0, type: 'mc' };
    });
    return { questions, errors: [] };
}

// Look at the pasted text and guess the format
export function detectFormat(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return 'empty';
    const pipes = lines.filter(l => l.includes('|') || /^(t\/?f|true\/false)\s*[:\-]/i.test(l)).length;
    if (pipes >= lines.length * 0.6) return 'raid';
    const tabs = lines.filter(l => l.includes('\t')).length;
    if (tabs >= lines.length * 0.6) return 'pairs';
    const commas = lines.filter(l => splitCsv(l).length >= 3).length;
    if (commas >= lines.length * 0.6) return 'csv';
    const pairs = lines.filter(l => splitPair(l)).length;
    if (pairs >= lines.length * 0.6) return 'pairs';
    return 'raid';
}

// Main entry: text → { format, questions, errors: [{ line, text, error }] }
export function parseBulk(text, { format = 'auto', ask = 'definition', rng = Math.random } = {}) {
    const fmt = format === 'auto' ? detectFormat(text) : format;
    const raw = text.split(/\r?\n/);
    const questions = [], errors = [];
    if (fmt === 'empty') return { format: fmt, questions, errors };
    if (fmt === 'pairs') {
        const pairs = [];
        raw.forEach((line, i) => {
            if (!line.trim()) return;
            const p = splitPair(line);
            if (p && p[0] && p[1]) pairs.push(p);
            else errors.push({ line: i + 1, text: line, error: 'couldn\'t find a term and a definition (use a tab or " - " between them)' });
        });
        const r = pairsToQuestions(pairs, { ask, rng });
        return { format: fmt, questions: r.questions, errors: [...errors, ...r.errors] };
    }
    raw.forEach((line, i) => {
        if (!line.trim()) return;
        if (fmt === 'csv') {
            const cells = splitCsv(line).filter((c, k) => k < 5);
            if (i === 0 && /question/i.test(cells[0] || '') && /correct|answer/i.test(cells[1] || '')) return; // header row
            const r = parseRaidLine(cells.filter(Boolean).join(' | '));
            if (r.error) errors.push({ line: i + 1, text: line, error: r.error }); else questions.push(r);
            return;
        }
        const r = parseRaidLine(line);
        if (r.error) errors.push({ line: i + 1, text: line, error: r.error }); else questions.push(r);
    });
    return { format: fmt, questions, errors };
}

// Problems with a single question, for the editor's warning chips
export function questionIssues(q) {
    const issues = [];
    if (!q.text || !q.text.trim()) issues.push('Question is empty');
    const filled = (q.answers || []).map(a => (a || '').trim()).filter(Boolean);
    if (q.type !== 'tf' && filled.length < 2) issues.push('Needs at least 2 answers');
    if (q.type !== 'tf' && !(q.answers[q.correct] || '').trim()) issues.push('The correct answer is blank');
    if (new Set(filled.map(a => a.toLowerCase())).size !== filled.length) issues.push('Two answers are the same');
    return issues;
}
