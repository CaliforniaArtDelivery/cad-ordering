# Hooking online orders to the CAD schedule sheet (one-time, about 10 minutes, CAD Google account)

Nothing in this repo can create Apps Script projects or Render env vars for you, so these steps are done once by a person
signed in as the CAD account (contact@californiaartdelivery.com) and by whoever owns the Render dashboard.
The script never edits or moves any existing row or tab. It only creates and appends to its own tabs:
ROUTE CALENDAR, ONLINE ORDERS, TEST ORDERS, ONLINE ORDERS RAW LOG.

## A. Test against the TEST COPY first
1. script.google.com > New project, name it "CAD online orders bridge". Paste all of `apps-script/Code.gs`.
2. Project Settings > Script properties, add:
   - `SECRET` = a long random string (60+ characters). Keep it out of email/chat.
   - `TARGET_SPREADSHEET_ID` = `1uni9oBqpVTEFyhyq8QZhdel2NiUTro5P818I57OfTRY` (TEST COPY)
   - `ALERT_EMAIL` = `chadsbotchild@mail.grokbot.com` (CAD inbox is always alerted too)
3. Run `installTriggers` once (approve the Sheets, Mail, Script-trigger permissions). It adds the 30-minute `verifyAll` checker.
4. Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone. Copy the `/exec` URL.
5. Render (service cad-ordering-test) > Environment: `SHEETS_WEBHOOK_URL` = that URL, `SHEETS_WEBHOOK_SECRET` = the same SECRET,
   `SHEETS_ALERT_EMAIL` = contact@californiaartdelivery.com. Leave `DATE_GUARD` unset (legacy) until step 6.
6. Seed the calendar (only adds missing dates, never overwrites):
   `SHEETS_WEBHOOK_URL=<exec url> SHEETS_WEBHOOK_SECRET=<secret> node scripts/seed-calendar.js 240`
   Samantha then edits the ROUTE CALENDAR tab (OPEN/CLOSED, areas, capacity, crew, vehicle). Then set `DATE_GUARD=strict`.
7. Place a few test orders on the test site. Rows appear in TEST ORDERS (mock payments) or ONLINE ORDERS (real payments).

## B. Point at the live schedule sheet (only after Samantha OKs the layout and the test passes)
1. Change `TARGET_SPREADSHEET_ID` to `1E4PDjudgBIXnuOtvHO-Ywc4Fp-Gxiy5qr6yGI_4fXhg` (the new tabs are created next to SCHEDULE 2026).
2. Re-deploy (Deploy > Manage deployments > Edit > New version). Keep the same URL.
3. Check the admin page /api/admin/date-guard (needs the admin key) shows mode `strict`, a fresh calendar, no error.

## What the owner has to know
- Orders are confirmed to the customer only after the sheet read-back matches. Until then the order shows "pending".
- 3 failed attempts = "exception": an alert email goes to CAD and the bot inbox, and the order stays queued and keeps retrying.
- Capacity for a date = ROUTE CALENDAR capacity minus job rows on SCHEDULE 2026 and ONLINE ORDERS minus live holds.
