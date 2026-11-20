# California Art Delivery — Online Ordering (prototype)

Mobile-first, 4-step booking flow (What are we delivering? (heading follows the chosen service) → Where are we going? → Choose your date / Shipping details → Review & pay) plus an admin page. Full details in FLOW_SUMMARY.md; Render deployment in DEPLOY.md.

## Run
```bash
npm install
npm start              # http://localhost:3000   admin: http://localhost:3000/admin?key=<your ADMIN_KEY>
npm run e2e            # headless browser + API suite for the one-piece order flow (needs Playwright), writes screenshots to $SHOTS
npm run smoke          # production-like local smoke test: quote, order, test-mode payment, confirmation, emails, admin, schedule sheet
npm run test:all       # pricing, browser/API suite, smoke, date-guard rules, sheet bridge
```
Env vars: `PORT`, `BASE_URL`, `ADMIN_KEY` (required for admin: a long random value, 16+ characters; there is no default and admin stays off without it), `TEST_MODE=1` (allows the mock card / ACH / wallet payment step; without it and without Stripe, payments are refused), `STRIPE_SECRET_KEY` (**sk_test_ only**, live keys are refused).

## Pricing
- Official 2025 published rate cards (paintings by quantity, sculpture by weight, furniture/décor by type and size).
- CAD members get 25% off published rates ($200/month prepaid credit).
- An additional 10% off for orders of $1,000 or more applies only to jobs that are all furniture and/or décor (the footnote is on the Furniture & Décor card).
- Declared value is required per piece (in-CA jobs). Pieces up to $50,000: mandatory declared value protection at 1.5%. Over $50,000: the piece's normal price + 0.75% of its declared value, built into one price (no separate line or note). Every entry is one piece; there is no quantity (use Duplicate).
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
One-page order form for Paloma's showroom staff (Chad, Nov 16 2026). Placed-by dropdown (Arnie / Heather / Carl / Other + name), exactly one pickup (Salinas warehouse, 329 Rianda St, default; or the Carmel-by-the-Sea showroom), a catalog from palomascarmel.com (`lib/palomas-catalog.json`, thumbnails in `public/palomas/thumbs/`) plus custom items, full client delivery details, and pickup/delivery days (first 6 shown, "More dates" up to 14, "Later date" for anything further; same scheduling rules as the main site).

