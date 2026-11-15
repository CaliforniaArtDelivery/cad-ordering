/** Where the prototype writes its local files (orders, CSV schedule, outbox emails, uploads).
 *  Defaults to the app folder. On a host with a persistent disk set STORAGE_DIR to the mount path.
 *  Never writes anywhere else (and never to the real CAD Google Sheet). */
const fs = require('fs');
const path = require('path');
const ROOT = process.env.STORAGE_DIR || path.join(__dirname, '..');
const dir = (name) => { const d = path.join(ROOT, name); fs.mkdirSync(d, { recursive: true }); return d; };
module.exports = { ROOT, dir };
