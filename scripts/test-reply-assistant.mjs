import assert from "node:assert/strict";
import handler, { applySafetyGate } from "../api/reply-assistant.mjs";

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const lowDraft = {
  category: "online_classes",
  risk: "low",
  confidence: 0.94,
  owner: "ralph",
  action: "draft",
  suggested_reply: "Si, ofrecemos clases por Zoom.",
  reason: "Consulta rutinaria."
};

const low = applySafetyGate(lowDraft, "Dan clases por Zoom?");
assert.equal(low.risk, "low");
assert.equal(low.can_send_automatically_now, false);

const price = applySafetyGate(lowDraft, "Cuanto cuesta el grupo?");
assert.equal(price.risk, "medium");
assert.equal(price.action, "escalate");

const legal = applySafetyGate(lowDraft, "Pueden garantizar mi visa?");
assert.equal(legal.risk, "high");
assert.equal(legal.action, "escalate");

const uncertain = applySafetyGate({ ...lowDraft, confidence: 0.5 }, "Tengo otra pregunta.");
assert.equal(uncertain.category, "unknown");
assert.match(uncertain.suggested_reply, /revisar tu mensaje/);

const oldEnabled = process.env.VIVE_REPLY_AI_ENABLED;
process.env.VIVE_REPLY_AI_ENABLED = "false";
const disabledResponse = responseRecorder();
await handler({ method: "POST", headers: {}, body: { message: "Hola" } }, disabledResponse);
assert.equal(disabledResponse.statusCode, 503);
assert.equal(disabledResponse.body.error, "reply_ai_disabled");
process.env.VIVE_REPLY_AI_ENABLED = oldEnabled;

console.log("REPLY_ASSISTANT_TEST=PASS (5 checks)");
