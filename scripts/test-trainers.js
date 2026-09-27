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
            textContent: '', innerHTML: '', disabled: false, children: [],
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
console.log('TRAINERS_TEST=PASS: scoring, empty input, transliteration, variants, review gate, local progress and analytics privacy');
