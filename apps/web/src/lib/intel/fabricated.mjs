// Recognises Keywords and Offerings results that only the fallbacks removed
// on 2026-09-29 could have produced (spec 2026-09-29-no-fabricated-fallbacks,
// D4). Plain JS so scripts/remove-fabricated-intel.mjs can import it with
// `node`, no TypeScript runner needed.

const FALLBACK_CLUSTER = 'Estimated Theme';
const FALLBACK_NOTE = 'score estimated from limited evidence';
const FALLBACK_OFFER_FOCUS = 'Insufficient public evidence';

const list = (value) => (Array.isArray(value) ? value : []);

/** A competitor carrying both marks of fallbackKeywordPayload. */
function isFabricatedKeywordsIntel(value) {
  return list(value?.competitors).some(
    (item) =>
      list(item?.keyword_clusters).some((cluster) => cluster?.cluster === FALLBACK_CLUSTER) &&
      list(item?.data_quality_notes).includes(FALLBACK_NOTE),
  );
}

/** The offerings fallback's shape: nothing for the client or any competitor. */
function isEmptyOfferingsIntel(value) {
  const client = value?.client_offerings;
  if (!client || list(client.offerings).length > 0) return false;
  if (client.summary?.main_offering_focus !== FALLBACK_OFFER_FOCUS) return false;
  return list(value.competitor_offerings).every((item) => list(item?.offerings).length === 0);
}

/** Keys of audienceInsights that hold a fabricated result. */
export function planCleanup(audienceInsights) {
  if (!audienceInsights || typeof audienceInsights !== 'object') return [];
  const keys = [];
  if (isFabricatedKeywordsIntel(audienceInsights.competitorKeywordsIntel)) keys.push('competitorKeywordsIntel');
  if (isEmptyOfferingsIntel(audienceInsights.productsServicesIntel)) keys.push('productsServicesIntel');
  return keys;
}

/** A copy of audienceInsights without the given keys. */
export function withoutKeys(audienceInsights, keys) {
  const copy = { ...audienceInsights };
  for (const key of keys) delete copy[key];
  return copy;
}
