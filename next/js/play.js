// play.html entry: host when ?host=1, student otherwise.
//   play.html?host=1                 teacher (questions handed over by the dashboard via localStorage)
//   play.html?room=123456&name=Ana   student auto-join
//   play.html                        student join form

import { waitForTeacher } from './firebase.js';
import { normalizeSet, DEMO_QUESTIONS } from './content/questions.js';
import { mount, esc } from './ui.js';

const params = new URLSearchParams(location.search);

function readLaunch() {
    try {
        const raw = localStorage.getItem('rr_launch_questions');
        if (!raw) return null;
        const questions = normalizeSet(JSON.parse(raw));
        return questions.length ? { questions, title: localStorage.getItem('rr_launch_set_title') || 'Raid Review' } : null;
    } catch (e) { return null; }
}

async function host() {
    const launch = readLaunch();
    const teacher = await waitForTeacher(3000);
    const go = async ({ questions, title }) => {
        try { localStorage.removeItem('rr_launch_questions'); localStorage.removeItem('rr_launch_set_title'); } catch (e) { /* ignore */ }
        const { startHost } = await import('./host/host.js');
        startHost({ questions, title, hostUid: teacher ? teacher.uid : null });
    };
    if (launch && teacher) return go(launch);
    mount(`<div class="screen center"><div class="stack" style="width:min(520px,100%)">
        <div class="display" style="font-size:1.8rem">HOST A RAID</div>
        <div class="muted">${teacher ? 'No question set was selected.' : 'Sign in on the dashboard to launch a raid with your own questions.'}</div>
        <a class="btn primary big" href="index.html">GO TO DASHBOARD</a>
        <button class="btn gold big" id="demo">TRY A DEMO RAID (ANCIENT EGYPT)</button>
    </div></div>`);
    document.getElementById('demo').onclick = () => go(launch || { questions: normalizeSet(DEMO_QUESTIONS), title: 'Ancient Egypt (Demo)' });
}

async function student() {
    const { startStudent } = await import('./student/student.js');
    startStudent({ name: params.get('name') || '', room: params.get('room') || '' });
}

(params.get('host') === '1' ? host() : student()).catch(err => {
    console.error(err);
    mount(`<div class="screen center"><div class="display" style="font-size:1.4rem">SOMETHING WENT WRONG</div><div class="muted">${esc(err.message || err)}</div><button class="btn" onclick="location.reload()">TRY AGAIN</button></div>`);
});
