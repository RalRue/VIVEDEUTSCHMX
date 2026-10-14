import {verifyToken, VERSION} from './_placement.mjs';

// Read-only preflight: no receiver request, storage, mail or access issuance.
export function createHandler({env = process.env, now = Date.now} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, body) => res.status(status).json(body);
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, {ok: false}); }
    const origins = ['https://vive-deutsch-mx.vercel.app'];
    if (env.VERCEL_ENV === 'preview') for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      if (/^[a-z0-9-]+\.vercel\.app$/i.test(host || '')) origins.push('https://' + host);
    }
    if (env.VIVE_INQUIRY_PREVIEW_ORIGIN) origins.push(env.VIVE_INQUIRY_PREVIEW_ORIGIN);
    if (!origins.includes(req.headers.origin)) return reply(403, {ok: false});
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return reply(415, {ok: false});
    const secret = env.VIVE_INQUIRY_SECRET?.trim();
    if (env.VIVE_PLACEMENT_ENABLED !== 'true' || !secret || secret.length < 40) return reply(503, {ok: false});
    let body;
    try {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!raw || Buffer.byteLength(raw) > 1024) return reply(413, {ok: false});
      body = JSON.parse(raw);
    } catch { return reply(400, {ok: false}); }
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.token !== 'string') return reply(400, {ok: false});
    const time = now(), auth = verifyToken(body.token, secret, time);
    if (!auth || auth.version !== VERSION) return reply(401, {ok: false});
    return reply(200, {ok: true, version: auth.version, expires: auth.expires, expiresInMs: auth.expires - time});
  };
}

export default createHandler();
