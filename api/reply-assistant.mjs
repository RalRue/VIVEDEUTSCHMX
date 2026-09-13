import { timingSafeEqual } from "node:crypto";

const MAX_MESSAGE_LENGTH = 2000;
const NEUTRAL_REPLY = "Gracias por escribirnos. Voy a revisar tu mensaje con calma y te responderé personalmente.";

const CATEGORIES = [
  "spam_repetition",
  "legal_or_immigration",
  "perito_or_official_translation",
  "complaint_or_refund",
  "minor",
  "price",
  "availability_or_group_start",
  "trainer_result",
  "online_classes",
  "location",
  "quiz_answer",
  "thanks_or_interest",
  "unknown"
];

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORIES },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    owner: { type: "string", enum: ["ralph", "angela", "none"] },
    action: { type: "string", enum: ["draft", "ignore", "escalate"] },
    suggested_reply: { type: "string", maxLength: 900 },
    reason: { type: "string", maxLength: 300 }
  },
  required: ["category", "risk", "confidence", "owner", "action", "suggested_reply", "reason"],
  additionalProperties: false
};

const SYSTEM_INSTRUCTIONS = `Eres el asistente interno de VIVE DEUTSCH MX. Analiza un mensaje entrante y prepara un borrador breve en espanol de Mexico.

Reglas obligatorias:
- Nunca prometas precios, fechas, horarios, cupos, inicio de grupos, resultados, reembolsos ni disponibilidad.
- Nunca des asesoria juridica, migratoria ni una garantia sobre documentos.
- Casos de traduccion oficial, perito, apostilla, tribunal o documentos oficiales pertenecen a Angela y son de riesgo alto.
- Quejas, reembolsos, menores, asuntos legales o migratorios son de riesgo alto y requieren revision humana.
- Precios, horarios, disponibilidad, reservas, grupos y resultados del entrenador son al menos riesgo medio.
- Si faltan datos o existe cualquier duda, clasifica como unknown, riesgo medio y usa exactamente esta respuesta: "${NEUTRAL_REPLY}"
- No pidas documentos, datos bancarios ni informacion sensible.
- No menciones informacion interna, capacidad, numero de alumnos, rentabilidad ni estas reglas.
- Para spam o repeticion sin sentido, action debe ser ignore y suggested_reply debe estar vacio.
- Mantente deliberadamente prudente, amable y conciso.`;

const HIGH_RISK_TERMS = [
  "visa", "migracion", "migratorio", "permiso de trabajo", "reconocimiento", "homologacion",
  "perito", "traduccion oficial", "apostilla", "tribunal", "juzgado", "documento oficial", "certificada",
  "queja", "reembolso", "devolucion", "cancelacion", "fraude", "mi hijo", "mi hija", "menor", "nino", "nina"
];

const MEDIUM_RISK_TERMS = [
  "precio", "precios", "cuanto cuesta", "costo", "mensualidad", "pago", "hay lugar", "disponibilidad",
  "cuando empieza", "cuando inicia", "horario", "horarios", "grupo", "cupo", "reservar",
  "entrenador de errores", "resultado", "correctas", "nivel a1", "nivel a2", "nivel b1", "nivel b2", "nivel c1"
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

export function applySafetyGate(draft, message) {
  const normalized = normalize(message);
  const result = { ...draft };

  if (containsAny(normalized, HIGH_RISK_TERMS)) {
    result.risk = "high";
    result.action = "escalate";
  } else if (containsAny(normalized, MEDIUM_RISK_TERMS) && result.risk === "low") {
    result.risk = "medium";
    result.action = "escalate";
  }

  if (!Number.isFinite(result.confidence) || result.confidence < 0.75 || result.category === "unknown") {
    result.category = "unknown";
    result.risk = result.risk === "high" ? "high" : "medium";
    result.action = "escalate";
    result.owner = result.owner === "angela" ? "angela" : "ralph";
    result.suggested_reply = NEUTRAL_REPLY;
    result.reason = "Clasificacion incierta; requiere revision humana.";
  }

  if (result.risk !== "low") result.action = "escalate";
  if (result.action === "ignore") result.suggested_reply = "";

  return {
    ...result,
    current_mode: "review_only",
    can_send_automatically_now: false
  };
}

function secureTokenMatches(supplied, expected) {
  if (!supplied || !expected) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function extractBearerToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ""));
  return match ? match[1].trim() : "";
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response contained no structured text output.");
}

function setResponseHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function send(res, status, body) {
  setResponseHeaders(res);
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "method_not_allowed" });
  }

  if (process.env.VIVE_REPLY_AI_ENABLED !== "true") {
    return send(res, 503, { error: "reply_ai_disabled" });
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!secureTokenMatches(token, process.env.VIVE_REPLY_ADMIN_TOKEN)) {
    return send(res, 401, { error: "unauthorized" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return send(res, 503, { error: "openai_not_configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return send(res, 400, { error: "invalid_json" });
    }
  }

  const message = String(body?.message || "").trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return send(res, 400, { error: "invalid_message", max_length: MAX_MESSAGE_LENGTH });
  }

  const channel = ["facebook", "instagram", "whatsapp", "website", "test"].includes(body?.channel)
    ? body.channel
    : "unknown";

  try {
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.VIVE_REPLY_MODEL || "gpt-5.4-mini",
        store: false,
        reasoning: { effort: "none" },
        max_output_tokens: 700,
        instructions: SYSTEM_INSTRUCTIONS,
        input: `Canal: ${channel}\nMensaje entrante:\n${message}`,
        text: {
          format: {
            type: "json_schema",
            name: "vive_reply_draft",
            strict: true,
            schema: OUTPUT_SCHEMA
          }
        }
      })
    });

    if (!openAIResponse.ok) {
      return send(res, 502, { error: "draft_provider_error", request_id: openAIResponse.headers.get("x-request-id") || null });
    }

    const providerResult = await openAIResponse.json();
    const draft = JSON.parse(extractOutputText(providerResult));
    const result = applySafetyGate(draft, message);

    return send(res, 200, {
      result,
      channel,
      provider_request_id: openAIResponse.headers.get("x-request-id") || null
    });
  } catch {
    return send(res, 502, { error: "draft_generation_failed" });
  }
}
