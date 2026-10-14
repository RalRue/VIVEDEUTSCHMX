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

for (const [category,message] of [
  ['minor','Tengo 15 años, ¿puedo tomar clases por Zoom?'],
  ['legal_or_immigration','¿Ayudan con la residencia alemana?'],
  ['perito_or_official_translation','Necesito una traducción jurada.'],
  ['complaint_or_refund','Quiero recuperar mi dinero.']
]) {
  const result = applySafetyGate({...lowDraft,category,owner:'none'},message);
  assert.equal(result.risk,'high');
  assert.equal(result.action,'escalate');
  assert.equal(result.owner,category==='perito_or_official_translation'?'angela':'ralph');
  assert.equal(result.can_send_automatically_now,false);
}
for (const category of ['price','availability_or_group_start','trainer_result']) {
  const result = applySafetyGate({...lowDraft,category,owner:'none'},'Tengo otra pregunta.');
  assert.equal(result.risk,'medium');
  assert.equal(result.action,'escalate');
  assert.equal(result.owner,'ralph');
}
assert.equal(applySafetyGate({...lowDraft,category:'perito_or_official_translation',confidence:.5},'Necesito una traducción jurada.').owner,'angela',
  'Uncertain official translations still belong to Angela');
for (const term of ['traducción oficial','perito','apostilla','tribunal','juzgado','documento oficial','traducción certificada']) {
  const result=applySafetyGate(lowDraft,'Necesito '+term+'.');
  assert.equal(result.risk,'high');
  assert.equal(result.owner,'angela','Explicit official-document terms override a contradictory model category');
  assert.equal(result.action,'escalate');
  assert.equal(result.can_send_automatically_now,false);
}
for (const message of ['Tengo una queja.','Pueden garantizar mi visa?','Tengo un menor de edad.']) {
  assert.equal(applySafetyGate(lowDraft,message).owner,'ralph','Other high-risk cases do not automatically belong to Angela');
}

const oldEnabled = process.env.VIVE_REPLY_AI_ENABLED;
process.env.VIVE_REPLY_AI_ENABLED = "false";
const disabledResponse = responseRecorder();
await handler({ method: "POST", headers: {}, body: { message: "Hola" } }, disabledResponse);
assert.equal(disabledResponse.statusCode, 503);
assert.equal(disabledResponse.body.error, "reply_ai_disabled");
process.env.VIVE_REPLY_AI_ENABLED = oldEnabled;

console.log("REPLY_ASSISTANT_TEST=PASS (routine, keyword/category risk floors, human ownership, uncertainty and disabled endpoint)");
