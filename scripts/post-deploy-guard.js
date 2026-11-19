/**
 * Safety preflight for scripts/post-deploy-check.js.
 * Never talks to the network. Callers must also fetch /api/config and pass it in
 * so a site that somehow reports Stripe live mode is refused.
 */
const TEST_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|cad-ordering-test\.onrender\.com)$/i;

function preflight({ env = process.env, base, config } = {}) {
  const key = String((env && env.STRIPE_SECRET_KEY) || '');
  if (key.startsWith('sk_live_') || (key.startsWith('sk_') && !key.startsWith('sk_test_'))) {
    return {
      ok: false,
      error: 'Refusing to run: STRIPE_SECRET_KEY is not a test key (sk_test_…). This script never runs against live Stripe and will not create live charges.',
    };
  }
  let host = '';
  try { host = new URL(String(base || '')).hostname; } catch {
    return { ok: false, error: 'Refusing to run: BASE is not a valid URL (' + base + ').' };
  }
  if (!TEST_HOSTS.test(host)) {
    return {
      ok: false,
      error: 'Refusing to run: BASE host ' + host + ' is not the test site (cad-ordering-test.onrender.com or localhost). This script will not write production records.',
    };
  }
  if (config && (config.livemode === true || config.stripeLive === true)) {
    return { ok: false, error: 'Refusing to run: /api/config reports Stripe live mode. This script only runs against test or mock payments.' };
  }
  return { ok: true };
}

module.exports = { preflight, TEST_HOSTS };
