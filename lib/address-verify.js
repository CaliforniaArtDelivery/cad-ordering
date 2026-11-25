/**
 * Street + city + ZIP verification for both legs.
 * Real postal aliases (from CADZones.ZIP_ALIASES or a verified geocode) are accepted.
 * Unverified or incomplete addresses are not offered dates — they go to quote / manual review.
 * Never silently rewrite the customer's typed address.
 */
const CADZones = require('../public/zones');

const TIMEOUT_MS = 2500;
const cache = new Map();
let geocoder = defaultGeocoder;
let lastMode = 'live';

function cacheKey(addr) {
  const z = CADZones.zip5(addr) || '';
  const city = CADZones.normName(addr && addr.city);
  const street = String((addr && addr.street) || '').toLowerCase().replace(/[^a-z0-9# ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const st = String((addr && addr.state) || 'CA').toUpperCase().slice(0, 2);
  return `${street}|${city}|${st}|${z}`;
}

async function defaultGeocoder(addr) {
  const zip = CADZones.zip5(addr);
  const city = String((addr && addr.city) || '').trim();
  const street = String((addr && addr.street) || '').trim();
  const state = String((addr && addr.state) || 'CA').trim() || 'CA';
  if (!street || !city || !zip) return { ok: false, reason: 'incomplete' };
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/address?' + new URLSearchParams({
    street, city, state, zip, benchmark: 'Public_AR_Current', format: 'json',
  }).toString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, reason: 'http_' + res.status };
    const data = await res.json();
    const matches = (data && data.result && data.result.addressMatches) || [];
    if (!matches.length) return { ok: false, reason: 'no_match' };
    const m = matches[0];
    const comps = (m.addressComponents) || {};
    const matchedZip = String(comps.zip || '').slice(0, 5);
    const matchedCity = String(comps.city || m.matchedAddress || '');
    if (matchedZip && matchedZip !== zip) return { ok: false, reason: 'zip_mismatch', matchedZip, matchedCity };
    return { ok: true, reason: 'census', matchedCity, matchedZip: matchedZip || zip, matchedAddress: m.matchedAddress };
  } catch (e) {
    return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(t);
  }
}

function localCheck(addr) {
  if (!CADZones.addressComplete(addr)) {
    return { status: 'incomplete', offerDates: false, quote: true, message: 'Add the street, city, and ZIP so we can check the address before offering dates.' };
  }
  const conflict = CADZones.routeConflict(addr);
  if (conflict) {
    return { status: 'conflict', offerDates: false, quote: true, conflict, message: conflict.message };
  }
  if (CADZones.cityFitsZip(addr)) {
    return { status: 'ok', offerDates: true, quote: false, alias: !!CADZones.aliasesForZip(CADZones.zip5(addr)).length, message: '' };
  }
  return { status: 'unverified', offerDates: false, quote: true, message: 'We couldn’t verify this street, city, and ZIP together. Request a quote and we’ll confirm the address by hand — dates aren’t offered until it’s verified.' };
}

async function verifyAddress(addr, opts = {}) {
  const local = localCheck(addr);
  if (local.status === 'incomplete' || local.status === 'conflict') return local;
  if (local.status === 'ok') return local;
  // City is not a known alias; try a street-level geocode. Fail closed (quote, no dates) if it doesn't confirm.
  if (opts.skipGeocode) return local;
  const key = cacheKey(addr);
  if (cache.has(key)) return cache.get(key);
  const geo = await geocoder(addr);
  let out = local;
  if (geo && geo.ok) {
    out = { status: 'ok', offerDates: true, quote: false, verified: 'census', matchedCity: geo.matchedCity, message: '' };
  } else {
    out = { ...local, status: 'unverified', offerDates: false, quote: true, geoReason: geo && geo.reason, message: local.message };
  }
  cache.set(key, out);
  return out;
}

async function verifyLegs(pickup, dropoff, needsPickup, opts) {
  const legs = {};
  if (needsPickup) legs.pickup = await verifyAddress(pickup, opts);
  if (dropoff) legs.dropoff = await verifyAddress(dropoff, opts);
  const blocked = Object.values(legs).filter((v) => v && !v.offerDates);
  return {
    ok: !blocked.length,
    offerDates: !blocked.length,
    quote: blocked.some((v) => v.quote),
    legs,
    message: (blocked[0] && blocked[0].message) || '',
  };
}

function _setGeocoderForTests(fn) { geocoder = fn || defaultGeocoder; }
function _clearCache() { cache.clear(); }

module.exports = { verifyAddress, verifyLegs, localCheck, cacheKey, _setGeocoderForTests, _clearCache, TIMEOUT_MS };
