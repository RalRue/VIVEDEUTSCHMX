// ===== LANGUAGE SWITCHER =====
const langButtons = document.querySelectorAll('.lang-btn');
let currentLang = localStorage.getItem('lang') || 'es';

function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    localStorage.setItem('lang', lang);

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const value = translations[lang]?.[key];
        if (value !== undefined) el.textContent = value;
    });

    // Update language-aware links (legal pages)
    document.querySelectorAll('[data-href-' + lang + ']').forEach(el => {
        el.href = el.getAttribute('data-href-' + lang);
    });

    langButtons.forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

langButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        setLanguage(btn.dataset.lang);
        updateContactLinks();
    });
});

setLanguage(currentLang);

// ===== CONTACT CHANNELS =====
const contactChannels = {
    schoolWhatsApp: '523151109282',
    languageServicesWhatsApp: '523151104908',
    schoolMessages: {
        es: 'Hola Ralph, me interesa aprender alemán con VIVE DEUTSCH MX. Quisiera información sobre grupos o clases individuales.',
        en: 'Hello Ralph, I am interested in learning German with VIVE DEUTSCH MX. I would like information about groups or individual lessons.',
        de: 'Hallo Ralph, ich interessiere mich für Deutschunterricht bei VIVE DEUTSCH MX. Ich hätte gern Informationen zu Gruppen oder Einzelunterricht.',
    },
    languageServicesMessages: {
        es: 'Hola Angela, me interesa una cotización u orientación para traducción, interpretación o servicios lingüísticos con VIVE DEUTSCH MX.',
        en: 'Hello Angela, I am interested in a quote or guidance for translation, interpreting or language services with VIVE DEUTSCH MX.',
        de: 'Hallo Angela, ich interessiere mich für ein Angebot oder eine Orientierung zu Übersetzung, Dolmetschen oder Sprachdienstleistungen bei VIVE DEUTSCH MX.',
    },
};

function buildWhatsAppUrl(phone, message) {
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function updateContactLinks() {
    const lang = currentLang || 'es';

    document.querySelectorAll('.angela-whatsapp-link').forEach(link => {
        const phone = link.dataset.phone || contactChannels.languageServicesWhatsApp;
        if (!phone) return;

        link.href = buildWhatsAppUrl(phone, contactChannels.languageServicesMessages[lang] || contactChannels.languageServicesMessages.es);
        link.classList.remove('is-hidden');
    });

    document.querySelectorAll('.school-whatsapp-link').forEach(link => {
        link.href = buildWhatsAppUrl(contactChannels.schoolWhatsApp, contactChannels.schoolMessages[lang] || contactChannels.schoolMessages.es);
    });
}

updateContactLinks();

// ===== LIGHTWEIGHT GA4 CLICK TRACKING =====
const campaignParams = new URLSearchParams(window.location.search);

function campaignContext() {
    return {
        traffic_source: campaignParams.get('utm_source') || 'direct',
        traffic_medium: campaignParams.get('utm_medium') || 'none',
        campaign_id: campaignParams.get('utm_campaign') || 'none',
        campaign_content: campaignParams.get('utm_content') || 'none',
    };
}

function trackSiteEvent(eventName, params = {}) {
    if (typeof window.gtag !== 'function') return;

    window.gtag('event', eventName, {
        ...campaignContext(),
        ...params,
    });
}

function bindClickTracking(selector, eventName, params) {
    document.querySelectorAll(selector).forEach(element => {
        element.addEventListener('click', () => {
            trackSiteEvent(eventName, typeof params === 'function' ? params(element) : params);
        });
    });
}

bindClickTracking('.school-whatsapp-link', 'whatsapp_click', {
    contact: 'ralph',
    pillar: 'german_classes',
});

bindClickTracking('.angela-whatsapp-link', 'whatsapp_click', {
    contact: 'angela',
    pillar: 'language_services',
});

bindClickTracking('.setmore-open, a[href*="ralphrudiger.setmore.com"]', 'booking_click', {
    provider: 'setmore',
    pillar: 'german_classes',
});

bindClickTracking('a[href*="instagram.com/vivedeutschmx"]', 'social_profile_click', {
    platform: 'instagram',
});

bindClickTracking('a[href*="facebook.com/vivedeutschmx"]', 'social_profile_click', {
    platform: 'facebook',
});

const schoolWhatsAppFloat = document.querySelector('.school-whatsapp-float');
const schoolSections = document.querySelectorAll('#hero, #about, #courses, #method, #pricing, #booking, #workflow, #parents, #trainer, #testimonials');
const angelaWhatsAppFloat = document.querySelector('.angela-whatsapp-float');
const languageServicesSections = document.querySelectorAll('#language-services');

if (schoolWhatsAppFloat && schoolSections.length) {
    const visibleSchoolSections = new Set();
    const updateSchoolWhatsApp = () => {
        schoolWhatsAppFloat.classList.toggle('visible', visibleSchoolSections.size > 0);
    };

    const schoolObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                visibleSchoolSections.add(entry.target.id);
            } else {
                visibleSchoolSections.delete(entry.target.id);
            }
        });
        updateSchoolWhatsApp();
    }, {
        rootMargin: '-35% 0px -45% 0px',
        threshold: 0,
    });

    schoolSections.forEach(section => schoolObserver.observe(section));
}

