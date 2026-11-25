/**
 * Test double for the Google Apps Script web app: runs apps-script/Code.gs UNCHANGED inside a vm against an in-memory
 * Spreadsheet (seeded from a copy of SCHEDULE 2026), behind a local HTTP endpoint that behaves like a deployed web app.
 * Fault injection (POST /__fault): { mode: 'none'|'fail500'|'crashAfterWrite'|'unauthorized'|'slow', count }.
 * Test-only. Never contacts Google.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

function makeBook(seedRows, tz = 'America/Los_Angeles') {
  const sheets = [];
  const mk = (name, rows = [], maxRows = 1000, maxCols = 36) => {
    const sh = { name, cells: rows.map((r) => r.slice()), maxRows, maxCols, formats: {}, frozen: 0, widths: {} };
    const get = (r, c) => ((sh.cells[r - 1] || [])[c - 1] ?? '');
    const set = (r, c, v) => { while (sh.cells.length < r) sh.cells.push([]); const row = sh.cells[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; };
    const fmtOf = (r, c) => sh.formats[`${r},${c}`] || 'General';
    const range = (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(r + i, c + j))),
      setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => { let x = v; if (typeof x === 'string' && /^[=+\-@]/.test(x) && fmtOf(r + i, c + j) !== '@') x = '#FORMULA:' + x; set(r + i, c + j, x); })); return range(r, c, nr, nc); },
      setValue(v) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) set(r + i, c + j, v); return range(r, c, nr, nc); },
      setNumberFormat(f) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.formats[`${r + i},${c + j}`] = f; return range(r, c, nr, nc); },
      insertCheckboxes() { return range(r, c, nr, nc); },
      copyTo(dest) { const d = dest._pos; for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) dest._sheet._set(d.r + i, d.c + j, get(r + i, c + j)); },
      _pos: { r, c }, _sheet: { _set: set },
    });
    Object.assign(sh, {
      getName: () => name, getRange: (r, c, nr, nc) => range(r, c, nr, nc),
      getLastRow: () => { for (let i = sh.cells.length; i > 0; i--) if ((sh.cells[i - 1] || []).some((v) => v !== '' && v != null)) return i; return 0; },
      getLastColumn: () => sh.cells.reduce((m, row) => { for (let i = row.length; i > 0; i--) if (row[i - 1] !== '' && row[i - 1] != null) return Math.max(m, i); return m; }, 0),
      getMaxRows: () => sh.maxRows, getMaxColumns: () => sh.maxCols,
      insertRowsAfter: (_, n) => { sh.maxRows += n; }, insertColumnsAfter: (_, n) => { sh.maxCols += n; },
      setFrozenRows: (n) => { sh.frozen = n; }, setTabColor: () => {}, setColumnWidth: (c, w) => { sh.widths[c] = w; }, getColumnWidth: (c) => sh.widths[c] || 100,
      insertRowAfter: (r) => { sh.cells.splice(r, 0, []); sh.maxRows += 1; }, deleteRow: (r) => { sh.cells.splice(r - 1, 1); },
      getParent: () => book,
    });
    sheets.push(sh); return sh;
  };
  const book = {
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => mk(n), getSpreadsheetTimeZone: () => tz, _sheets: sheets, _mk: mk,
    deleteSheet: (s) => { sheets.splice(sheets.indexOf(s), 1); },
  };
  mk('SCHEDULE 2026', seedRows, 1437, 36);
  return book;
}

function startBridge({ seed, secret = 'test-secret-0123456789abcdef', port = 0 } = {}) {
  const book = makeBook(seed.map((r) => r.map((v) => (v && typeof v === 'object' && v.$date ? new Date(v.$date + 'T12:00:00-08:00') : v))));
  const mails = [], log = [];
  const props = { SECRET: secret, TARGET_SPREADSHEET_ID: 'mock', ALERT_EMAIL: 'chadsbotchild@mail.grokbot.com' };
  let fault = { mode: 'none', count: 0 };
  const sandbox = {
    console, JSON, Date, Math, Number, String, Object, Array, RegExp, Error, parseInt, parseFloat, isNaN,
    SpreadsheetApp: { openById: () => book, CopyPasteType: { PASTE_NORMAL: 0 }, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; }, getProperties: () => ({ ...props }) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } }) },
    MailApp: { sendEmail: (to, subject, body) => { mails.push({ to, subject, body }); } },
    Utilities: { formatDate: (d, tz, f) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); return p; } },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }), deleteTrigger() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (req.url === '/__fault') { fault = JSON.parse(body || '{}'); res.end('{}'); return; }
      const t0 = Date.now();
      let b = {}; try { b = JSON.parse(body); } catch {}
      log.push({ action: b.action, orderId: b.orderId, event: b.event });
      if (fault.mode === 'fail500' && fault.count-- > 0) { res.statusCode = 500; res.end('Internal error'); return; }
      if (fault.mode === 'unauthorized' && fault.count-- > 0) { res.end(JSON.stringify({ ok: false, error: 'Authorization required: the script owner has not granted permission' })); return; }
      if (fault.mode === 'slow' && fault.count-- > 0) await new Promise((r) => setTimeout(r, 800));
      let out;
      try { out = sandbox.doPost({ postData: { contents: body } }).getContent(); } catch (e) { out = JSON.stringify({ ok: false, error: String(e) }); }
      if (fault.mode === 'crashAfterWrite' && fault.count-- > 0) { req.socket.destroy(); return; } // wrote the rows, the answer never arrives
      res.setHeader('Content-Type', 'application/json'); res.end(out);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/exec`, secret, book, mails, log, props,
    setFault: (f) => { fault = { ...f }; }, close: () => new Promise((r) => server.close(r)),
    sheet: (n) => book.getSheetByName(n),
  })));
}
module.exports = { startBridge, makeBook };
if (require.main === module) {
  const seed = JSON.parse(fs.readFileSync(process.env.SCHEDULE_FIXTURE || '/workspace/fixtures/schedule-2026.json', 'utf8'));
  startBridge({ seed, port: Number(process.env.PORT || 8788) }).then((b) => console.log('mock bridge at', b.url, 'secret', b.secret));
}
