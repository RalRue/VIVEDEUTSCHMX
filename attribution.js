(function () {
function safeAttribution(search) {
  const incoming = new URLSearchParams(search);
  const safe = new URLSearchParams();
  const source = incoming.get('utm_source');
  if (['fb','ig','facebook','instagram'].includes(source)) safe.set('utm_source', source);
  if (incoming.get('utm_medium') === 'paid_social') safe.set('utm_medium', 'paid_social');
  const campaign = incoming.get('utm_campaign');
  if (['a1_minilecciones_sep2026', 'a1_confirma_hora_202610', 'a1_cafe_202610'].includes(campaign)) safe.set('utm_campaign', campaign);
  const content = incoming.get('utm_content');
  if (/^mini0[123]$/.test(content || '')) safe.set('utm_content', content);
  // Only the approved campaign/ad pairs are allowed, never arbitrary numeric input.
  // Keep IDs as strings so their exact decimal representation is preserved.
  const approvedAds = {
    a1_confirma_hora_202610: {campaign: '120248958374280767', ad: '120248958374300767'},
    a1_cafe_202610: {campaign: '120248962296800767', ad: '120248962296790767'}
  };
  const approved = Object.hasOwn(approvedAds, campaign) ? approvedAds[campaign] : null;
  const unambiguous = ['utm_campaign', 'campaign_id', 'utm_content'].every(key => incoming.getAll(key).length <= 1);
  if (approved && unambiguous && incoming.get('campaign_id') === approved.campaign) {
    safe.set('campaign_id', approved.campaign);
    if (content === approved.ad) safe.set('utm_content', approved.ad);
  }
  const clickId = incoming.get('fbclid');
  if (/^[A-Za-z0-9_-]{20,500}$/.test(clickId || '')) safe.set('fbclid', clickId);
  return safe;
}

globalThis.viveSafeAttribution = safeAttribution;
})();
