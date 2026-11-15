const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'member-codes.js');

function normalize(code) {
  return String(code || '').trim().toUpperCase();
}

function parseEnv(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr.map((row) => (
          typeof row === 'string'
            ? { code: row, company: row }
            : { code: row.code, company: row.company || row.name || row.code }
        )).filter((r) => normalize(r.code));
      }
    } catch (e) { /* fall through to the CODE:Company list */ }
  }
  return s.split(/[\n,]+/).map((part) => {
    const line = part.trim();
    if (!line) return null;
    const idx = line.indexOf(':');
    if (idx === -1) return { code: line, company: line };
    return { code: line.slice(0, idx).trim(), company: line.slice(idx + 1).trim() || line.slice(0, idx).trim() };
  }).filter((r) => r && normalize(r.code));
}

function loadCodes() {
  const fromEnv = parseEnv(process.env.MEMBER_CODES);
  if (fromEnv && fromEnv.length) return fromEnv;
  // Fresh read so Chad can edit member-codes.js and retry without restarting in some setups;
  // require cache is still used unless the file is explicitly reloaded.
  delete require.cache[require.resolve(FILE)];
  const list = require(FILE);
  return Array.isArray(list) ? list : [];
}

function lookupMember(code) {
  const key = normalize(code);
  if (!key) return null;
  const hit = loadCodes().find((row) => normalize(row.code) === key);
  return hit ? { code: normalize(hit.code), company: String(hit.company || hit.code).trim() } : null;
}

function resolveMember(order) {
  return lookupMember(order && order.memberCode);
}

module.exports = { normalize, lookupMember, resolveMember, loadCodes };
