const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const boundary = source.indexOf('// ===== LIGHTWEIGHT GA4 CLICK TRACKING =====');
assert.ok(boundary > 0, 'Contact-link section must be present');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const groupTags = [...html.matchAll(/<a\b[^>]*\bclass="[^"]*\bgroup-inquiry-link\b[^"]*"[^>]*>/g)].map(match => match[0]);
assert.equal(groupTags.length, 4, 'Check every existing group CTA, including the booking CTA');
for (const tag of groupTags) {
    const level = tag.match(/\bdata-level="([^"]*)"/)[1];
    const href = new URL(tag.match(/\bhref="([^"]*)"/)[1]);
    assert.ok(['A1', 'A2', 'B1'].includes(level));
    assert.equal(href.origin + href.pathname, 'https://vive-deutsch-mx.vercel.app/consulta/');
    assert.deepEqual([...href.searchParams], [['course', level]], 'Static links must retain their course before JavaScript runs');
}

let checked = 0;
for (const search of ['', '?utm_source=instagram&utm_medium=paid_social&utm_campaign=vive_a1_cafe_microtest_202610&utm_content=cafe_cards_v1&email=private%40example.test', '?utm_campaign=unapproved&unknown=value', '?course=B1&course=A2&inquiryId=private&token=private&submissionId=private#placementToken=private', '?utm_source=instagram&utm_medium=profile&utm_campaign=profile_link']) {
const links = ['A1', 'A2', 'B1', undefined, 'B2', 'C1', 'a1', '', 'A1 A2'].map(level => ({dataset: level === undefined ? {} : {level}, href: ''}));
const neutral = {href: 'https://vive-deutsch-mx.vercel.app/consulta/', getAttribute(){return this.href;}};
const document = {
    documentElement: {lang: ''},
    querySelectorAll(selector) {
        return selector === '.group-inquiry-link' ? links : selector === 'a[href]' ? [neutral] : [];
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
        const course = ['A1', 'A2', 'B1'].includes(link.dataset.level) ? link.dataset.level : null;
        assert.equal(url.searchParams.get('course'), course);
        assert.equal(url.searchParams.getAll('course').length, course === null ? 0 : 1);
        const approved = search.includes('vive_a1_cafe_microtest_202610');
        assert.equal(url.searchParams.get('utm_campaign'), approved ? 'vive_a1_cafe_microtest_202610' : null);
        assert.equal(url.searchParams.get('utm_content'), approved ? 'cafe_cards_v1' : null);
        assert.equal(url.searchParams.has('email'), false);
        assert.equal(url.searchParams.has('unknown'), false);
        for (const key of ['inquiryId', 'token', 'placementToken', 'submissionId']) assert.equal(url.searchParams.has(key), false);
        assert.equal(url.hash, '');
        const actualAttribution = new URLSearchParams(url.search);
        actualAttribution.delete('course');
        const expectedAttribution = context.viveSafeAttribution(search).toString();
        assert.equal(actualAttribution.toString(), expectedAttribution, 'Course links must preserve only the existing attribution allowlist');
        checked++;
    }
    assert.equal(new URL(neutral.href).searchParams.has('course'), false, 'Neutral links must stay neutral');
    assert.equal(new URL(neutral.href).hash, '');
    if (search.includes('profile_link')) {
        assert.equal(new URL(neutral.href).searchParams.get('utm_source'), 'instagram');
        assert.equal(new URL(neutral.href).searchParams.has('utm_medium'), false);
        assert.equal(new URL(neutral.href).searchParams.has('utm_campaign'), false, 'No new attribution tuple may be allowed');
    }
}

}

console.log(`GROUP_INQUIRY_LINKS=PASS: 4 static CTAs, ${checked} dynamic links in ES/EN/DE; neutral/unknown levels, unchanged attribution and no private Placement parameters`);
