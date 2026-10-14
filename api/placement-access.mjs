import {verifyToken} from './_placement.mjs';
import {randomBytes} from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const placementCookieName = id => '__Secure-vive-placement-' + id;

export function createHandler({env = process.env, now = Date.now} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    const nonce = randomBytes(18).toString('base64');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'nonce-" + nonce + "'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const fail = status => res.status(status).send('<!doctype html><html lang="es-MX"><meta charset="utf-8"><title>Acceso a la prueba | VIVE DEUTSCH MX</title><h1>No se pudo abrir la prueba</h1><p>El acceso falta o ya venció. Si ya enviaste tu consulta, no necesitas repetirla. Escribe a <a href="mailto:ralph_stoecker@live.com">ralph_stoecker@live.com</a> para solicitar ayuda.</p><p><a href="/consulta/">Volver a consultas</a></p></html>');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return fail(405); }
    // HttpOnly access must never be exchanged through fetch/XHR or an embedded frame.
    if (req.headers['sec-fetch-mode'] !== 'navigate' || req.headers['sec-fetch-dest'] !== 'document' ||
        !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return fail(403);
    const hosts = ['vive-deutsch-mx.vercel.app'];
    if (env.VERCEL_ENV === 'preview') for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      if (/^[a-z0-9-]+\.vercel\.app$/i.test(host || '')) hosts.push(host);
    }
    if (env.VIVE_INQUIRY_PREVIEW_ORIGIN) {
      try { hosts.push(new URL(env.VIVE_INQUIRY_PREVIEW_ORIGIN).host); } catch { /* Invalid override grants no access. */ }
    }
    if (!hosts.includes(req.headers.host)) return fail(403);
    const params = new URL(req.url, 'https://vive-deutsch-mx.vercel.app').searchParams;
    const id = params.get('inquiryId');
    if (!UUID.test(id || '') || params.getAll('inquiryId').length !== 1) return fail(400);
    const secret = env.VIVE_INQUIRY_SECRET?.trim();
    if (env.VIVE_PLACEMENT_ENABLED !== 'true' || !secret || secret.length < 40) return fail(503);
    const name = placementCookieName(id);
    const cookies = String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
    if (cookies.length !== 1) return fail(401);
    const token = cookies[0].slice(name.length + 1);
    if (!/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(token)) return fail(401);
    const auth = verifyToken(token, secret, now());
    if (!auth || auth.id !== id) return fail(401);
    // Commit a document with COOP before exposing the fragment, so a script that
    // opened this URL cannot retain a same-origin Window handle and read the token.
    return res.status(200).send('<!doctype html><html lang="es-MX"><meta charset="utf-8"><title>Abrir la prueba | VIVE DEUTSCH MX</title><p><a id="continue" href="/consulta/nivel/#' + token + '" rel="noopener noreferrer">Continuar a la prueba</a></p><script nonce="' + nonce + '">location.replace(document.getElementById("continue").href);</script></html>');
  };
}

export default createHandler();
