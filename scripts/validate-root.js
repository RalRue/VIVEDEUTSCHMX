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

if (process.exitCode) {
  console.error("Fix the file placement before deploying to Vercel.");
  process.exit(process.exitCode);
}

console.log("Deploy guard passed: root is homepage; trainers are in their own folders.");

