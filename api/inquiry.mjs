import { createHmac } from 'node:crypto';

const ORIGIN = 'https://vive-deutsch-mx.vercel.app';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validate(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object') return null;
  const allowed = ['id','name','email','course','experience','goal','schedule','privacy','analytics','marketing','website'];
  if (Object.keys(body).some(key => !allowed.includes(key)) || body.website || body.privacy !== true || !UUID.test(body.id || '')) return null;
  const text = (key, max, required = true) => typeof body[key] === 'string' && body[key].length <= max &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body[key]) && (!required || body[key].trim().length > 0);
  if (!text('name', 100) || !text('email', 254) || !text('goal', 300, false) || !text('schedule', 300, false)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || /[\r\n]/.test(body.name)) return null;
  if (!['A1','A2','B1','No lo sé'].includes(body.course) || !['Desde cero','Ya estudié alemán','No lo sé'].includes(body.experience)) return null;
  if (typeof body.analytics !== 'boolean' || typeof body.marketing !== 'boolean') return null;
  return {id: body.id.toLowerCase(), name: body.name.trim(), email: body.email.trim().toLowerCase(), course: body.course,
    experience: body.experience, goal: body.goal.trim(), schedule: body.schedule.trim(), privacyVersion: '2026-09-27',
    analytics: body.analytics, marketing: body.marketing, test: false};
}

export function createHandler({env = process.env, send = fetch, now = Date.now, report = code => console.warn('Inquiry receiver:', code)} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, value) => res.status(status).json(value);
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, {ok: false}); }
    const isPreview = env.VERCEL_ENV === 'preview';
    const previewOrigins = isPreview ? [env.VERCEL_URL, env.VERCEL_BRANCH_URL]
      .filter(host => /^[a-z0-9-]+\.vercel\.app$/i.test(host || '')).map(host => 'https://' + host) : [];
    if (env.VIVE_INQUIRY_PREVIEW_ORIGIN) previewOrigins.push(env.VIVE_INQUIRY_PREVIEW_ORIGIN);
    if (req.headers.origin !== ORIGIN && !previewOrigins.includes(req.headers.origin)) return reply(403, {ok: false});
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return reply(415, {ok: false});
    let body;
    try {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!raw || Buffer.byteLength(raw) > 8000) return reply(413, {ok: false});
      body = JSON.parse(raw);
    } catch { return reply(400, {ok: false}); }
    const data = validate(body);
    if (!data) return reply(400, {ok: false});
    const endpoint = env.VIVE_INQUIRY_RECEIVER_URL;
    const secret = env.VIVE_INQUIRY_SECRET?.trim();
    if (env.VIVE_INQUIRY_ENABLED !== 'true' || !secret || secret.length < 40 ||
        !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint || '')) return reply(503, {ok: false});
    data.test = isPreview || env.VIVE_INQUIRY_MODE !== 'live';
    // Apps Script can decode raw non-ASCII POST bytes differently before HMAC verification.
    const payload = JSON.stringify(data).replace(/[^\x00-\x7f]/g,
      char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
    const timestamp = now();
    const signature = createHmac('sha256', secret).update(timestamp + '.' + payload).digest('hex');
    try {
      const response = await send(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({timestamp, payload, signature}), signal: AbortSignal.timeout(20000), redirect: 'follow'});
      if (!response.ok) { report('upstream_http_' + response.status); return reply(502, {ok: false}); }
      if (!String(response.headers?.get('content-type') || 'application/json').includes('application/json')) {
        report('upstream_non_json'); return reply(502, {ok: false});
      }
      const result = await response.json();
      if (result.ok !== true || result.stored !== true || result.id !== data.id) {
        report('upstream_storage_not_confirmed'); return reply(502, {ok: false});
      }
      // No contact, course, or learning answers leave through the success response.
      return reply(200, {ok: true, stored: true, id: data.id, duplicate: result.duplicate === true, test: data.test});
    } catch { report('upstream_network_or_parse'); return reply(502, {ok: false}); }
  };
}

export default createHandler();
