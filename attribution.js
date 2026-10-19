(function () {
function canonicalAttributionSource(value) {
  const sources = {fb:'facebook', ig:'instagram', facebook:'facebook', instagram:'instagram'};
  return typeof value === 'string' && Object.hasOwn(sources,value) ? sources[value] : null;
}
function validPrivateAttribution(value) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ['source','medium','campaign','content'];
  const approved = {
    vive_a1_trainer_20261019: 'edad_bin_v1',
    vive_a1_cafe_microtest_202610: 'cafe_cards_v1',
    a1_cafe_202610: '120248962296790767',
    a1_confirma_hora_202610: '120248958374300767'
  };
  return Object.keys(value).length === 4 && keys.every(key => Object.hasOwn(value,key)) &&
    ['facebook','instagram'].includes(value.source) && value.medium === 'paid_social' &&
    typeof value.campaign === 'string' && Object.hasOwn(approved,value.campaign) &&
    value.content === approved[value.campaign];
}
function safeAttribution(search) {
  const incoming = new URLSearchParams(search);
  const safe = new URLSearchParams();
  const parameters = ['utm_source','utm_medium','utm_campaign','utm_content','campaign_id','fbclid'];
  // Never collapse duplicate parameters: even equal values are ambiguous input.
  if (parameters.some(key => incoming.getAll(key).length > 1)) return safe;
  const source = canonicalAttributionSource(incoming.get('utm_source'));
  const medium = incoming.get('utm_medium');
  const campaign = incoming.get('utm_campaign');
  const content = incoming.get('utm_content');
  const campaignId = incoming.get('campaign_id');
  const approvedCampaignIds = {
    a1_cafe_202610: '120248962296800767',
    a1_confirma_hora_202610: '120248958374280767'
  };
  if (['vive_a1_trainer_20261019','vive_a1_cafe_microtest_202610','a1_cafe_202610','a1_confirma_hora_202610'].includes(campaign)) {
    if (!validPrivateAttribution({source,medium,campaign,content})) return safe;
    if (campaignId !== null && (!Object.hasOwn(approvedCampaignIds,campaign) || campaignId !== approvedCampaignIds[campaign])) return safe;
    safe.set('utm_source', source);
    safe.set('utm_medium', medium);
    safe.set('utm_campaign', campaign);
    safe.set('utm_content', content);
    if (campaignId !== null) safe.set('campaign_id', campaignId);
  } else {
    // Preserve the pre-existing September measurement links, never persist them
    // as one of the three approved inquiry/ad pairs.
    if (campaignId !== null) return safe;
    if (source) safe.set('utm_source', source);
    if (medium === 'paid_social') safe.set('utm_medium', medium);
    if (campaign === 'a1_minilecciones_sep2026') safe.set('utm_campaign', campaign);
    if (/^mini0[123]$/.test(content || '')) safe.set('utm_content', content);
  }
  const clickId = incoming.get('fbclid');
  if (/^[A-Za-z0-9_-]{20,500}$/.test(clickId || '')) safe.set('fbclid', clickId);
  return safe;
}

globalThis.viveSafeAttribution = safeAttribution;
globalThis.viveValidPrivateAttribution = validPrivateAttribution;

// Keep the same allowlist for measurement and inquiry navigation. Capture before
// analytics normalizes the address, and never decorate unrelated/external links.
const location = globalThis.window?.location;
const attribution = safeAttribution(location?.search || '');
function inquiryUrl(href) {
  if (!location?.origin || typeof URL === 'undefined') return href;
  try {
    const target = new URL(href, location.href);
    if (target.origin !== location.origin || !['/consulta/', '/consulta/index.html'].includes(target.pathname)) return href;
    // Do not overwrite explicit conflicting/duplicate attribution on a destination.
    const keys = ['utm_source','utm_medium','utm_campaign','utm_content','campaign_id','fbclid'];
    for (const key of keys) {
      const values = target.searchParams.getAll(key);
      if (values.length > 1) return href;
      const value = key === 'utm_source' ? canonicalAttributionSource(values[0]) : values[0];
      if (values.length && attribution.has(key) && value !== attribution.get(key)) return href;
    }
    for (const [key, value] of attribution) target.searchParams.set(key, value);
    return target.href;
  } catch { return href; }
}
globalThis.viveInquiryUrl = inquiryUrl;
function decorateInquiryLinks() {
  globalThis.document?.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (href) link.href = inquiryUrl(href);
  });
}
if (globalThis.document?.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', decorateInquiryLinks, {once: true});
} else {
  decorateInquiryLinks();
}
})();