**Pricing** reuses the engine with member code `PALOMAS` (CAD's 25% member rates). Each line shows the standard price struck through next to the partnership price. Delivery orders of $1,000 or more (basis: the delivery subtotal after the 25% partnership discount) get an additional 10% off the whole delivery price. A discreet unlabeled chevron next to the total reveals "Manager's courtesy (−15%)", an additional 15% off what remains (no approval). The 10% / 15% extras are spread across the line items so every piece has an all-in price; rounding remainder goes on the last line and the lines add up to the total exactly. **No declared value** is collected for Paloma's (no field, no protection, and CAD's over-$50,000 high-value handling rule is not applied since it depended on that input). Each catalog piece is priced at the CAD furniture tier (small/light, medium/average, large/heavy; accents xs–xl) decided per piece against a typical piece of its type, using the price card's definitions; the tier, published dimensions and a one-line reason for every piece are in `lib/palomas-tiers.json` (audit data), and the page never shows tier names. Standard sofas/loveseats are medium; big sectionals, heavy copper case pieces and oversized chairs lean large. Custom items default by type (coffee tables, desks, armoires, hutches, beds, large sectionals and sculpture types start at large; others medium); there is no size, oversized or value input. The automatic stairs fee uses the same published dimensions (main-site size rule), so an 85" sofa is $100/flight and a 72" desk $50/flight.

**Access**: how do we get in (ground / steps / stairs / elevator / not sure) with only the relevant follow-ups: stairs → flights; elevator → floor, freight or passenger, must it be reserved; optional building access hours / restrictions. Notes & special instructions is a single field (gate code, parking, who to call, where it goes, anything tight). They are saved in the same fields the main site uses (`hours`, `serviceElevator`, notes) and appear in the schedule's "DE Notes". **Stairs** are priced up front with the main site's rule (`config.pricing.accessFees`): per flight, per piece, large pieces only, by the piece's largest dimension (over 80" $100, 72–80" $50; half flight = 0.5). Catalog dimensions are used when listed; a large-tier piece with no listed dimensions is priced at the 72" rate. The fee is not partnership-discounted and counts toward the $1,000 / 10% / 15% math. Client block: one required client (name, phone, email) plus an optional "+ Add client" second block (saved as `contact2` and in the delivery notes); one delivery address.

**Access-fee note**: one sentence, "Today’s price covers the delivery as quoted." (`ACCESS_FEE_NOTE`), used on the payment page and emails instead of "Paid in full at booking"; it does not imply stairs are confirmed later. Elevator branch also asks "Any steps before or after the elevator?" (Yes + how many / No / Not sure); the answer goes to the DE Notes (more than 3 steps or Not sure is flagged for CAD to confirm). The applied "Manager's courtesy" line stays visible on the summary, payment page and receipt; the control is a small unlabeled chevron (aria-label "More") that stays collapsed until staff enter the staff code; the checkbox only exists on the page while expanded, and when unchecked nothing about the courtesy appears anywhere.

**Billing** (pay-now is the default, same card checkout/endpoint as the main site, `POST /api/orders/:id/pay`; Stripe redirect or TEST_MODE mock): (1) client pays now: button "Pay & lock in delivery", payer = client (name/email from the delivery info); (2) "Paloma's Pay" (hidden behind a second unlabeled chevron under "Client pays now"): same card flow, payer = Paloma's (palomas@palomascarmel.com); (3) small link "Client can't pay now? Email them a payment link.": order is created as "Awaiting payment — not scheduled until paid", the client gets a `payment_link` email (`/?order=ID&pay=1`), and one `payment_reminder` email per day goes out until paid (in-process timer, 15 min tick, capped at 30 reminders; `POST /api/admin/payment-reminders/run` with the admin key triggers a run, optional `asOf`). Paying the link confirms the order and puts it on the schedule.

**Staff code**: both unlabeled chevrons show a neutral "Code" password field first. The code is checked on the server (`POST /api/palomas/unlock`; only a SHA-256 of the lower-cased word is in `lib/palomas.js`, override with `PALOMAS_STAFF_CODE_SHA256`; rate limited), case-insensitively; `/api/palomas/quote` ignores the courtesy and `/api/palomas/orders` returns 403 for the courtesy or Paloma's Pay without it. Unlocked state lasts for the page session.
**Staff / employee discount code (Nov 19 update)**: the order summary now has a visible field labeled "Staff / employee discount code" with an Apply button, above the payment section (the summary's old unlabeled chevron is gone; the payment chevron for Paloma's Pay is unchanged). A valid code (same server check, same rate limit) applies Manager's courtesy (an extra 15% off what is left after the partnership price and the 10%); the checkbox and "Remove code" turn it off. Server discount codes from `config.discountCodes` (JT, ...) never apply to Paloma's orders. See `scripts/palomas-stacking-test.js`.

**Remove an item (Nov 19 update)**: every item row has a visible "✕ Remove" button (44px tap target); removing recomputes the estimate at once and shows "Removed … Undo". Removing the last item leaves an empty list and Next stays blocked until an item is added.

**Stripe** (test mode only): with `STRIPE_SECRET_KEY` (`sk_test_…`) set, pay-now and the emailed payment link use Stripe Checkout; Paloma's orders omit `payment_method_types` so Checkout offers every method enabled in the Stripe Dashboard (cards, Apple Pay, Google Pay, Link, bank debit, …). `POST /api/stripe/webhook` (needs `STRIPE_WEBHOOK_SECRET`, events `checkout.session.completed` and `checkout.session.async_payment_succeeded`) marks the order paid and confirmed even if the client never returns; the return URL (`/verify`) does the same. `BASE_URL` must be the public site URL. Without a key, TEST_MODE uses the mock card/wallet flow. Helpers: `lib/stripe-checkout.js`.

Tests: `node scripts/palomas-test.js` (price math, $999.99 / $1,000.00 / $1,000.01, per-item rounding, access, three payment paths, reminders, copy rules; needs a local server with `ADMIN_KEY`, `TEST_MODE=1`) and `node scripts/palomas-e2e.js` (desktop + iPhone browser walk-through, screenshots in `screenshots/palomas-*.png`).
