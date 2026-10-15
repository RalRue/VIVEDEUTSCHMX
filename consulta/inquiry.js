import {sendMeasurement, safeAttribution} from './measurement.mjs';

const form = document.querySelector('#inquiry');
const status = document.querySelector('#status');
const button = form.querySelector('button[type=submit]');
let requestId = crypto.randomUUID();
let busy = false;
let attemptedBody = null;
const attribution = safeAttribution(location.search);

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !form.reportValidity()) return;
  const fields = new FormData(form);
  const consent = {analytics: fields.has('analytics'), marketing: fields.has('marketing')};
  const body = {id: requestId, name: fields.get('name'), email: fields.get('email'), course: fields.get('course'),
    experience: fields.get('experience'), goal: fields.get('goal'), schedule: fields.get('schedule'), website: fields.get('website'),
    privacy: fields.has('privacy'), ...consent};
  const privateAttribution = {source: attribution.get('utm_source'), medium: attribution.get('utm_medium'), campaign: attribution.get('utm_campaign'), content: attribution.get('utm_content')};
  if (privateAttribution.source === 'instagram' && privateAttribution.medium === 'paid_social' && privateAttribution.campaign === 'vive_a1_cafe_microtest_202610' && privateAttribution.content === 'cafe_cards_v1') body.attribution = privateAttribution;
  const serialized = JSON.stringify(body);
  // A timed-out request may already be stored; never acknowledge changed data as its duplicate.
  if (attemptedBody !== null && attemptedBody !== serialized) {
    status.textContent = 'El primer envío podría estar guardado. Estos cambios no se han enviado. Para corregir tus datos, escribe a ralph_stoecker@live.com. Si deseas reintentar el mismo envío, restablece los datos originales.';
    return;
  }
  busy = true; button.disabled = true; button.textContent = 'Enviando…'; status.textContent = '';
  try {
    const response = await fetch('/api/inquiry', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: serialized, credentials: 'same-origin', signal: AbortSignal.timeout(25000)});
    const result = await response.json();
    if (!response.ok && [400,403,413,415,503].includes(response.status) && result.ok === false && result.storageAttempted === false) {
      // A later rejection cannot disprove storage by an earlier, unconfirmed attempt.
      status.textContent = attemptedBody !== null
        ? 'Este intento fue rechazado, pero el primer envío podría estar guardado. Reintenta con los mismos datos o escribe a ralph_stoecker@live.com.'
        : response.status === 400
          ? 'No se guardó la consulta. Revisa tu nombre y correo electrónico (por ejemplo, nombre@dominio.com), corrige los datos e inténtalo de nuevo.'
          : 'No se guardó la consulta. Puedes revisar tus datos e intentarlo más tarde.';
      busy = false; button.disabled = false; button.textContent = 'Reintentar envío';
      return;
    }
    if (!response.ok || result.ok !== true || result.stored !== true || result.id !== requestId) throw new Error('not-confirmed');
    // Remove PII and any unexpected URL parameters before loading measurement libraries.
    form.reset(); form.remove();
    if (!consent.marketing) attribution.delete('fbclid');
    if (!consent.analytics && !consent.marketing) [...attribution.keys()].forEach(key => attribution.delete(key));
    history.replaceState(null, '', '/consulta/' + (attribution.size ? '?' + attribution.toString() : ''));
    document.body.dataset.test = String(result.test);
    document.querySelector('#success').hidden = false;
    document.querySelector('#success').focus();
    if (result.placementAccessUrl === '/api/placement-access?inquiryId=' + requestId) {
      const link = document.querySelector('#placement-link');
      // Native links support new tabs; the signed capability stays in an HttpOnly cookie.
      link.href = result.placementAccessUrl;
      link.rel = 'noopener noreferrer';
      document.querySelector('#placement-pilot').hidden = false;
    }
    status.textContent = '';
    try { sendMeasurement(result, consent, attribution); } catch { /* Measurement must never undo confirmed receipt. */ }
  } catch {
    attemptedBody = serialized;
    status.textContent = 'No pudimos confirmar el envío. Tus datos siguen aquí. Inténtalo de nuevo; no se generará una consulta duplicada.';
    busy = false; button.disabled = false; button.textContent = 'Reintentar envío';
  }
});

