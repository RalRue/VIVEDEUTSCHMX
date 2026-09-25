const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const boundary = source.indexOf('// ===== LIGHTWEIGHT GA4 CLICK TRACKING =====');
assert.ok(boundary > 0, 'Contact-link section must be present');

const links = ['A1', 'A2', 'B1'].map(level => ({dataset: {level}, href: ''}));
const document = {
    documentElement: {lang: ''},
    querySelectorAll(selector) {
        return selector === '.group-email-link' ? links : [];
    },
};
const context = vm.createContext({
    document,
    localStorage: {getItem: () => null, setItem: () => {}},
    translations: {es: {}, en: {}, de: {}},
});
vm.runInContext(source.slice(0, boundary), context);

for (const [lang, expectedPhrase] of [
    ['es', 'Mi nivel actual'],
    ['en', 'My current level'],
    ['de', 'Mein aktuelles Niveau'],
]) {
    vm.runInContext(`setLanguage(${JSON.stringify(lang)}); updateContactLinks();`, context);
    assert.equal(document.documentElement.lang, lang);

    for (const link of links) {
        const url = new URL(link.href);
        assert.equal(url.protocol, 'mailto:');
        assert.equal(url.pathname, 'ralph_stoecker@live.com');
        assert.equal(url.searchParams.get('subject'), `Consulta grupo ${link.dataset.level} - VIVE DEUTSCH MX`);
        const body = url.searchParams.get('body');
        assert.ok(body.includes(link.dataset.level));
        assert.ok(body.includes(expectedPhrase));
        assert.ok(body.includes('\n'));
        assert.ok(!body.includes('4,800') && !body.includes('4.800'));
    }
}

console.log('Group inquiry mailto links passed for A1/A2/B1 in ES/EN/DE.');
