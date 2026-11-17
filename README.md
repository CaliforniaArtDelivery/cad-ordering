# California Art Delivery — Online Ordering (prototype)

Mobile-first, 4-step booking flow (What are we moving? → Where are we going? → Choose your date / Shipping details → Review & pay) plus an admin page. Full details in FLOW_SUMMARY.md; Render deployment in DEPLOY.md.

## Run
```bash
npm install
npm start              # http://localhost:3000   admin: http://localhost:3000/admin?key=<your ADMIN_KEY>
npm run e2e            # headless end-to-end test (needs Playwright, a dev dependency), writes screenshots/
```
Env vars: `PORT`, `BASE_URL`, `ADMIN_KEY` (required for admin: a long random value, 16+ characters; there is no default and admin stays off without it), `TEST_MODE=1` (allows the mock card / ACH / wallet payment step; without it and without Stripe, payments are refused), `STRIPE_SECRET_KEY` (**sk_test_ only**, live keys are refused).

## Pricing
- Official 2025 published rate cards (paintings by quantity, sculpture by weight, furniture/décor by type and size).
- CAD members get 25% off published rates ($200/month prepaid credit).
- An additional 10% off for orders of $1,000 or more applies only to jobs that are all furniture and/or décor (the footnote is on the Furniture & Décor card).
- Declared value is required per piece (in-CA jobs). Pieces up to $50,000: mandatory declared value protection at 1.5%. Over $50,000: no protection; high-value handling +100% to +600% on that piece's price.
- Shipping (out-of-state only) and any job with an address outside California: custom quote from Samantha, fully insured through CAD's shipping partners. Within California, CAD always provides white-glove delivery.

## Payment
- Paid in full at booking.
- Orders of $3,000 or more: 50% at booking, 50% due at pickup (shown on review and in emails).
- No trade accounts and no “Bill my account” option.
- Card and ACH bank payment (`us_bank_account`). Customers can save a payment method for future orders (Stripe customer + `setup_future_usage`). Stripe is test-mode only; a mock card/ACH fallback is used when no test key is set.

## Pickup and delivery special instructions
Every booking captures on-site details in the flow — no chasing after the fact. Pickup and Delivery (or Installation) each ask only for the common things: required on-site contact name and phone, access hours, and quick toggles for loading dock, elevator, and stairs (flights appear if there’s no elevator). Anything rare — COI needs, gate codes, parking — goes in one free-text Special instructions box. The same details appear on review, in confirmation emails, and in the CSV `PU Notes` / `DE Notes (stairs etc.)` columns.

## Confirmation
Standard orders auto-confirm at checkout as soon as the customer pays (including ACH). There is no human confirmation step. Only rush and dedicated-trip quotes go to Samantha to set a price before payment.

## Rush and dedicated trips
These are a “request a quote” path, not auto-confirmed. The customer sees an estimated range of 1.5× to 2× the regular rate. The order is saved as pending CAD approval, with no payment until an admin sets a final price on `/admin?key=<ADMIN_KEY>` and a payment-link email is written to `outbox/` (never sent). Dedicated trips must not displace existing scheduled jobs.

## Files
- `config.js` — 2025 published rates (from the Notes/Info tab of the CAD SCHEDULE sheet), payment policy, route-week anchor (Nov 16 = NorCal), zone-based route days, blackout dates, time windows.
- `lib/pricing.js` — server-side quote (authoritative) using the painting, sculpture, and furniture rate cards. Rush/dedicated return a 1.5×–2× range, not a final price (Samantha sets the price).
- `lib/scheduling.js` — zone detection, alternating weeks, Monday = LA day both directions, documented midweek route days. A simple OC Monday stop (van leaving or returning to the Irvine hub) is limited to 1–2 standard items; larger OC jobs use Thursday of a SoCal week.
- `lib/schedule.js` — maps an order to the SCHEDULE 2026 columns A–AJ, appends to `data/schedule-2026.csv` only after payment.
- `lib/email.js` — confirmation / reminder / ETA / quote-received / quote-approved (with payment link) → `outbox/*.html` + console. Nothing is sent.
- `data/orders.json` — order store. `data/customers.json` — saved payment methods. `uploads/` — photos.
- The real Google Sheet is never written.

## Paloma's Home Furnishings partner flow (`/palomas`)
One-page order form for Paloma's showroom staff (Chad, Nov 16 2026). Placed-by dropdown (Arnie / Heather / Carl / Other + name), exactly one pickup (Salinas warehouse, 329 Rianda St, default; or the Carmel-by-the-Sea showroom), a catalog from palomascarmel.com (`lib/palomas-catalog.json`, thumbnails in `public/palomas/thumbs/`) plus custom items, full client delivery details, and pickup/delivery days.
Pricing reuses the engine with member code `PALOMAS` (CAD's 25% member rates, standard price shown struck through), then: partnership price of $1,000+ → additional 10% off; "Price sensitive client" box → additional 15% off what remains. Declared value protection (1.5% up to $50,000) is a separate required line and is never discounted; over $50,000 there is no protection line (handling is folded into the piece price). Out-of-state delivery becomes a Shipping quote request. Orders confirm on submit, are billed to Paloma's (no online payment), and flow into the same orders / emails / admin / schedule CSV as every other order. Code: `lib/palomas.js`, routes in `server.js`, UI in `public/palomas/`. Tests: `scripts/palomas-test.js` (price math + pipeline), `scripts/palomas-e2e.js` (browser, desktop + iPhone).
