/** Is an address outside California? (Chad: any job with a pickup or delivery outside CA is a Crating & Shipping custom quote.) */
const US = /^(us|u\.s\.a?\.?|usa|united states( of america)?|america)$/i;
const isCaZip = (z) => { const n = parseInt(String(z).slice(0, 3), 10); return n >= 900 && n <= 961; };
function outsideCA(a) {
  if (!a) return false;
  if (a.country && String(a.country).trim() && !US.test(String(a.country).trim())) return true;
  const st = String(a.state || '').trim() || (String(a.city || '').match(/,\s*([A-Za-z]{2})\s*$/) || [])[1] || '';
  if (st && !/^(ca|calif\.?|california)$/i.test(st)) return true;
  const zip = String(a.zip || '').match(/\b\d{5}\b/);
  if (zip && !isCaZip(zip[0])) return true;
  return false;
}
module.exports = { outsideCA, isCaZip };