if (angelaWhatsAppFloat && languageServicesSections.length) {
    const visibleLanguageServicesSections = new Set();
    const updateAngelaWhatsApp = () => {
        angelaWhatsAppFloat.classList.toggle('visible', visibleLanguageServicesSections.size > 0);
    };

    const languageServicesObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                visibleLanguageServicesSections.add(entry.target.id);
            } else {
                visibleLanguageServicesSections.delete(entry.target.id);
            }
        });
        updateAngelaWhatsApp();
    }, {
        rootMargin: '-32% 0px -42% 0px',
        threshold: 0,
    });

    languageServicesSections.forEach(section => languageServicesObserver.observe(section));
}

// ===== NAVBAR ON SCROLL =====
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 30);
});

// ===== MOBILE MENU =====
const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
menuToggle?.addEventListener('click', () => {
    navLinks.classList.toggle('open');
});
navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => navLinks.classList.remove('open'));
});

// ===== SCROLL REVEAL =====
// Section headers: fade up
document.querySelectorAll('.section-header').forEach(el => el.classList.add('reveal'));

// About: photo from left, text from right
const aboutImg = document.querySelector('#about .col-image');
const aboutText = document.querySelector('#about .col-text');
if (aboutImg) aboutImg.classList.add('reveal-left');
if (aboutText) aboutText.classList.add('reveal-right');

// Language services: give Angela's pillar the same calm entrance as Ralph's profile
const angelaImg = document.querySelector('#language-services .service-portrait-frame');
const angelaText = document.querySelector('#language-services .service-lead-copy');
if (angelaImg) angelaImg.classList.add('reveal-left');
if (angelaText) angelaText.classList.add('reveal-right');

// Staggered grid items
const staggerGroups = [
    '.features .feature',
    '.pricing-grid .price-card',
    '.blog-grid .blog-card',
    '.hero-stats .stat',
    '.pillar-grid .pillar-card',
    '.booking-services .booking-service',
    '.process-grid .process-card',
    '.trust-grid .trust-item',
];
staggerGroups.forEach(selector => {
    document.querySelectorAll(selector).forEach((el, i) => {
        el.classList.add('reveal');
        el.style.setProperty('--reveal-delay', `${i * 120}ms`);
    });
});

// Testimonials: scale in
document.querySelectorAll('.testimonial').forEach((el, i) => {
    el.classList.add('reveal-scale');
    el.style.setProperty('--reveal-delay', `${i * 100}ms`);
});

// Pricing section eyebrow + cards already handled above
// Course cards
document.querySelectorAll('.card').forEach((el, i) => {
    el.classList.add('reveal');
    el.style.setProperty('--reveal-delay', `${i * 100}ms`);
});

// Generic fallback for remaining sections (avoid double-adding)
const alreadyMarked = new Set(document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale'));
document.querySelectorAll('.section').forEach(el => {
    if (!alreadyMarked.has(el)) el.classList.add('reveal');
});

const allReveal = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.12 });

allReveal.forEach(el => observer.observe(el));

// ===== BLOG EXPAND =====
document.querySelectorAll('.blog-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const card = btn.closest('.blog-card');
        const isExpanded = card.classList.toggle('expanded');
        btn.textContent = isExpanded
            ? translations[currentLang]['blog.read-less']
            : translations[currentLang]['blog.read-more'];
    });
});

// ===== CONTACT FORM =====
const form = document.getElementById('contact-form');
const feedback = document.getElementById('form-feedback');

form?.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(form);
    const name = data.get('name')?.toString().trim();
    const email = data.get('email')?.toString().trim();

    feedback.hidden = false;
    feedback.classList.remove('success', 'error');

    if (!name || !email || !email.includes('@')) {
        feedback.classList.add('error');
        feedback.textContent = translations[currentLang]['form.error'];
        return;
    }

    // TODO: Connect to a real backend (Formspree, EmailJS, Netlify Forms, etc.)
    feedback.classList.add('success');
    feedback.textContent = translations[currentLang]['form.success'];
    form.reset();
});

// ===== FOOTER YEAR =====
document.getElementById('year').textContent = new Date().getFullYear();
