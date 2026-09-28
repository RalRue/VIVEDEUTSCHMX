import {sendMeasurement, safeAttribution} from './measurement.mjs';

const form = document.querySelector('#inquiry');
const status = document.querySelector('#status');
const button = form.querySelector('button[type=submit]');
let requestId = crypto.randomUUID();
let busy = false;
const attribution = safeAttribution(location.search);

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !form.reportValidity()) return;
  busy = true; button.disabled = true; button.textContent = 'Enviando…'; status.textContent = '';
  const fields = new FormData(form);
  const consent = {analytics: fields.has('analytics'), marketing: fields.has('marketing')};
  const body = {id: requestId, name: fields.get('name'), email: fields.get('email'), course: fields.get('course'),
    experience: fields.get('experience'), goal: fields.get('goal'), schedule: fields.get('schedule'), website: fields.get('website'),
    privacy: fields.has('privacy'), ...consent};
  try {
    const response = await fetch('/api/inquiry', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body), credentials: 'omit', signal: AbortSignal.timeout(25000)});
    const result = await response.json();
    if (!response.ok || result.ok !== true || result.stored !== true || result.id !== requestId) throw new Error('not-confirmed');
    // Remove PII and any unexpected URL parameters before loading measurement libraries.
    form.reset(); form.remove();
    if (!consent.marketing) attribution.delete('fbclid');
    if (!consent.analytics && !consent.marketing) [...attribution.keys()].forEach(key => attribution.delete(key));
    history.replaceState(null, '', '/consulta/' + (attribution.size ? '?' + attribution.toString() : ''));
    document.body.dataset.test = String(result.test);
    document.querySelector('#success').hidden = false;
    document.querySelector('#success').focus();
    status.textContent = '';
    try { sendMeasurement(result, consent, attribution); } catch { /* Measurement must never undo confirmed receipt. */ }
  } catch {
    status.textContent = 'No pudimos confirmar el envío. Tus datos siguen aquí. Inténtalo de nuevo; no se generará una consulta duplicada.';
    busy = false; button.disabled = false; button.textContent = 'Reintentar envío';
  }
});
