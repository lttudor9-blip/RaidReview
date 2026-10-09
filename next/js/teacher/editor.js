// BattleSet editor: fast to type in, autosaves, flags problems, bulk-imports.

import { dbGet } from '../firebase.js';
import { saveSet, newSetId } from './sets.js';
import { parseBulk, questionIssues } from './importer.js';
import { openLaunch } from './dashboard.js';
import { crest } from '../content/crests.js';
import { CLASS_IDS, CLASSES } from '../content/classes.js';
import { esc, toast } from '../ui.js';

const blank = (type = 'mc') => type === 'tf'
    ? { text: '', answers: ['True', 'False'], correct: 0, type: 'tf' }
    : { text: '', answers: ['', '', '', ''], correct: 0, type: 'mc' };
const LETTERS = 'ABCD';

export async function renderEditor(root, user, id) {
    const E = { user, set: null, sel: 0, timer: null, saving: false, dirty: false, saved: false };
    root.innerHTML = '<div class="muted" style="padding:40px;text-align:center">Loading…</div>';
    if (id) {
        const s = await dbGet(`battleSets/${user.uid}/${id}`).catch(() => null);
        if (!s) { toast('That set was not found'); location.hash = '#/dashboard'; return; }
        E.set = { ...s, questions: (s.questions || []).map(q => ({ ...q, answers: q.type === 'tf' ? ['True', 'False'] : [...(q.answers || []), '', '', '', ''].slice(0, 4) })) };
        E.saved = true;
    } else {
        E.set = { id: newSetId(), title: '', subject: '', created: Date.now(), questions: [blank()] };
    }
    if (!E.set.questions.length) E.set.questions.push(blank());

    root.innerHTML = `
    <div class="ed">
        <div class="ed-top">
            <a class="btn ghost" href="#/dashboard">← SETS</a>
            <input class="ed-title" id="e-title" placeholder="Name your BattleSet (e.g. Unit 4: Ancient Egypt)" value="${esc(E.set.title)}" maxlength="80">
            <input class="field ed-subject" id="e-subject" placeholder="Subject" value="${esc(E.set.subject || '')}" maxlength="30">
            <div class="ed-status" id="e-status"></div>
            <button class="btn" id="e-preview">👁 PREVIEW</button>
            <button class="btn gold" id="e-bulk">⚡ BULK ADD</button>
            <button class="btn go" id="e-launch">▶ LAUNCH</button>
        </div>
        <div class="ed-body">
            <aside class="ed-list">
                <div class="ed-list-head"><span class="label" id="e-count"></span><span class="label" id="e-issues"></span></div>
                <div class="ed-cards" id="e-cards"></div>
                <div class="ed-adds">
                    <button class="btn" data-add="mc">+ MULTIPLE CHOICE</button>
                    <button class="btn" data-add="tf">+ TRUE / FALSE</button>
                </div>
            </aside>
            <main class="ed-main" id="e-main"></main>
        </div>
    </div>`;

    const status = (t, cls = '') => { const s = document.getElementById('e-status'); if (s) { s.textContent = t; s.className = 'ed-status ' + cls; } };
    const save = async () => {
        clearTimeout(E.timer); E.timer = null;
        if (!E.dirty) return;
        E.dirty = false; E.saving = true;
        status('Saving…');
        try {
            const out = await saveSet(user.uid, {
                ...E.set, title: E.set.title.trim() || 'Untitled BattleSet',
                questions: E.set.questions.filter(q => q.text.trim() || q.answers.some(a => a.trim())).map(q => ({ ...q, answers: q.type === 'tf' ? q.answers : q.answers.map(a => a.trim()) }))
            });
            E.set.created = out.created; E.saved = true;
            status('All changes saved ✓', 'ok');
        } catch (e) { E.dirty = true; status('Not saved, retrying…', 'bad'); E.timer = setTimeout(save, 3000); }
        E.saving = false;
    };
    const changed = () => { E.dirty = true; status('Editing…'); clearTimeout(E.timer); E.timer = setTimeout(save, 900); };
    window.__rrEditorCleanup = save; // flush when leaving the page
    window.onbeforeunload = () => (E.dirty ? 'Changes are still saving' : undefined);
    status(E.saved ? 'All changes saved ✓' : 'Not saved yet', E.saved ? 'ok' : '');

    // ------------------------------------------------ list
    const drawList = () => {
        const qs = E.set.questions;
        const bad = qs.filter(q => questionIssues(q).length).length;
        document.getElementById('e-count').textContent = `${qs.length} QUESTION${qs.length === 1 ? '' : 'S'}`;
        document.getElementById('e-issues').innerHTML = bad ? `<span style="color:#ff6b81">⚠ ${bad} TO FIX</span>` : '<span style="color:#2ed573">✓ ALL GOOD</span>';
        document.getElementById('e-cards').innerHTML = qs.map((q, i) => cardHtml(q, i, i === E.sel)).join('');
    };
    const cardHtml = (q, i, on) => {
        const issues = questionIssues(q);
        const ans = q.answers[q.correct] || '';
        return `<button class="ed-card ${on ? 'on' : ''}" data-i="${i}">
            <span class="ed-num">${i + 1}</span>
            <span class="ed-card-body"><span class="ed-card-q">${esc(q.text) || '<i class="muted">Empty question</i>'}</span>
            <span class="ed-card-a">${q.type === 'tf' ? 'T/F · ' : ''}✓ ${esc(ans) || '—'}</span></span>
            ${issues.length ? '<span class="ed-dot" title="' + esc(issues.join(', ')) + '">!</span>' : ''}
        </button>`;
    };
    const refreshCard = i => {
        const el = document.querySelector(`.ed-card[data-i="${i}"]`);
        if (el) el.outerHTML = cardHtml(E.set.questions[i], i, i === E.sel);
        const qs = E.set.questions, bad = qs.filter(q => questionIssues(q).length).length;
        document.getElementById('e-issues').innerHTML = bad ? `<span style="color:#ff6b81">⚠ ${bad} TO FIX</span>` : '<span style="color:#2ed573">✓ ALL GOOD</span>';
    };

    // ------------------------------------------------ question editor
    const drawMain = (focus = 'text') => {
        const q = E.set.questions[E.sel];
        const main = document.getElementById('e-main');
        if (!q) { main.innerHTML = ''; return; }
        main.innerHTML = `
        <div class="qe">
            <div class="qe-head">
                <div class="qe-num">QUESTION ${E.sel + 1}</div>
                <div class="seg qe-type"><button data-type="mc" class="${q.type !== 'tf' ? 'on' : ''}">MULTIPLE CHOICE</button><button data-type="tf" class="${q.type === 'tf' ? 'on' : ''}">TRUE / FALSE</button></div>
            </div>
            <textarea class="qe-text" id="q-text" rows="2" placeholder="${q.type === 'tf' ? 'Type a statement, e.g. The Nile is the longest river in Africa.' : 'Type your question, e.g. Which river was essential to Ancient Egypt?'}">${esc(q.text)}</textarea>
            ${q.type === 'tf'
                ? `<div class="label">WHICH IS CORRECT?</div><div class="qe-tf">${['TRUE', 'FALSE'].map((t, k) => `<button class="qe-tf-btn ${q.correct === k ? 'on' : ''}" data-tf="${k}">${k === 0 ? '✓' : '✗'} ${t}</button>`).join('')}</div>`
                : `<div class="label">ANSWERS <span class="muted" style="letter-spacing:0;text-transform:none">· click ✓ to mark the right one · blank answers are skipped</span></div>
                   <div class="qe-answers">${q.answers.map((a, k) => `
                    <div class="qe-ans ${q.correct === k ? 'right' : ''}">
                        <span class="qe-letter">${LETTERS[k]}</span>
                        <input class="qe-input" data-k="${k}" value="${esc(a)}" placeholder="${q.correct === k ? 'Correct answer' : 'Wrong answer' + (k > 1 ? ' (optional)' : '')}" maxlength="120">
                        <button class="qe-mark" data-mark="${k}" title="Mark as correct">${q.correct === k ? '✓ CORRECT' : '✓'}</button>
                    </div>`).join('')}</div>`}
            <div class="qe-issues" id="q-issues"></div>
            <div class="qe-foot">
                <button class="btn ghost" data-op="up" ${E.sel === 0 ? 'disabled' : ''}>↑</button>
                <button class="btn ghost" data-op="down" ${E.sel === E.set.questions.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="btn ghost" data-op="dup">⧉ DUPLICATE</button>
                <button class="btn ghost danger" data-op="del">🗑 DELETE</button>
                <span class="grow"></span>
                <span class="muted qe-hint">Enter = next box · Ctrl+Enter = new question</span>
                <button class="btn primary" data-op="next">${E.sel === E.set.questions.length - 1 ? '+ NEXT QUESTION' : 'NEXT →'}</button>
            </div>
        </div>`;
        const issues = () => { const list = questionIssues(q); document.getElementById('q-issues').innerHTML = list.map(t => `<span class="chip" style="color:#ff6b81">⚠ ${esc(t)}</span>`).join(''); };
        issues();
        const ta = document.getElementById('q-text');
        const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
        grow();
        ta.oninput = () => { q.text = ta.value; grow(); refreshCard(E.sel); issues(); changed(); };
        ta.onkeydown = e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addQuestion(q.type); return; }
            if (e.key === 'Enter') { e.preventDefault(); const f = main.querySelector('.qe-input') || main.querySelector('.qe-tf-btn'); f && f.focus(); }
        };
        main.querySelectorAll('.qe-input').forEach(inp => {
            inp.oninput = () => { q.answers[+inp.dataset.k] = inp.value; refreshCard(E.sel); issues(); changed(); };
            inp.onkeydown = e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addQuestion(q.type); return; }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const next = main.querySelector(`.qe-input[data-k="${+inp.dataset.k + 1}"]`);
                    if (next) next.focus(); else addQuestion(q.type);
                }
            };
        });
        main.onclick = e => {
            const t = e.target.closest('button');
            if (!t) return;
            if (t.dataset.type && t.dataset.type !== q.type) {
                const nq = blank(t.dataset.type);
                nq.text = q.text;
                E.set.questions[E.sel] = nq;
                changed(); drawList(); drawMain();
            } else if (t.dataset.mark !== undefined) {
                q.correct = +t.dataset.mark; changed(); refreshCard(E.sel); drawMain('keep');
            } else if (t.dataset.tf !== undefined) {
                q.correct = +t.dataset.tf; changed(); refreshCard(E.sel); drawMain('keep');
            } else if (t.dataset.op) op(t.dataset.op);
        };
        if (focus === 'text') ta.focus();
    };

    const select = i => { E.sel = Math.max(0, Math.min(E.set.questions.length - 1, i)); drawList(); drawMain(); };
    const addQuestion = type => {
        const cur = E.set.questions[E.sel];
        const nq = blank(type || 'mc');
        E.set.questions.splice(E.sel + 1, 0, nq);
        if (cur && !cur.text.trim() && !cur.answers.some(a => a.trim() && a !== 'True' && a !== 'False')) E.set.questions.splice(E.sel, 1); else E.sel++;
        changed(); drawList(); drawMain();
        document.querySelector('.ed-card.on')?.scrollIntoView({ block: 'nearest' });
    };
    const op = name => {
        const qs = E.set.questions, i = E.sel;
        if (name === 'up' && i > 0) { [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; E.sel--; }
        if (name === 'down' && i < qs.length - 1) { [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]]; E.sel++; }
        if (name === 'dup') { qs.splice(i + 1, 0, JSON.parse(JSON.stringify(qs[i]))); E.sel++; }
        if (name === 'del') {
            if ((qs[i].text.trim()) && !confirm('Delete this question?')) return;
            qs.splice(i, 1);
            if (!qs.length) qs.push(blank());
            E.sel = Math.min(i, qs.length - 1);
        }
        if (name === 'next') { if (i === qs.length - 1) return addQuestion(qs[i].type); E.sel++; }
        changed(); drawList(); drawMain();
    };

    document.getElementById('e-cards').onclick = e => { const c = e.target.closest('.ed-card'); if (c) select(+c.dataset.i); };
    document.querySelector('.ed-adds').onclick = e => { const t = e.target.dataset?.add; if (t) { E.sel = E.set.questions.length - 1; addQuestion(t); } };
    document.getElementById('e-title').oninput = e => { E.set.title = e.target.value; changed(); };
    document.getElementById('e-subject').oninput = e => { E.set.subject = e.target.value; changed(); };
    document.getElementById('e-bulk').onclick = () => openBulk(E, () => { changed(); drawList(); drawMain(); });
    document.getElementById('e-preview').onclick = () => openPreview(E.set.questions.filter(q => !questionIssues(q).length));
    document.getElementById('e-launch').onclick = async () => {
        const good = E.set.questions.filter(q => !questionIssues(q).length);
        if (!good.length) return toast('Add at least one finished question first');
        if (good.length < E.set.questions.length && !confirm(`${E.set.questions.length - good.length} question(s) still need fixing and will be left out. Launch anyway?`)) return;
        E.dirty = true; await save();
        openLaunch({ ...E.set, title: E.set.title.trim() || 'Untitled BattleSet', questions: good });
    };

    drawList();
    drawMain(id ? 'none' : 'title');
    if (!id) document.getElementById('e-title').focus();
}

