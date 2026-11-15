/** Plain-text details of a Shipping request (emails, admin, CSV). */
const LEVEL = { curbside: 'Curbside', inside: 'Inside delivery (room of choice)', unpack: 'Inside delivery + unpack & install', unpack_debris: 'Inside delivery + unpack, install & debris removal' };
const CRATE = { needs: 'needs custom crating', crated: 'already crated', not_sure: 'crating not sure' };
const timing = (s = {}) => [s.shipBy && `ship by ${s.shipBy}`, s.arriveBy && `arrive by ${s.arriveBy}`, s.flexible ? 'dates flexible' : (s.shipBy || s.arriveBy) && 'firm dates'].filter(Boolean).join(' · ') || 'flexible';
const destLine = (a = {}) => [a.street, [a.city, a.country && !/^(us|usa|united states)/i.test(a.country) ? '' : a.state].filter(Boolean).join(', '), a.zip, a.country || 'United States'].filter(Boolean).join(', ');
function lines(o) {
  const s = o.shipping || {}, d = o.dropoff || {};
  const c = s.customs || {};
  const intl = d.country && !/^(us|usa|united states)/i.test(d.country);
  return [
    o.outOfState && ['Why a quote', 'Address outside California (customer chose ' + ((require('./pricing').SERVICES[o.requestedService] || {}).label || 'delivery') + ')'],
    ['Destination', destLine(d) + (d.locationType ? ` (${d.locationType})` : '')],
    ['Service at destination', LEVEL[s.serviceLevel] || s.serviceLevel || '—'],
    ['Timing', timing(s)],
    intl && ['Customs / import contact', [c.name, c.phone, c.email].filter(Boolean).join(' · ') || '—'],
    ['Pieces', (o.items || []).map((it) => `${it.qty || 1}× ${it.description || 'piece'} (${require('./itemtypes').typeLabel(it)}${require('./itemtypes').framingText(it) ? ', ' + require('./itemtypes').framingText(it) : ''}) ${[it.w, it.h, it.d].filter(Boolean).join('×')}${it.w || it.h ? ' in' : ''}${it.weight ? ', ' + it.weight + ' lb' : ''}${it.fragile ? ', fragile' : ''}${it.value ? ', value $' + Number(it.value).toLocaleString() : ''}, ${CRATE[it.crateStatus] || CRATE.not_sure}`).join('; ')],
    ['Insurance', `Fully insured through our shipping partners (declared value $${(o.items || []).reduce((s, it) => s + (Number(it.value) || 0) * (Number(it.qty) || 1), 0).toLocaleString()})`],
  ].filter(Boolean);
}
module.exports = { lines, timing, destLine, LEVEL, CRATE };
