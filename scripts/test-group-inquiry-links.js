const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const boundary = source.indexOf('// ===== LIGHTWEIGHT GA4 CLICK TRACKING =====');
assert.ok(boundary > 0, 'Contact-link section must be present');

for (const search of ['', '?utm_source=instagram&utm_medium=paid_social&utm_campaign=vive_a1_cafe_microtest_202610&utm_content=cafe_cards_v1&email=private%40example.test', '?utm_campaign=unapproved&unknown=value']) {
const links = ['A1', 'A2', 'B1'].map(level => ({dataset: {level}, href: ''}));
const document = {
    documentElement: {lang: ''},
    querySelectorAll(selector) {
        return selector === '.group-inquiry-link' ? links : [];
    },
};
const context = vm.createContext({
    document, URL, URLSearchParams,
    window: {location: new URL('https://vive-deutsch-mx.vercel.app/' + search)},
    localStorage: {getItem: () => null, setItem: () => {}},
    translations: {es: {}, en: {}, de: {}},
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'attribution.js'), 'utf8'), context);
vm.runInContext(source.slice(0, boundary), context);

for (const lang of ['es', 'en', 'de']) {
    vm.runInContext(`setLanguage(${JSON.stringify(lang)}); updateContactLinks();`, context);
    assert.equal(document.documentElement.lang, lang);

    for (const link of links) {
        const url = new URL(link.href);
        assert.equal(url.protocol, 'https:');
        assert.equal(url.hostname, 'vive-deutsch-mx.vercel.app');
        assert.equal(url.pathname, '/consulta/');
        const approved = search.includes('vive_a1_cafe_microtest_202610');
        assert.equal(url.searchParams.get('utm_campaign'), approved ? 'vive_a1_cafe_microtest_202610' : null);
        assert.equal(url.searchParams.get('utm_content'), approved ? 'cafe_cards_v1' : null);
        assert.equal(url.searchParams.has('email'), false);
        assert.equal(url.searchParams.has('unknown'), false);
        if (!approved) assert.equal(url.search, '');
    }
}

}

console.log('Group inquiry form links passed for A1/A2/B1 in ES/EN/DE.');
