import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

class Element {
    constructor(tag, document) {
        this.tagName = tag;
        this.document = document;
        this.children = [];
        this.attributes = {};
        this.dataset = {};
        this.listeners = {};
        this.style = {setProperty() {}};
        this.classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            contains: name => this.classes.has(name),
            toggle: (name, force) => {
                const add = force === undefined ? !this.classes.has(name) : force;
                if (add) this.classes.add(name); else this.classes.delete(name);
                return add;
            }
        };
    }
    setAttribute(name, value) {
        this.attributes[name] = value;
        if (name === 'id') this.id = value;
        if (name.startsWith('data-')) this.dataset[name.slice(5)] = value;
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    insertBefore(child) { return this.appendChild(child); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
    focus() { this.document.activeElement = this; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    fire(name, event = {}) { this.listeners[name]?.(event); }
    querySelectorAll() { return []; }
    querySelector(selector) {
        const descendants = this.children.flatMap(child => [child, ...child.descendants()]);
        if (selector.startsWith('#')) return descendants.find(child => child.id === selector.slice(1));
        if (selector === 'a, button') return descendants.find(child => child.tagName === 'a' || child.tagName === 'button');
        const choice = selector.match(/^\[data-choice="([^"]+)"\]$/)?.[1];
        if (choice) return descendants.find(child => child.dataset.choice === choice);
        return descendants.find(child => child.tagName === selector);
    }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    set innerHTML(html) {
        this.children = [];
        for (const match of html.matchAll(/<(h2|p|a|div|button)\b([^>]*)>/g)) {
            const child = new Element(match[1], this.document);
            for (const attribute of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(attribute[1], attribute[2]);
            this.appendChild(child);
        }
    }
}

function consentPage({saved = null, getFails = false, setFails = false, removeFails = false, stored = new Map(saved ? [['vivePrivacyConsentV1', JSON.stringify(saved)]] : [])} = {}) {
    const document = {documentElement: {lang: 'es'}, listeners: {}, activeElement: null};
    document.head = new Element('head', document);
    document.body = new Element('body', document);
    document.head.appendChild(new Element('script', document));
    document.createElement = tag => new Element(tag, document);
    document.getElementById = id => [...document.head.descendants(), ...document.body.descendants()].find(node => node.id === id);
    document.querySelectorAll = () => [];
    document.getElementsByTagName = tag => document.head.descendants().filter(node => node.tagName === tag);
    document.addEventListener = (name, callback) => { (document.listeners[name] ||= []).push(callback); };
    const window = {location: {search: ''}, listeners: {}};
    window.addEventListener = (name, callback) => { window.listeners[name] = callback; };
    window.dispatchEvent = event => window.listeners[event.type]?.(event);
    const context = vm.createContext({window, document, URLSearchParams, CustomEvent: class {
        constructor(type, options) { this.type = type; this.detail = options.detail; }
    }, localStorage: {
        getItem(key) { if (getFails) throw new Error('SecurityError'); return stored.get(key) ?? null; },
        setItem(key, value) { if (setFails) throw new Error('QuotaExceededError'); stored.set(key, value); },
        removeItem(key) { if (removeFails) throw new Error('SecurityError'); stored.delete(key); }
    }, sessionStorage: {getItem() { return null; }, setItem() {}, removeItem() {}}});
    vm.runInContext(read('analytics.js'), context);
    vm.runInContext(read('meta-pixel.js'), context);
    document.listeners.DOMContentLoaded.forEach(callback => callback());
    const choose = choice => {
        window.viveConsent.open();
        const panel = document.getElementById('vive-consent-panel');
        panel.fire('click', {target: panel.querySelector('[data-choice="' + choice + '"]')});
    };
    return {window, document, choose, stored};
}

const grant = {analytics: true, marketing: true};
const withdrawal = consentPage({saved: grant, setFails: true});
withdrawal.choose('necessary');
assert.equal(withdrawal.window.viveConsent.allows('analytics'), false, 'A failed storage write must not restore the previous analytics grant');
assert.equal(withdrawal.window.viveConsent.allows('marketing'), false, 'Marketing withdrawal must survive a failed storage write');
assert.equal(withdrawal.window['ga-disable-G-07SGVPMFHL'], true);
assert.equal(withdrawal.document.getElementById('vive-consent-panel'), undefined);
assert.equal(withdrawal.document.activeElement.id, 'vive-consent-settings', 'Closing the panel must leave keyboard focus on a live control');
assert.ok(withdrawal.window.dataLayer.some(command => command[0] === 'consent' && command[1] === 'update' && command[2].analytics_storage === 'denied'));
assert.equal(withdrawal.window.fbq.queue.at(-1)[1], 'revoke', 'Meta must receive withdrawal rather than a renewed grant');
const pixelCount = withdrawal.window.fbq.queue.length;
withdrawal.window.viveMetaPixel.trackCustom('WhatsAppClick');
assert.equal(withdrawal.window.fbq.queue.length, pixelCount, 'Marketing events must stay blocked after withdrawal');
assert.equal(withdrawal.stored.has('vivePrivacyConsentV1'), false, 'A failed write should remove the stale grant when removal is possible');
const reloaded = consentPage({stored: withdrawal.stored, setFails: true});
assert.equal(reloaded.window.__viveDeutschGaLoaded, undefined, 'Reload after removal must not restore analytics without a new choice');
assert.equal(reloaded.window.__viveDeutschMetaPixelLoaded, undefined, 'Reload after removal must not restore marketing without a new choice');
assert.ok(reloaded.document.getElementById('vive-consent-panel'));

const readOnly = consentPage({saved: grant, setFails: true, removeFails: true});
readOnly.choose('necessary');
assert.equal(readOnly.window.viveConsent.allows('analytics'), false, 'Even fully read-only storage must not override a withdrawal in the current tab');
assert.equal(readOnly.window.viveConsent.allows('marketing'), false);
assert.equal(readOnly.window['ga-disable-G-07SGVPMFHL'], true);
assert.equal(readOnly.window.fbq.queue.at(-1)[1], 'revoke');

const blocked = consentPage({getFails: true, setFails: true});
assert.equal(blocked.window.__viveDeutschGaLoaded, undefined, 'No GA script should load before consent');
assert.equal(blocked.window.__viveDeutschMetaPixelLoaded, undefined);
const panel = blocked.document.getElementById('vive-consent-panel');
assert.equal(panel.getAttribute('aria-modal'), null, 'A panel with freely moving focus must not claim modal behavior');
assert.equal(panel.getAttribute('aria-describedby'), 'vive-consent-text');
blocked.choose('analytics');
assert.equal(blocked.window.viveConsent.allows('analytics'), true, 'An in-memory choice must work when storage is unavailable');
assert.equal(blocked.window.viveConsent.allows('marketing'), false);
assert.equal(blocked.window['ga-disable-G-07SGVPMFHL'], false);
blocked.choose('necessary');
assert.equal(blocked.window['ga-disable-G-07SGVPMFHL'], true);
blocked.choose('all');
assert.equal(blocked.window['ga-disable-G-07SGVPMFHL'], false, 'An explicit later grant must re-enable GA');
const config = blocked.window.dataLayer.filter(command => command[0] === 'config').at(-1)[2];
assert.equal(config.allow_google_signals, true, 'Changing marketing consent must update a previously loaded GA configuration');
assert.equal(config.send_page_view, false, 'Consent changes must not count another page view');

// Two tabs share persisted consent but must synchronize loaded provider state.
const shared = new Map([['vivePrivacyConsentV1', JSON.stringify(grant)]]);
const tabA = consentPage({stored: shared}), tabB = consentPage({stored: shared});
tabA.choose('all');
tabB.choose('necessary');
tabA.window.dispatchEvent({type: 'storage', key: 'vivePrivacyConsentV1'});
assert.equal(tabA.window.viveConsent.allows('analytics'), false);
assert.equal(tabA.window['ga-disable-G-07SGVPMFHL'], true);
assert.equal(tabA.window.fbq.queue.at(-1)[1], 'revoke');
assert.equal(tabA.window.dataLayer.filter(x => x[0] === 'consent' && x[1] === 'update').at(-1)[2].analytics_storage, 'denied');
tabB.choose('all');
tabA.window.dispatchEvent({type: 'storage', key: 'vivePrivacyConsentV1'});
assert.equal(tabA.window['ga-disable-G-07SGVPMFHL'], false);
shared.clear();
tabA.window.dispatchEvent({type: 'storage', key: null});
assert.equal(tabA.window.viveConsent.allows('analytics'), false, 'Storage clear must not revive the old in-memory grant');
assert.equal(tabA.window.fbq.queue.at(-1)[1], 'revoke');
shared.set('vivePrivacyConsentV1', '{invalid');
tabA.window.dispatchEvent({type: 'storage', key: 'vivePrivacyConsentV1'});
assert.equal(tabA.window['ga-disable-G-07SGVPMFHL'], true);
const failedGrant = consentPage({setFails: true});
failedGrant.choose('all');
failedGrant.window.dispatchEvent({type: 'storage', key: 'vivePrivacyConsentV1'});
assert.equal(failedGrant.window.viveConsent.allows('analytics'), false, 'A failed local grant must not defeat a remote removal');
const failedWithdrawal = consentPage({saved: grant, setFails: true, removeFails: true});
failedWithdrawal.choose('necessary');
failedWithdrawal.window.dispatchEvent({type: 'storage', key: 'vivePrivacyConsentV1'});
assert.equal(failedWithdrawal.window.viveConsent.allows('analytics'), false, 'Remote grant must not defeat an unpersisted local withdrawal');

function homepage({savedLang = null, getFails = false, setFails = false} = {}) {
    const keyEvents = {};
    const document = {documentElement: {lang: 'es'}, addEventListener(name, callback) { keyEvents[name] = callback; }};
    const make = () => new Element('button', document);
    const buttons = ['es', 'en', 'de'].map(lang => { const button = make(); button.dataset.lang = lang; return button; });
    const card = make(), toggle = make(), school = make(), angela = make(), menu = make(), links = make();
    toggle.classes.add('blog-toggle');
    toggle.setAttribute('data-i18n', 'blog.read-more');
    toggle.closest = () => card;
    const firstLink = new Element('a', document);
    links.appendChild(firstLink);
    links.querySelectorAll = () => [];
    const selectors = {'.lang-btn': buttons, '[data-i18n]': [toggle], '.school-whatsapp-link': [school], '.angela-whatsapp-link': [angela], '.blog-toggle': [toggle]};
    document.querySelectorAll = selector => selectors[selector] || [];
    document.querySelector = selector => ({'.menu-toggle': menu, '.nav-links': links})[selector] || null;
    document.getElementById = id => ['year', 'navbar'].includes(id) ? make() : null;
    const events = [];
    const window = {location: {search: ''}, addEventListener() {}, gtag: (...args) => events.push(args)};
    const context = vm.createContext({window, document, URLSearchParams,
        localStorage: {getItem() { if (getFails) throw new Error('SecurityError'); return savedLang; }, setItem() { if (setFails) throw new Error('QuotaExceededError'); }},
        IntersectionObserver: class {observe() {}}});
    vm.runInContext(read('translations.js'), context);
    vm.runInContext(read('script.js'), context);
    return {document, window, buttons, card, toggle, school, angela, menu, firstLink, keyEvents, events, run: code => vm.runInContext(code, context)};
}

for (const storage of [{getFails: true, setFails: true}, {setFails: true}, {savedLang: 'unsupported'}]) {
    const home = homepage(storage);
    assert.equal(home.document.documentElement.lang, 'es');
    assert.ok(home.school.href.startsWith('https://wa.me/523151109282?text='));
    assert.ok(home.angela.href.startsWith('https://wa.me/523151104908?text='));
    home.buttons[2].fire('click');
    assert.equal(home.document.documentElement.lang, 'de', 'Storage failure must not stop language selection');
    home.menu.fire('click');
    assert.equal(home.menu.getAttribute('aria-expanded'), 'true', 'Storage failure must not stop mobile navigation');
}
const home = homepage();
home.menu.fire('click');
assert.equal(home.document.activeElement, home.firstLink);
home.keyEvents.keydown({key: 'Escape'});
assert.equal(home.document.activeElement, home.menu);
assert.equal(home.menu.getAttribute('aria-expanded'), 'false');
home.toggle.fire('click');
home.buttons[2].fire('click');
assert.equal(home.toggle.textContent, 'Weniger anzeigen ↑', 'An expanded article must keep its collapse label after language changes');
assert.equal(home.toggle.getAttribute('aria-expanded'), 'true');
home.toggle.fire('click');
assert.equal(home.toggle.textContent, 'Mehr lesen ↓');
home.run("trackSiteEvent('whatsapp_click')");
assert.equal(home.events.length, 0, 'No consent object means no analytics event');
home.window.viveConsent = {allows: () => true};
home.run("trackSiteEvent('whatsapp_click')");
assert.equal(home.events.length, 1);
home.window.viveConsent = {allows: () => false};
home.run("trackSiteEvent('whatsapp_click')");
assert.equal(home.events.length, 1, 'A withdrawal must immediately block further site events');

const html = read('index.html');
assert.match(html, /<a[^>]+href="https:\/\/ralphrudiger\.setmore\.com"[^>]+id="setmore-trigger"/);
assert.equal(html.includes('anywhere-book-now.js'), false, 'Booking must not require the integration script');
for (const tag of html.matchAll(/<a\b[^>]*class="[^"]*(?:school-whatsapp-link|angela-whatsapp-link)[^"]*"[^>]*>/g)) {
    assert.match(tag[0], /href="https:\/\/wa\.me\/52315110(?:9282|4908)\?text=[^"]+"/, 'Contact links must also work before JavaScript runs');
}
console.log('SITE_PRIVACY=PASS: storage failures, withdrawal, provider gates, focus semantics, static contacts, language and blog navigation');
