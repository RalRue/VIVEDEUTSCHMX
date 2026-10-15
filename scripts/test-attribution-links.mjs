import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const origin = 'https://vive-deutsch-mx.vercel.app';
const campaign = 'utm_source=instagram&utm_medium=paid_social&utm_campaign=vive_a1_cafe_microtest_202610&utm_content=cafe_cards_v1';
for (const page of ['index.html', 'vokabeltrainer.html', 'vokabeltrainer/index.html', 'deutsch-fehlertrainer.html', 'deutsch-fehlertrainer/index.html']) {
  const hrefs = [...read(page).matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]);
  hrefs.push('https://external.example/consulta/', '/blog.html', 'mailto:school@example.test');
  const links = hrefs.map(href => ({href, getAttribute: () => href}));
  let ready;
  const location = new URL(`${origin}/${page}?${campaign}&email=private%40example.test&unknown=discard`);
  const context = vm.createContext({URL, URLSearchParams, window: {location}, document: {
    readyState: 'loading', querySelectorAll: () => links,
    addEventListener(event, handler) { assert.equal(event, 'DOMContentLoaded'); ready = handler; }
  }});
  vm.runInContext(read('attribution.js'), context);
  // Analytics may clean the address before DOMContentLoaded; attribution survives.
  location.search = '';
  ready();
  let decorated = 0;
  for (let index = 0; index < links.length; index++) {
    const original = new URL(hrefs[index], location.href);
    if (original.origin === origin && ['/consulta/', '/consulta/index.html'].includes(original.pathname)) {
      const target = new URL(links[index].href);
      assert.equal(target.searchParams.get('utm_campaign'), 'vive_a1_cafe_microtest_202610', page);
      assert.equal(target.searchParams.get('utm_content'), 'cafe_cards_v1', page);
      assert.equal(target.searchParams.has('email'), false);
      assert.equal(target.searchParams.has('unknown'), false);
      decorated++;
    } else assert.equal(links[index].href, hrefs[index]);
  }
  assert.ok(decorated > 0, page);
  assert.equal(context.viveInquiryUrl('/consulta/?lang=es#contact').includes('lang=es'), true);
  assert.equal(new URL(context.viveInquiryUrl('/consulta/#contact')).hash, '#contact');
}
assert.match(read('script.js'), /link\.href = globalThis\.viveInquiryUrl\(courseInquiryUrl\)/);
console.log('PASS: allowlisted attribution reaches inquiry links on homepage and all four trainer routes; unrelated/external links remain unchanged.');
