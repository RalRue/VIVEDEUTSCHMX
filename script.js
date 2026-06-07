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
    btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
});

setLanguage(currentLang);

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

// Staggered grid items
const staggerGroups = [
    '.features .feature',
    '.pricing-grid .price-card',
    '.blog-grid .blog-card',
    '.hero-stats .stat',
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
