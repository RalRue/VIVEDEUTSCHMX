(function () {
    const measurementId = 'G-07SGVPMFHL';
    const storageKey = 'vivePrivacyConsentV1';
    let memoryConsent = null;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        wait_for_update: 500
    });

    const copy = {
        es: { title: 'Tu privacidad', text: 'Usamos tecnologías opcionales para medir el uso del sitio y mejorar nuestras campañas. Tú decides cuáles permites.', necessary: 'Solo necesarias', analytics: 'Permitir análisis', all: 'Aceptar todo', settings: 'Privacidad', link: 'Aviso de privacidad', privacy: '/aviso-privacidad.html' },
        de: { title: 'Deine Privatsphäre', text: 'Wir verwenden optionale Technologien, um die Website-Nutzung zu messen und unsere Kampagnen zu verbessern. Du entscheidest, was du erlaubst.', necessary: 'Nur notwendig', analytics: 'Analyse erlauben', all: 'Alles akzeptieren', settings: 'Datenschutz', link: 'Datenschutzerklärung', privacy: '/datenschutz.html' },
        en: { title: 'Your privacy', text: 'We use optional technologies to measure website usage and improve our campaigns. You decide what to allow.', necessary: 'Necessary only', analytics: 'Allow analytics', all: 'Accept all', settings: 'Privacy', link: 'Privacy notice', privacy: '/privacy.html' }
    };

    function language() {
        let saved = null;
        try { saved = localStorage.getItem('lang'); } catch (error) { /* Use document language. */ }
        const documentLanguage = (document.documentElement.lang || '').toLowerCase();
        if (saved === 'de' || documentLanguage.startsWith('de')) return 'de';
        if (saved === 'en' || documentLanguage.startsWith('en')) return 'en';
        return 'es';
    }

    function readConsent() {
        try {
            const value = JSON.parse(localStorage.getItem(storageKey));
            if (value && typeof value.analytics === 'boolean' && typeof value.marketing === 'boolean') return value;
        } catch (error) { /* Invalid or unavailable storage means no stored consent. */ }
        return memoryConsent;
    }

    function writeConsent(value) {
        memoryConsent = value;
        try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch (error) { /* Keep the choice for this page view. */ }
    }

    function allows(category) {
        const consent = readConsent();
        return Boolean(consent && consent[category] === true);
    }

    function updateGoogleConsent(consent) {
        const analyticsGranted = Boolean(consent && consent.analytics === true);
        const marketingGranted = Boolean(consent && consent.marketing === true);
        window.gtag('consent', 'update', {
            analytics_storage: analyticsGranted ? 'granted' : 'denied',
            ad_storage: marketingGranted ? 'granted' : 'denied',
            ad_user_data: marketingGranted ? 'granted' : 'denied',
            ad_personalization: marketingGranted ? 'granted' : 'denied'
        });
    }

    function loadAnalytics() {
        if (!allows('analytics') || window.__viveDeutschGaLoaded) return;
        window.__viveDeutschGaLoaded = true;
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
        document.head.appendChild(script);
        window.gtag('js', new Date());
        const internalFlag = new URLSearchParams(window.location.search).get('vive_internal');
        let internalVisit = internalFlag === '1';
        // Keep test visits marked across pages in this tab, without a permanent identifier.
        try {
            if (internalFlag === '1') sessionStorage.setItem('viveInternalVisit', '1');
            if (internalFlag === '0') sessionStorage.removeItem('viveInternalVisit');
            internalVisit = sessionStorage.getItem('viveInternalVisit') === '1';
        } catch (error) { /* The URL flag still works when storage is unavailable. */ }
        if (internalVisit) window.gtag('set', { traffic_type: 'internal' });
        window.gtag('config', measurementId, {
            anonymize_ip: true,
            allow_google_signals: allows('marketing'),
            allow_ad_personalization_signals: allows('marketing')
        });
    }

    function saveChoice(analytics, marketing) {
        writeConsent({ analytics: analytics, marketing: marketing, updatedAt: new Date().toISOString() });
        updateGoogleConsent(readConsent());
        document.getElementById('vive-consent-panel')?.remove();
        showSettingsButton();
        loadAnalytics();
        window.dispatchEvent(new CustomEvent('vive:consentchange', { detail: readConsent() }));
    }

    function addStyles() {
        if (document.getElementById('vive-consent-styles')) return;
        const style = document.createElement('style');
        style.id = 'vive-consent-styles';
        style.textContent = '#vive-consent-panel{position:fixed;z-index:10000;left:16px;right:16px;bottom:16px;max-width:720px;margin:auto;background:#fff;color:#171717;border:1px solid #d5d0c7;border-radius:8px;box-shadow:0 14px 45px rgba(0,0,0,.24);padding:18px;font:15px/1.45 Inter,Arial,sans-serif}#vive-consent-panel h2{font:700 20px/1.2 Inter,Arial,sans-serif;margin:0 0 8px;letter-spacing:0}#vive-consent-panel p{margin:0 0 14px}#vive-consent-panel a{color:#75500a;text-decoration:underline}#vive-consent-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}#vive-consent-actions button,#vive-consent-settings{min-height:42px;border:1px solid #72561c;border-radius:6px;padding:9px 14px;background:#fff;color:#34280f;font:600 14px/1.2 Inter,Arial,sans-serif;cursor:pointer}#vive-consent-actions .primary{background:#72561c;color:#fff}#vive-consent-settings{position:fixed;z-index:9999;left:12px;bottom:12px;min-height:36px;padding:7px 10px;background:#fff;box-shadow:0 3px 14px rgba(0,0,0,.18)}@media(max-width:520px){#vive-consent-panel{left:8px;right:8px;bottom:8px;padding:15px}#vive-consent-actions{display:grid}#vive-consent-actions button{width:100%}}';
        document.head.appendChild(style);
    }

    function showPanel() {
        document.getElementById('vive-consent-panel')?.remove();
        document.getElementById('vive-consent-settings')?.remove();
        const text = copy[language()];
        const panel = document.createElement('section');
        panel.id = 'vive-consent-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'vive-consent-title');
        panel.innerHTML = '<h2 id="vive-consent-title"></h2><p id="vive-consent-text"></p><a id="vive-consent-link"></a><div id="vive-consent-actions"><button type="button" data-choice="necessary"></button><button type="button" data-choice="analytics"></button><button type="button" class="primary" data-choice="all"></button></div>';
        panel.querySelector('#vive-consent-title').textContent = text.title;
        panel.querySelector('#vive-consent-text').textContent = text.text;
        const link = panel.querySelector('#vive-consent-link');
        link.textContent = text.link;
        link.href = text.privacy;
        panel.querySelector('[data-choice="necessary"]').textContent = text.necessary;
        panel.querySelector('[data-choice="analytics"]').textContent = text.analytics;
        panel.querySelector('[data-choice="all"]').textContent = text.all;
        panel.addEventListener('click', function (event) {
            const choice = event.target.dataset.choice;
            if (choice === 'necessary') saveChoice(false, false);
            if (choice === 'analytics') saveChoice(true, false);
            if (choice === 'all') saveChoice(true, true);
        });
        document.body.appendChild(panel);
        panel.querySelector('button').focus();
    }

    function showSettingsButton() {
        if (!readConsent() || document.getElementById('vive-consent-settings')) return;
        const button = document.createElement('button');
        button.id = 'vive-consent-settings';
        button.type = 'button';
        button.textContent = copy[language()].settings;
        button.addEventListener('click', showPanel);
        document.body.appendChild(button);
    }

    window.viveConsent = { get: readConsent, allows: allows, open: showPanel };
    updateGoogleConsent(readConsent());
    loadAnalytics();
    document.addEventListener('DOMContentLoaded', function () {
        addStyles();
        if (readConsent()) showSettingsButton(); else showPanel();
    });
})();