// ================================================================= bulk add

const EXAMPLES = {
    raid: 'Which river was essential to Ancient Egypt? | Nile | Amazon | Tigris | Danube\nWho was the boy pharaoh? | Tutankhamun | Ramses II | Khufu\nT/F: The pyramids were built as tombs | true',
    pairs: 'Pharaoh\tKing of Ancient Egypt\nPapyrus\tPlant used to make paper\nMummy\tPreserved body\nHieroglyphics\tEgyptian picture writing',
    csv: 'question,correct,wrong1,wrong2,wrong3\nWhat is 7 x 8?,56,54,48,64'
};

function openBulk(E, done) {
    const m = document.getElementById('auth');
    m.innerHTML = `<div class="modal-box xwide bulk">
        <button class="modal-x" id="b-x">×</button>
        <div class="modal-title">⚡ BULK ADD QUESTIONS</div>
        <div class="bulk-grid">
            <div class="stack">
                <div class="seg" id="b-fmt">${[['auto', 'AUTO-DETECT'], ['raid', 'Q | ANSWERS'], ['pairs', 'TERM → DEFINITION'], ['csv', 'CSV']].map(([k, l]) => `<button data-f="${k}" class="${k === 'auto' ? 'on' : ''}">${l}</button>`).join('')}</div>
                <textarea class="bulk-text" id="b-text" placeholder="Paste your questions here, one per line…"></textarea>
                <div class="row" style="flex-wrap:wrap">
                    <label class="btn ghost">📄 UPLOAD CSV / TXT<input type="file" id="b-file" accept=".csv,.txt,.tsv" hidden></label>
                    <span class="muted" style="font-size:.9rem">Quizlet: Export your set, copy, and paste it here.</span>
                </div>
                <div class="bulk-help">
                    <div><b>Q | ANSWERS</b>: question, then the correct answer, then up to 3 wrong ones. <button class="linkish" data-ex="raid">Try example</button>
                    <code>Who was the boy pharaoh? | Tutankhamun | Ramses II | Khufu</code><code>T/F: The pyramids were tombs | true</code></div>
                    <div><b>TERM → DEFINITION</b>: vocab lists (tab or " - " between). We write the wrong answers for you from your other definitions. <button class="linkish" data-ex="pairs">Try example</button></div>
                    <div><b>CSV</b>: columns question, correct, wrong1, wrong2, wrong3 (from Google Sheets or Excel). <button class="linkish" data-ex="csv">Try example</button></div>
                </div>
            </div>
            <div class="bulk-preview">
                <div class="row" style="justify-content:space-between"><div class="label">PREVIEW</div><div class="seg sm" id="b-ask" hidden><button data-a="definition" class="on">ASK THE TERM</button><button data-a="term">ASK THE DEFINITION</button></div></div>
                <div id="b-summary" class="bulk-summary muted">Paste something to see a preview.</div>
                <div id="b-list" class="bulk-list"></div>
            </div>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="b-cancel">CANCEL</button><button class="btn go big" id="b-add" disabled>ADD QUESTIONS</button></div>
    </div>`;
    m.hidden = false;
    let fmt = 'auto', ask = 'definition', result = { questions: [], errors: [] }, t = null;
    const text = document.getElementById('b-text');
    const update = () => {
        result = parseBulk(text.value, { format: fmt, ask });
        document.getElementById('b-ask').hidden = result.format !== 'pairs';
        const n = result.questions.length, bad = result.errors.length;
        document.getElementById('b-summary').innerHTML = text.value.trim()
            ? `<b style="color:#2ed573">✓ ${n} question${n === 1 ? '' : 's'} ready</b>${bad ? ` · <b style="color:#ff6b81">⚠ ${bad} line${bad === 1 ? '' : 's'} skipped</b>` : ''} <span class="muted">· read as ${{ raid: 'Q | answers', pairs: 'term → definition', csv: 'CSV' }[result.format] || '—'}</span>`
            : 'Paste something to see a preview.';
        document.getElementById('b-list').innerHTML =
            result.errors.slice(0, 6).map(e => `<div class="bulk-err">Line ${e.line}: ${esc(e.error)}${e.text ? `<code>${esc(e.text.slice(0, 80))}</code>` : ''}</div>`).join('')
            + result.questions.slice(0, 40).map((q, i) => `<div class="bulk-q"><b>${i + 1}.</b> ${esc(q.text)}<div>${q.answers.map((a, k) => `<span class="${k === q.correct ? 'ok' : ''}">${k === q.correct ? '✓ ' : ''}${esc(a)}</span>`).join('')}</div></div>`).join('');
        const add = document.getElementById('b-add');
        add.disabled = !n;
        add.textContent = n ? `ADD ${n} QUESTION${n === 1 ? '' : 'S'}` : 'ADD QUESTIONS';
    };
    text.oninput = () => { clearTimeout(t); t = setTimeout(update, 200); };
    text.focus();
    document.getElementById('b-fmt').onclick = e => { const f = e.target.dataset?.f; if (!f) return; fmt = f; e.currentTarget.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.f === f)); update(); };
    document.getElementById('b-ask').onclick = e => { const a = e.target.dataset?.a; if (!a) return; ask = a; e.currentTarget.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.a === a)); update(); };
    document.getElementById('b-file').onchange = async e => { const f = e.target.files[0]; if (f) { text.value = await f.text(); update(); } };
    m.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { text.value = EXAMPLES[b.dataset.ex]; update(); });
    const close = () => { m.hidden = true; };
    document.getElementById('b-x').onclick = close;
    document.getElementById('b-cancel').onclick = close;
    m.onclick = e => { if (e.target === m) close(); };
    document.getElementById('b-add').onclick = () => {
        const add = result.questions.map(q => ({ ...q, answers: q.type === 'tf' ? q.answers : [...q.answers, '', '', '', ''].slice(0, 4) }));
        const qs = E.set.questions;
        if (qs.length === 1 && !qs[0].text.trim()) qs.splice(0, 1);
        const at = qs.length;
        qs.push(...add);
        E.sel = at;
        close();
        done();
        toast(`Added ${add.length} questions`);
    };
}

