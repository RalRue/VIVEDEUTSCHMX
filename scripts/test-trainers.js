const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function inlineScript(file) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
}

function setup(file, saved = null) {
    const nodes = new Map();
    const events = [];
    function node(id) {
        if (!nodes.has(id)) nodes.set(id, {
            value: ({direction: 'es-de', mode: 'type'})[id] || 'all',
            textContent: '', innerHTML: '', disabled: false, children: [], style: {},
            addEventListener() {}, setAttribute() {}, focus() {},
            appendChild(child) { this.children.push(child); }
        });
        return nodes.get(id);
    }
    const context = vm.createContext({
        document: {
            getElementById: node,
            createElement: () => ({addEventListener() {}, setAttribute() {}}),
            querySelectorAll: () => []
        },
        window: {location: {search: ''}, gtag: (...args) => events.push(args)},
        localStorage: {getItem: () => saved, setItem() {}},
        URLSearchParams,
        navigator: {clipboard: {writeText: async () => {}}}
    });
    vm.runInContext(inlineScript(file), context);
    return {nodes, events, run: source => vm.runInContext(source, context)};
}

assert.equal(inlineScript('vokabeltrainer.html'), inlineScript('vokabeltrainer/index.html'));
assert.equal(inlineScript('deutsch-fehlertrainer.html'), inlineScript('deutsch-fehlertrainer/index.html'));

const vocab = setup('vokabeltrainer/index.html');
vocab.run('answerInput.value = ""; checkAnswer();');
assert.equal(vocab.run('stats.done'), 0, 'Empty answer must not count');
vocab.run('current = {de: "ändern", es: "cambiar"}; answerInput.value = "aendern"; checkAnswer(); checkAnswer();');
assert.equal(vocab.run('stats.done'), 1, 'Repeat checking must not count twice');
assert.equal(vocab.run('stats.right'), 1, 'Umlaut transliteration should be accepted');
vocab.run('nextCard(); currentDirection = "de-es"; current = {de: "fahren", es: "conducir / ir en vehículo"}; answerInput.value = "conducir"; checkAnswer();');
assert.equal(vocab.run('stats.right'), 2, 'Either listed translation should be accepted');
vocab.run('modeSelect.value = "flashcard"; nextCard(); checkAnswer(); checkAnswer();');
assert.equal(vocab.run('stats.done'), 3, 'Revealing a flashcard must count only once');
assert.equal(vocab.nodes.get('accuracy').textContent, '100%', 'Unassessed flashcards must not reduce accuracy');
vocab.run('categorySelect.value = "missing"; nextCard(); checkAnswer();');
assert.equal(vocab.nodes.get('checkBtn').disabled, true);
assert.equal(vocab.run('stats.done'), 3);

