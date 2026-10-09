import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulk, parseRaidLine, detectFormat, splitCsv, questionIssues } from '../next/js/teacher/importer.js';

const rng = () => 0.42;

test('raid format: question | correct | wrongs', () => {
    const q = parseRaidLine('Capital of France? | Paris | Rome | Madrid | Berlin');
    assert.deepEqual(q, { text: 'Capital of France?', answers: ['Paris', 'Rome', 'Madrid', 'Berlin'], correct: 0, type: 'mc' });
});

test('raid format: true/false two ways', () => {
    assert.deepEqual(parseRaidLine('T/F: The sun is a star | true'), { text: 'The sun is a star', answers: ['True', 'False'], correct: 0, type: 'tf' });
    assert.equal(parseRaidLine('Water boils at 50°C | false').correct, 1);
});

test('raid format explains what is wrong with a bad line', () => {
    assert.match(parseRaidLine('No pipes here').error, /\|/);
    assert.match(parseRaidLine('Q? | A').error, /wrong answer/);
    assert.match(parseRaidLine('Q? | A | A').error, /same/);
    assert.match(parseRaidLine('T/F: thing | maybe').error, /true or false/);
});

test('quizlet-style tab pairs become multiple choice with other definitions as wrong answers', () => {
    const text = 'Mitochondria\tPowerhouse of the cell\nNucleus\tHolds the DNA\nRibosome\tMakes proteins\nCell wall\tRigid outer layer in plants';
    const r = parseBulk(text, { rng });
    assert.equal(r.format, 'pairs');
    assert.equal(r.questions.length, 4);
    const q = r.questions[0];
    assert.equal(q.text, 'What is "Mitochondria"?');
    assert.equal(q.answers[q.correct], 'Powerhouse of the cell');
    assert.equal(q.answers.length, 4);
    assert.ok(!q.answers.slice(1).includes('Powerhouse of the cell'));
});

test('dash-separated pairs are detected too', () => {
    const r = parseBulk('Nile - river in Egypt\nRa - sun god\nAnubis - god of the dead', { rng });
    assert.equal(r.format, 'pairs');
    assert.equal(r.questions.length, 3);
});

test('csv with a header row and quoted commas', () => {
    const text = 'question,correct,wrong1,wrong2,wrong3\n"Who said ""Veni, vidi, vici""?",Caesar,Nero,Augustus,Brutus\n2+2,4,3,5,';
    const r = parseBulk(text, { rng });
    assert.equal(r.format, 'csv');
    assert.equal(r.questions.length, 2);
    assert.equal(r.questions[0].text, 'Who said "Veni, vidi, vici"?');
    assert.deepEqual(r.questions[1].answers, ['4', '3', '5']);
});

test('format detection', () => {
    assert.equal(detectFormat('a | b | c'), 'raid');
    assert.equal(detectFormat('a\tb\nc\td'), 'pairs');
    assert.equal(detectFormat(''), 'empty');
    assert.deepEqual(splitCsv('a,"b, c",d'), ['a', 'b, c', 'd']);
});

test('errors carry line numbers', () => {
    const r = parseBulk('Good? | yes | no\nbad line\nAlso good? | a | b', { format: 'raid' });
    assert.equal(r.questions.length, 2);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].line, 2);
});

test('question issues for the editor', () => {
    assert.deepEqual(questionIssues({ text: 'Q', answers: ['A', 'B', '', ''], correct: 0, type: 'mc' }), []);
    assert.ok(questionIssues({ text: '', answers: ['A', 'B'], correct: 0, type: 'mc' }).includes('Question is empty'));
    assert.ok(questionIssues({ text: 'Q', answers: ['', 'B', '', ''], correct: 0, type: 'mc' }).includes('The correct answer is blank'));
    assert.ok(questionIssues({ text: 'Q', answers: ['B', 'b', '', ''], correct: 0, type: 'mc' }).includes('Two answers are the same'));
});
