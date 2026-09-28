export function measurementPlan(result, consent) {
  if (!result || result.ok !== true || result.stored !== true || result.test !== false || result.duplicate === true) return [];
  if (!/^[a-f0-9-]{36}$/.test(result.id || '')) return [];
  const events = [];
  if (consent.analytics === true) events.push({provider: 'ga4', name: 'generate_lead'});
  if (consent.marketing === true) events.push({provider: 'meta', name: 'Lead'});
  return events;
}

export function safeAttribution(search) {
  const incoming = new URLSearchParams(search);
  const safe = new URLSearchParams();
  const source = incoming.get('utm_source');
  if (['fb','ig','facebook','instagram'].includes(source)) safe.set('utm_source', source);
  if (incoming.get('utm_medium') === 'paid_social') safe.set('utm_medium', 'paid_social');
  if (incoming.get('utm_campaign') === 'a1_minilecciones_sep2026') safe.set('utm_campaign', 'a1_minilecciones_sep2026');
  if (/^mini0[123]$/.test(incoming.get('utm_content') || '')) safe.set('utm_content', incoming.get('utm_content'));
  const clickId = incoming.get('fbclid');
  if (/^[A-Za-z0-9_-]{20,500}$/.test(clickId || '')) safe.set('fbclid', clickId);
  return safe;
}

export function sendMeasurement(result, consent, attribution = new URLSearchParams()) {
  // Called only after personal fields have been removed from the document.
  const plan = measurementPlan(result, consent);
  if (plan.some(e => e.provider === 'ga4')) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function() { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied'});
    window.gtag('js', new Date());
    window.gtag('config', 'G-07SGVPMFHL', {send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      page_location: 'https://vive-deutsch-mx.vercel.app/consulta/?' + attribution.toString(), page_referrer: ''});
    window.gtag('event', 'generate_lead');
    const ga = document.createElement('script'); ga.async = true; ga.src = 'https://www.googletagmanager.com/gtag/js?id=G-07SGVPMFHL'; document.head.appendChild(ga);
  }
  if (plan.some(e => e.provider === 'meta')) {
    const fbq = function() { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
    fbq.queue = []; fbq.loaded = true; fbq.version = '2.0'; window.fbq = fbq; window._fbq = fbq;
    fbq('set', 'autoConfig', false, '1091890316575368');
    fbq('consent', 'grant');
    fbq('init', '1091890316575368');
    fbq('track', 'Lead');
    const pixel = document.createElement('script'); pixel.async = true; pixel.src = 'https://connect.facebook.net/en_US/fbevents.js'; document.head.appendChild(pixel);
  }
}