const errors = setup('deutsch-fehlertrainer/index.html', '{broken');
assert.equal(errors.run('state.stats.done'), 0, 'Corrupt local progress must not break the trainer');
errors.run('checkAnswer();');
assert.equal(errors.run('state.stats.done'), 0);
errors.run('state.selected = currentExercise().correct; checkAnswer(); checkAnswer();');
assert.equal(errors.run('state.stats.done'), 1);
assert.equal(errors.run('state.stats.correct'), 1);
errors.run('exercises.push({id:"UNREVIEWED",status:"pedagogical_review",level:"A1"}); applyFilter();');
assert.equal(errors.run('state.filtered.some(item => item.id === "UNREVIEWED")'), false);
for (const level of ['A1', 'A2', 'B1']) {
    errors.run('levelFilter.value = ' + JSON.stringify(level) + '; applyFilter();');
    assert.ok(errors.run('state.filtered.length') > 0);
}
assert.ok(!errors.events.some(event => /answer_correct|\"correct\"/.test(JSON.stringify(event))), 'Scores must stay out of analytics');
const blockedStorage = setup('deutsch-fehlertrainer/index.html');
blockedStorage.run('localStorage.setItem = () => { throw new Error("QuotaExceededError"); };');
const feedbackBefore = blockedStorage.run('feedback.innerHTML');
assert.doesNotThrow(() => blockedStorage.run('state.selected = currentExercise().correct; checkAnswer();'));
assert.equal(blockedStorage.run('state.stats.correct'), 1);
assert.notEqual(blockedStorage.run('feedback.innerHTML'), feedbackBefore);
assert.equal(blockedStorage.run('checkAnswerButton.disabled'), true);
blockedStorage.run('checkAnswer();');
assert.equal(blockedStorage.run('state.stats.done'), 1, 'Storage failure must not permit double counting');
console.log('TRAINERS_TEST=PASS: scoring, empty input, transliteration, variants, review gate, local progress and analytics privacy');

const expanded = setup('deutsch-fehlertrainer/index.html');
assert.equal(expanded.run('exercises.length'), 53);
assert.equal(expanded.run("exercises.filter(e => e.kind === 'practice').length"), 30);
assert.equal(expanded.run('new Set(exercises.map(e => e.id)).size'), 53);
expanded.run('showExplanation(); state.selected = currentExercise().correct; checkAnswer();');
assert.equal(expanded.run('state.stats.done'), 0, 'Revealed answers must not count');
for (let index = 0; index < 53; index++) {
    expanded.run(`resetSession(); state.index = ${index}; renderExercise(); state.selected = currentExercise().correct; checkAnswer(); checkAnswer();`);
    assert.equal(expanded.run('session.correct'), 1, 'Every published answer key must score once');
    assert.equal(expanded.run('state.stats.done'), index + 1);
    assert.ok(expanded.run('feedback.innerHTML.includes(currentExercise().explanation)'));
}
expanded.run('kindFilter.value = "practice"; applyFilter();');
assert.equal(expanded.run('state.filtered.length'), 30);
expanded.run('kindFilter.value = "card"; applyFilter();');
assert.equal(expanded.run('state.filtered.length'), 23);
expanded.run('topicFilter.value = "missing"; applyFilter(); checkAnswer(); showExplanation(); nextExercise();');
assert.equal(expanded.run('state.filtered.length'), 0);
assert.equal(expanded.run('checkAnswerButton.disabled'), true);
assert.equal(expanded.events.length, 0, 'Learner interactions stay out of analytics');
console.log('EXPANDED_TRAINER_TEST=PASS: 23 cards, 30 supplementary tasks, 53 stable IDs and answer keys, reveal lock, filters, empty combinations, no learner analytics');

const filteredResult = setup('deutsch-fehlertrainer/index.html');
filteredResult.run('levelFilter.value = "A1"; applyFilter(); state.selected = currentExercise().correct; checkAnswer();');
assert.match(filteredResult.run('resultText()'), /Filtro de práctica: A1.*En esta sesión: 1\/1/);
filteredResult.run('levelFilter.value = "B1"; applyFilter();');
assert.equal(filteredResult.run('state.stats.done'), 1, 'Historical progress must remain available');
assert.match(filteredResult.run('resultText()'), /no tengo resultado de esta sesión/);
assert.doesNotMatch(filteredResult.run('resultText()'), /1\/1|Nivel:/, 'A previous A1 answer must not become a B1 result');
assert.match(filteredResult.nodes.get('conversion-summary').textContent, /Llevas 0\/3/);
filteredResult.run('state.selected = currentExercise().correct; checkAnswer();');
assert.match(filteredResult.run('resultText()'), /Filtro de práctica: B1.*En esta sesión: 1\/1/);
filteredResult.run('resetSession(); renderExercise();');
assert.match(filteredResult.run('resultText()'), /no tengo resultado de esta sesión/);
console.log('TRAINER_RESULT_SCOPE_TEST=PASS: current session and practice filter never relabel historical answers as a level result');