// ================================================================= preview (what students see)

function openPreview(questions) {
    questions = questions.map(q => { const right = q.answers[q.correct]; const answers = q.answers.filter(a => a.trim()); return { ...q, answers, correct: answers.indexOf(right) }; });
    if (!questions.length) return toast('Nothing to preview yet: finish a question first');
    const m = document.getElementById('auth');
    let i = 0, cls = 'WARRIOR', picked = null;
    const draw = () => {
        const q = questions[i];
        m.innerHTML = `<div class="modal-box xwide">
            <button class="modal-x" id="p-x">×</button>
            <div class="row" style="justify-content:space-between;margin-bottom:10px;padding-right:44px">
                <div class="label">STUDENT PREVIEW · ${i + 1} / ${questions.length}</div>
                <div class="row" style="gap:6px">${CLASS_IDS.map(c => `<button class="pv-cls ${c === cls ? 'on' : ''}" data-c="${c}" title="${CLASSES[c].name}">${crest(c, { size: 30 })}</button>`).join('')}</div>
            </div>
            <div class="sg-lite" data-cls="${cls}">
                <div class="qbox"><div class="label">ANSWER TO ATTACK</div><div class="qt">${esc(q.text)}</div></div>
                <div class="answers ${q.answers.length === 2 ? 'two' : ''} ${picked !== null ? 'locked' : ''}" style="margin-top:10px">${q.answers.map((a, k) => `<button class="answer ${picked !== null && k === q.correct ? 'right' : ''} ${picked === k && k !== q.correct ? 'wrong' : ''}" data-k="${k}"><span class="ak">${LETTERS[k]}</span><span class="at">${esc(a)}</span></button>`).join('')}</div>
            </div>
            <div class="row" style="justify-content:space-between;margin-top:14px">
                <button class="btn" id="p-prev" ${i ? '' : 'disabled'}>← PREV</button>
                <span class="muted">Answers are shuffled for students. Click one to test it.</span>
                <button class="btn primary" id="p-next" ${i < questions.length - 1 ? '' : 'disabled'}>NEXT →</button>
            </div></div>`;
        m.onclick = e => {
            if (e.target === m || e.target.id === 'p-x') { m.hidden = true; return; }
            const c = e.target.closest('[data-c]'); if (c) { cls = c.dataset.c; draw(); return; }
            const a = e.target.closest('[data-k]'); if (a && picked === null) { picked = +a.dataset.k; draw(); return; }
            if (e.target.id === 'p-prev') { i--; picked = null; draw(); }
            if (e.target.id === 'p-next') { i++; picked = null; draw(); }
        };
    };
    m.hidden = false;
    draw();
}
