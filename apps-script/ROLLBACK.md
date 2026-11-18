# Rollback and manual intake plan

Any time the sheet hookup misbehaves:
1. **Stop writes:** in Render, remove `SHEETS_WEBHOOK_URL` (or set the script's `SECRET` to something else). Paid orders stay in the
   server queue as "pending" and an alert fires. Nothing is lost: the server keeps the order JSON and retries when the hookup is back.
2. **Manual intake:** the raw order JSON of every attempt is in the ONLINE ORDERS RAW LOG tab and in the confirmation email Samantha
   receives. She (or Botschild on request) enters the two rows by hand, using any row in ONLINE ORDERS as the template.
3. **Dates:** set `DATE_GUARD=legacy` to fall back to the built-in route model (blackouts in config.js still apply). Do not do this
   unless the ROUTE CALENDAR is wrong, because strict mode is the one that follows Samantha's calendar and capacity.
4. **Undo a row:** delete the two rows in ONLINE ORDERS. The 30-minute checker will email "paid order missing from the schedule".
   Fix the order or refund it.
5. SCHEDULE 2026 is never written by the bridge, so removing the bridge cannot damage it.
