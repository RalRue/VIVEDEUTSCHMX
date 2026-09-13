import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../api/reply-assistant.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.local");

for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const match = /^([^#=]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim();
}

const response = {
  statusCode: 200,
  body: null,
  setHeader() {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
};

await handler({
  method: "POST",
  headers: { authorization: `Bearer ${process.env.VIVE_REPLY_ADMIN_TOKEN}` },
  body: { message: "Hola, ofrecen clases por Zoom?", channel: "test" }
}, response);

if (response.statusCode !== 200) {
  throw new Error(`Live smoke test failed with status ${response.statusCode}: ${response.body?.error || "unknown"}`);
}

console.log(JSON.stringify({
  status: "PASS",
  category: response.body.result.category,
  risk: response.body.result.risk,
  review_only: response.body.result.current_mode === "review_only",
  auto_send: response.body.result.can_send_automatically_now
}));
