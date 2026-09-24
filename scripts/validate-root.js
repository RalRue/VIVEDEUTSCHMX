const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`DEPLOY BLOCKED: ${message}`);
    process.exitCode = 1;
  }
}

const homepage = read("index.html");
const errorTrainer = read(path.join("deutsch-fehlertrainer", "index.html"));
const vocabTrainer = read(path.join("vokabeltrainer", "index.html"));
const analytics = read("analytics.js");
const privacyPages = ["aviso-privacidad.html", "privacy.html", "datenschutz.html"].map(read);
const translations = read("translations.js");

assert(
  homepage.includes("<title>VIVE DEUTSCH MX · Alemán en grupos y servicios lingüísticos DE/ES/EN</title>"),
  "Root index.html must be the VIVE DEUTSCH MX homepage."
);

assert(
  !homepage.includes("<title>Entrenador de errores de alemán | VIVE DEUTSCH MX</title>"),
  "Root index.html currently looks like the error trainer."
);

assert(
  homepage.includes('id="hero"') && homepage.includes('id="language-services"') && homepage.includes('id="courses"'),
  "Root homepage must include the main website sections."
);

assert(
  homepage.includes("Consultar un grupo no reserva lugar ni genera cobros") &&
    /href="mailto:ralph_stoecker@live\.com\?subject=Consulta%20grupo%20A1[^\"]*"[^>]*class="[^"]*group-email-link/.test(homepage),
  "Group inquiry and email CTA must remain visible without a checkout promise."
);

assert(
  !/MXN\s*(?:1[,.]600|4[,.]800|1[,.]800|5[,.]400)|17:30|13 de octubre|13 October|13\. Oktober|24 clases|24 classes|24 Stunden|12 semanas lectivas|12 teaching weeks|12 Unterrichtswochen/i.test(homepage + translations),
  "Private group prices, dates and block details must not be deployed."
);

assert(
  !/4[–-]6|menos de 24 horas|within 24 hours|innerhalb von 24 Stunden|id="testimonials"/i.test(homepage + translations) &&
    !/testi\.t[1-3]\./.test(translations),
  "Do not publish unconfirmed group sizes, reply times or testimonials."
);

assert(
  homepage.includes('<script src="meta-pixel.js" defer></script>'),
  "Root homepage must keep Meta Pixel loading from the root."
);

assert(
  errorTrainer.includes("<title>Entrenador de errores de alemán | VIVE DEUTSCH MX</title>"),
  "The error trainer must stay in deutsch-fehlertrainer/index.html."
);

assert(
  vocabTrainer.includes("<title>Entrenador de vocabulario español-alemán | VIVE DEUTSCH MX</title>"),
  "The vocabulary trainer must stay in vokabeltrainer/index.html."
);

assert(
  analytics.includes("analytics_storage: 'denied'") &&
    analytics.includes("ad_user_data: 'denied'") &&
    analytics.includes("ad_personalization: 'denied'"),
  "Consent Mode v2 defaults must remain denied until the user chooses."
);

assert(
  errorTrainer.includes("learning_quiz_started") && errorTrainer.includes("learning_quiz_completed"),
  "The error trainer must keep start and completion analytics events."
);

if (!homepage.includes('id="contact-form"')) {
  for (const page of privacyPages) {
    assert(
      page.includes('href="mailto:ralph_stoecker@live.com"') &&
        !/formulario de contacto|contact form|Kontaktformular|Formular auf/i.test(page),
      "Privacy pages must not promise a contact form that the homepage does not have."
    );
  }
}

if (process.exitCode) {
  console.error("Fix the file placement before deploying to Vercel.");
  process.exit(process.exitCode);
}

console.log("Deploy guard passed: root is homepage; trainers are in their own folders.");
