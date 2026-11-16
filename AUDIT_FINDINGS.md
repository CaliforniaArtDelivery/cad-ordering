# CAD Ordering App — Pre-flight QA + Copy Audit

Audited: commit `155ab6d` (the live build; live `/app.js` md5 matches HEAD). Date: Mon Nov 16, 2026, ~2 AM PT.
Method: read every view, label, helper, error and email template in `public/app.js`, `server.js`, `lib/*.js`, `config.js` and `public/styles.css`. Then ran the committed build locally (`PORT=3100`, `STORAGE_DIR=/tmp/auditstore`, from a `git archive` copy so the repo and `data/` were untouched) and probed `/api/quote`, `/api/availability`, `/api/orders` and `/pay` with edge cases.
**Originally read-only** (fixes came later; see Fix status). The access, stairs and elevator section (app.js:719–733, plus the in-progress uncommitted `public/access.js` and the server.js, email.js and schedule.js diffs) is being rebuilt by another worker. Its internals are noted only in §4 and were not audited.

Counts: **P0 = 19 · P1 = 35 · P2 = 24** (78 total). Line numbers are for HEAD `155ab6d`.

---

## Fix status (Nov 16, 2026)

Commits (local, not pushed): `95cd8a6` phase 1 · `6fd85e3` access fixes · `3d75ab9` + follow-up phase 2. `node scripts/e2e.js` (with `scripts/audit-regression.js`) ends with `errors: []`.

| ID | Finding | Status | Notes |
|----|---------|--------|-------|
| P0-1 | Street names override ZIP for routing | Fixed in phase 1 | ZIP first, then the city field only; regression tests for every bad address |
| P0-2 | Server trusts the client’s date and fields | Fixed in phase 1 | Blackout, past, non-route day, delivery date, W×H×D, contact role, photos, stairwell fit checked server-side |
| P0-3 | Public admin key | Fixed in phase 1 | No default; ADMIN_KEY from env (render.yaml sync:false); refuses unset/short/cad-admin; key file /workspace/secrets/cad_admin_key.txt |
| P0-4 | “Included” protection is a paid line | Fixed in phase 2 (app.js) (copy) · Needs Chad’s decision | Copy now says “1.5% … added to your price”. Mandatory vs optional and the “from $200” prices are Chad’s call |
| P0-5 | “No approval step” | Fixed in phase 1 + Fixed in phase 2 (app.js) | “Your job is booked as soon as payment goes through…”; config notice is the rate-card line |
| P0-6 | Instant pay on jobs notes say CAD confirms (over 700 lb, ≥72" sculpture) | Needs Chad’s decision | Make them quote requests, or drop the “may apply” sentence |
| P0-7 | Wrong quote-received email | Fixed in phase 1 | Template per reason, no fake range, no “(she may consult Chad)” |
| P0-8 | “Someone else” payer does nothing | Fixed in phase 1 (emails) · Needs Chad’s decision | Payer now gets the quote notice / receipt copy. Whether the buyer still pays or a payment link goes to the payer is Chad’s call |
| P0-9 | Banned “crating” | Fixed in phase 1 + Fixed in phase 2 (app.js) | Server, lib, email and app.js (review line, dead branches, placeholder) |
| P0-10 | “Monday is always an LA day” / internal route labels | Fixed in phase 1 + Fixed in phase 2 (app.js) | Customer area names; LA line only for LA; no zone codes on the route line |
| P0-11 | “nobody has to chase anything” | Fixed in phase 2 (app.js) |  |
| P0-12 | “next booking is one tap” | Fixed in phase 2 (app.js) (copy) · Needs Chad’s decision | Now “Save this payment method”. Reusing saved methods isn’t built; Chad decides build vs hide |
| P0-13 | “Used for insurance” | Fixed in phase 2 (app.js) | Shipping coverage line should still be confirmed with the partner |
| P0-14 | ETA cadence promises | Fixed in phase 1 + Fixed in phase 2 (app.js) | “We’ll be in touch before your date to confirm the arrival window.” |
| P0-15 | Email prices without commas | Fixed in phase 1 |  |
| P0-16 | Refresh after paying can duplicate a job | Fixed in phase 1 (server idempotency) + Fixed in phase 2 (app.js) (Done survives refresh) |  |
| P0-17 | Stripe cancel says “Your quote is approved” | Fixed in phase 2 (app.js) |  |
| P0-18 | Unpriced items show a fake price | Fixed in phase 2 (app.js) | “Priced by CAD” in review, Done and dock |
| P0-19 | Test card prefill / mock Apple Pay | Fixed in phase 1 + Fixed in phase 2 (app.js) | Only with TEST_MODE=1; otherwise “Online payment isn’t switched on yet”. Going live on Stripe is Chad’s call |
| P1-1 | Silent defaults | Fixed in phase 2 (app.js) (partly) · Needs Chad’s decision | Client type and Same-as-me role no longer preselected. Hang height “eye level”, 59" center, furniture Sofa/Medium, décor kind change the flow or price: Chad |
| P1-2 | Install only turns sofas into paintings | Fixed in phase 2 (app.js) | Switch is blocked with an explanation |
| P1-3 | Furniture has no size fields | Needs Chad’s decision | Adds a question |
| P1-4 | Unknown weight skips heavy photo | Fixed (Chad’s decision, second review) | Weight “Not sure” now requires a photo (“Add a photo so we can plan for the weight.”), browser and server; 501 lb+ still requires one |
| P1-5 | Rush/dedicated text on every quote | Fixed in phase 2 (app.js) |  |
| P1-6 | Multiplier math shown | Fixed in phase 1 + Fixed in phase 2 (app.js) | “Estimated range”, no 1.5×–2× |
| P1-7 | Dedicated-trip internal-speak | Fixed in phase 2 (app.js) |  |
| P1-8 | Stairwell-fit consent is harsh | Needs Chad’s decision | Policy wording |
| P1-8b | Stairwell-fit trigger | Fixed (access fixes) | Real stairs (incl. elevator + stairs); “A few steps” only for a heavy (over 150 lb) piece over 80" |
| P1-9 | Hang summary repeats | Fixed in phase 2 (app.js) |  |
| P1-10 | Install address “Drop-off” | Fixed in phase 1 |  |
| P1-11 | Cross-region jargon | Fixed in phase 1 |  |
| P1-12 | Internal names (Chad, Irvine hub) | Fixed in phase 1 + Fixed in phase 2 (app.js) |  |
| P1-13 | Membership pitch to members | Fixed in phase 2 (app.js) | Shown only while the member toggle is off |
| P1-14 | Cancellation promise | Fixed in phase 2 (app.js) (partly) · Needs Chad’s decision | “we’ll take care of it” removed; policy link needs the policy |
| P1-15 | “Fully insured” | Needs Chad’s decision | Confirm wording with the shipping partner |
| P1-16 | “Final price is confirmed by CAD” | Fixed in phase 1 |  |
| P1-17 | “Other” item pricing vs instant pay | Needs Chad’s decision |  |
| P1-18 | Estimate changes between steps | Fixed in phase 2 (app.js) · Needs Chad’s decision | Step 1 dock says “Estimate · before access”. Sales tax treatment is Chad’s |
| P1-19 | Value cliff at $50,000 | Needs Chad’s decision |  |
| P1-20 | “Referring partner” payer goes nowhere | Needs Chad’s decision | Same decision as P0-8 |
| P1-21 | Silent upload failures | Fixed in phase 2 (app.js) | Toast: “That photo didn’t upload…” |
| P1-22 | Dock price truncates | Fixed in phase 2 (app.js) | No ellipsis; long prices step down in size |
| P1-23 | Seg buttons truncate | Fixed in phase 2 (app.js) | Buttons wrap |
| P1-24 | Shipping review layout | Fixed in phase 2 (app.js) | No blank “·” bits; formatted phones |
| P1-25 | Contact role labels | Fixed in phase 2 (app.js) | “Describe their role”; “Interior designer” in both lists |
| P1-26 | No condition question | Needs Chad’s decision | New question |
| P1-27 | No packing/debris question | Needs Chad’s decision |  |
| P1-28 | Holidays end Jan 1, 2027 | Fixed in phase 1 | Blocked through Dec 31, 2027 (confirm with Samantha) |
| P1-29 | Same-day copy | Fixed in phase 2 (app.js) |  |
| P1-30 | Install helper on non-install services | Fixed in phase 2 (app.js) |  |
| P1-31 | Description placeholders | Fixed in phase 2 (app.js) | Wine removed; storage example removed |
| P1-32 | “Your details” under “Where are we going?” | Fixed in phase 2 (app.js) | H1 “Contact and addresses” |
| P1-33 | Décor size classes unexplained | Needs Chad’s decision | Needs the size ranges |
| P1-34 | Resume after refresh lands on step 1 | Fixed in phase 2 (app.js) | Step is restored (capped where answers are still needed) |
| P2-1 … P2-14 | Placeholders and copy polish | Fixed in phase 2 (app.js) | All done (P2-6 email titles were phase 1) |
| P2-15 | Mixed voice | Needs Chad’s decision | Tone decision for Chad/Dot |
| P2-16 | “Mobile” vs “Phone” | Fixed in phase 2 (app.js) | On-site contacts say Mobile; the international customs contact keeps Phone |
| P2-17 | “REQUIRED” on nearly every field | Needs Chad’s decision | Design decision |
| P2-18 | “anything fragile or valuable” | Fixed in phase 2 (app.js) |  |
| P2-19 | Service name capitalization | Needs Chad’s decision | Names come from config/brand |
| P2-20 | “handler” in emails | Fixed in phase 1 |  |
| P2-21 | Approval email double space / “request request” | Fixed in phase 1 |  |
| P2-22 | “Request quote” vs “Request a shipping quote” | Fixed in phase 2 (app.js) |  |
| P2-23 | Two “weight not sure” notes | Fixed in phase 1 |  |
| P2-24 | “Glass is assumed for mirrors.” | Fixed in phase 2 (app.js) |  |

---

## Top 10 (fix first)
1. **Street names override ZIP for routing**, so real customers get the wrong route days (P0-1). For example, 1800 Laguna St, SF 94109 is routed to Orange County, Marina del Rey is routed to Carmel and 500 Davis St, SF to Sacramento.
2. **The server books any date** (P0-2). It accepts Christmas (a blackout), 2020-01-01, a Sunday in LA, no dimensions and no contact role. Only the browser enforces route days.
3. **The admin key is public** (P0-3). It defaults to `cad-admin`, it's hard-coded in render.yaml for the live site, and it's printed in the README, DEPLOY.md and FLOW_SUMMARY.md. Anyone with it can see customer PII and approve quotes at any price.
4. **"Declared value protection (1.5%) is included"**, but it's a mandatory paid line (P0-4). A $50,000 piece adds $750, and "from $200" is never reachable.
5. **Instant-pay jobs promise "No approval step"** while the notes say "CAD confirms" (P0-5, P0-6). A 5,000 lb sculpture is booked and paid at $1,000 with no review. The 72"+ "additional fee may apply" note also shows on paid jobs.
6. **Wrong quote emails** (P0-7). Weight-unknown and custom-request quotes email "Thanks for requesting a rush or dedicated trip quote", with "Estimated range $75.00–$75.00 (1.5× to 2×…)" and "(she may consult Chad)".
7. **"Who's paying? → Someone else"** still makes the buyer pay on the spot (P0-8). The named payer gets no email or link, and the confirmation goes only to the buyer.
8. **Banned word "crating"** appears on every Shipping review line ("crating not sure"), and "crated" in two notes (P0-9).
9. **"Monday is always an LA day, so LA customers can book either Monday."** shows to Bay Area, Carmel, Tahoe and San Diego customers (P0-10). Route labels also expose internal notes such as "LA · heading NW" and "OC · simple stop".
10. **Overclaims Chad already flagged are still live** (P0-11 to P0-14). These include "No approval step", "nobody has to chase anything", "your next booking is one tap" (nothing reuses a saved card), "Used for insurance", the 4-step ETA cadence and "Fully insured".

---

## P0 — wrong, embarrassing, or loses money

**P0-1 Zone detection matches street names before the ZIP code.**
- **Where:** lib/scheduling.js:73 (`cityOrder` loop tests `` `${city} ${street}` `` against the city regexes at :32–44 before the ZIP).
- **Probe results:**
  - `1800 Laguna St, San Francisco 94109` → zone OC. SF customers get Orange County Mondays and Thursdays.
  - `100 Marina Blvd, SF 94123` → Carmel.
  - `4000 Lincoln Blvd, Marina del Rey 90292` → Carmel (Carmel days offered to an LA customer).
  - `500 Davis St, SF` → Sacramento.
  - `1 Fremont St, SF` → EastBay.
  - `200 Lincoln Ave, Palo Alto` → Sacramento.
  - `123 Orange Grove Blvd, Pasadena` → OC.
  - `Orangevale 95662` → OC.
  - `1 Carmel Ave, Palm Springs` → Carmel.
  - `50 Sonoma Ave, Los Angeles` → NapaWine.
- **Why:** This is the 94109 route-day mismatch. Customers book days the van isn't there.
- **Fix:**
  1. Use the ZIP first (5-digit ZIP → zone).
  2. Match only `city` (never `street`), and use whole-name anchors (`^san francisco$`).
  3. Fall back to city only when there's no ZIP.
  4. Add these cases to e2e.

**P0-2 Server trusts the client's date and fields.**
- **Where:** server.js:134 (validate only checks `schedule.date` exists).
- **Probe:** POST /api/orders accepted all of these with `awaiting_payment`:
  - `2026-12-25` (blackout)
  - `2020-01-01`
  - Sunday `2026-11-22` for an LA address (wrong region)
  - a painting with no W/H/D
  - an empty `contactRole`
- **Fix:** In `validate()`:
  - Require `schedule.date ∈ sched.availableDays(addr,{order}) ∪ rushDays`.
  - Require the delivery date to be in the dropoff-leg days.
  - Require W/H/D (`needsDims`) and `contactRole` server-side, matching app.js:955/1006.

**P0-3 Public admin key on the live site.**
- **Where:** render.yaml:19–20 (`ADMIN_KEY: cad-admin`), server.js:14 default, README.md:8, DEPLOY.md:5/12, FLOW_SUMMARY.md:3. The server log also prints the admin URL.
- **Why:** Anyone can open `/admin?key=cad-admin`, read every customer's name, phone, address and art values, and approve a quote at any price. /outbox uses the same key.
- **Fix:**
  1. Set a long random `ADMIN_KEY` in the Render dashboard (not in render.yaml).
  2. Remove the default (refuse to start without it in production).
  3. Scrub it from the docs.
  4. Stop logging it.

**P0-4 "Included" protection is actually a paid line, so "from" prices are unreachable.**
- **Where:**
  - app.js:578 `'Declared value protection (1.5%) is included.'`
  - app.js:484 `'...is included on every piece valued $50,000 or less.'`
  - app.js:697 `from $200 / from $75 / from $275`
  - server.js `declaredValueProtection` is forced on
  - config.js:126 says `optional: true`
- **Probe:** One painting valued at $5,000 is $200 + $75 = $275. At $50,000 it's $950.
- **Why:** "Included" reads as free. The value field is required, so every in-CA order pays it. The "from $200" price never happens, and code and config disagree on whether it's optional.
- **Fix:**
  - Copy (app.js:578): "Declared value protection: 1.5% of the declared value, added to your price."
  - Copy (app.js:484): "Declared value protection is 1.5% of each piece's declared value (pieces up to $50,000)."
  - Have Chad decide mandatory vs. optional. If mandatory, set `optional:false` in config.js and change "from" to, e.g., "from $200 + 1.5% protection".

**P0-5 "Your job is confirmed the moment you pay. No approval step."**
- **Where:** app.js:827. The global notice from config `exampleRatesNotice` 'Final price is confirmed by CAD.' (app.js:701) says the opposite.
- **Fix:**
  - Pay sub: "Your job is booked as soon as payment goes through. We'll email your confirmation right away."
  - Change `exampleRatesNotice` to "Prices are from CAD's published rate card." Or drop it.

**P0-6 Unreviewed instant-pay on jobs the notes say CAD must confirm.**
- **Where:**
  - pricing.js:405/422/487: over 700 lb shows "starting rate shown, CAD confirms" but plan=`full`.
  - pricing.js:406/423/490: sculpture or other piece ≥72" shows "an additional delivery fee may apply. CAD confirms it."
  - Same issue for the furniture "Large / heavy" tier with no weight.
- **Probe:** Sculpture at 5,000 lb → $1,000, paid in full, no review.
- **Why:** You can't say "confirmed, no approval" and "a fee may apply" on the same order. That's a surprise charge.
- **Fix:** Make `over700` and `needsSpecial` part of `unpriced` (pricing.js:535) so they become quote requests ("Reviewed by CAD before you pay"). If not, remove the "may apply" sentence.

**P0-7 Wrong quote-received email for non-rush quotes.**
- **Where:** lib/email.js:97 `` `Thanks for requesting a ${o.quote.quoteKind || 'rush or dedicated trip'} quote. We've sent this to Samantha to set a final price (she may consult Chad).` `` and lib/email.js:31 `Estimated range … (1.5× to 2× the regular rate …)`.
- **Probe:** An unknown-weight sculpture emails "rush or dedicated trip quote", "Estimated range $75.00–$75.00 (1.5× to 2× the regular rate of $75.00)". Custom request → "a custom request quote", "$0.00".
- **Fix:**
  1. Body by kind: "Thanks for your request. Samantha is reviewing the details and will email your price and a payment link, usually within one business day. Nothing is charged until you approve it."
  2. Drop "(she may consult Chad)" everywhere (email.js:97, admin is fine).
  3. Show the range line only when `tripPremium`. Otherwise show nothing, or "Priced by CAD".

**P0-8 "Someone else" as payer doesn't do anything.**
- **Where:** app.js:842–846, 874–876 (payer captured). The buyer is still shown "Pay $X" (app.js:1162). The confirmation goes only to `contact.email` (email.js send(): `to = order.contact.email`).
- **Probe:** Buyer, pickup contact, recipient and payer were all different people. Only the buyer got the email. The payer got nothing, and so did the on-site contacts.
- **Fix:**
  - Either: when payer ≠ me, submit as "Send payment link to {payer}" (status awaiting_payment, email the payer a pay link, CC the buyer, button "Send payment request to Paul").
  - Or rename the section to "Billing contact (for the receipt)" and send the receipt to both.
  - Also text or email the on-site contacts the date (or at least show "We'll contact {name} to confirm access").

**P0-9 Banned "crating/crated" in customer-facing copy.**
- **Where:**
  - app.js:853/859: every Shipping review piece ends "· crating not sure" (`crateStatus` defaults to `not_sure` at app.js:36, and the question was removed).
  - app.js:872, pricing.js:596: "Pieces may be crated or soft-packed as needed."
  - lib/shiptext.js:3 (Samantha-facing)
  - Dead customer paths still say "+ crating quote", "Custom crating", "Estimate + crating" (app.js:471, 830, 914, 1141).
  - app.js:658 placeholder "Pick up 3 crates from storage and hold them".
- **Fix:**
  - Delete the crateStatus segment from line 859.
  - Line 872/596: "Our shipping partner chooses the right packing for each piece."
  - Remove the S.crating branches.
  - Placeholder: "e.g. Collect two pieces from a framer and deliver them with the rest".

**P0-10 NorCal customers told "Monday is always an LA day".**
- **Where:** app.js:778–780 (`intro` is shown whenever no OC simple stop is in the list. Probe: SF, Carmel, Tahoe and Palm Springs all get it).
- **Also:** Route labels from config.js:301–318 go straight into day cards and the promise card: "LA · heading NW", "LA · heading SE", "Central Coast → SB", "OC · simple stop", "SV / SF / Marin". An SF customer sees Friday labelled "East Bay / Napa". Tahoe sees "Sacramento / East Bay". Shown via app.js:776/798/828 using `shortLabel` and `routeLabel`.
- **Fix:**
  - Show the LA sentence only when `avail.zone==='LA'`. Rewrite it for customers: "Los Angeles is served every Monday."
  - Write separate customer labels: Wed "San Francisco & Peninsula", Fri "East Bay, Napa & SF", Thu "Sacramento & Tahoe", Mon "Los Angeles", OC Monday "Orange County". Never use arrows, headings or "simple stop".

**P0-11 "so nobody has to chase anything after you book."**
- **Where:** app.js:746.
- **Fix:** "A few details about each address help us arrive prepared."

**P0-12 "Keep this card or bank account on file so your next booking is one tap."**
- **Where:** app.js:490.
- **Why:** Nothing reads `savedMethods` at checkout (server.js `rememberMockMethod` only stores them). Apple and Google Pay are never saved. This overclaims (Dot test).
- **Fix:** "Save this payment method for future bookings." Or hide the toggle until reuse is built.

**P0-13 "What this piece is worth. Used for insurance." and "for shipping insurance".**
- **Where:** app.js:576–578, server.js:130.
- **Fix:**
  - In-CA: "Its current value. We use it to set declared value protection."
  - Shipping: "Its current value. Our shipping partner uses it for coverage."

**P0-14 Time-update promises with no automation behind them.**
- **Where:** app.js:519 (part of day a few days before, a 2-hour window the day before, a 30–60 min window that morning, a 15-min heads-up), app.js:925 and email.js:94 ("a reminder the day before and a live ETA").
- **Why:** The only ETA is a manual admin email template (email.js:96). There's no reminder job.
- **Fix:** "We'll confirm your arrival window the day before and text when we're on the way." That's only true if Samantha does it today, so confirm with her.

**P0-15 Prices in emails have no commas.**
- **Where:** email.js:28/31/36/37/40–43/75/86/98 use `toFixed(2)`.
- **Probe:** "Total $4050.00", "Paid today (50%) $2025.00".
- **Why:** This breaks Chad's numbers-with-commas rule.
- **Fix:** Use `toLocaleString('en-US',{minimumFractionDigits:2})`, or reuse `fmt()` from app.js.

**P0-16 Refresh after paying can create a duplicate job.**
- **Where:**
  - app.js:1403: sessionStorage is cleared only by "Start a new booking".
  - app.js:1499–1503: a refresh on Done goes back to step 0 with the whole order prefilled and `orderId` lost. Continuing creates a new order and charges again.
  - Server has no idempotency: two concurrent POST /api/orders created CAD-J37511 and CAD-J37512 (the client `busy` flag is the only guard).
- **Fix:**
  1. Clear `cad-order` (or store `confirmedId`) when Done renders, and show the confirmation on reload.
  2. Send an idempotency key (hash of payload + session) and return the existing order if it matches.

**P0-17 Stripe cancel says "Your quote is approved."**
- **Where:** server.js:249 `cancel_url=?order=…&canceled=1` → app.js:1497 opens PayLink → app.js:882 "Your quote is approved. Your job is confirmed the moment you pay."
- **Why:** This happens on a normal (non-quote) order after the customer backs out of Stripe.
- **Fix:**
  - When `canceled=1`: "Payment wasn't completed. Your booking is saved; pay below to confirm it."
  - Show "Your quote is approved" only when `o.approvedAt`.

**P0-18 Unpriced items show a fake price.**
- **Where:** app.js:469/485/912, plus the dock at app.js:1141.
- **Probe:**
  - An unknown-weight sculpture shows "Regular rate $75" (protection only) and the dock shows "$75+ · Estimate + quoted items".
  - A custom request shows "Regular rate $0" and "$0+".
- **Fix:** When the quote is `unpriced` and nothing is rate-carded, show "Priced by CAD", with the dock label "Quote" (as Shipping does).

**P0-19 Live checkout is prefilled with test card and bank numbers and mock Apple/Google Pay.**
- **Where:** app.js:496–503, badge "Test mode · nothing is charged".
- **Why:** This is fine for the test link. It must not ship to customers: mock Apple Pay confirms a job with no payment.
- **Fix:** Gate on `CFG.stripe`. Block real launch until Stripe is live.

---

## P1 — confusing, contradictory, or missing

**P1-1 Silent defaults that answer for the customer** (Dot test: "No default should select…" → **fails**).
- **Where:**
  - Hanging height is preselected "Eye level" (app.js:36 `hangHeight:'standard'`, :439).
  - `centerHeight` is set to 59 silently (app.js:93).
  - Wall type defaults to "Not sure" (app.js:739) and hardware is forced to "Not sure" (app.js:86).
  - "I am a…" defaults to "Collector" (app.js:47), which then sets the "Same as me" role to "Homeowner" even at a gallery pickup (app.js:340–358).
  - Furniture kind defaults to "Sofa", size to "Medium" (app.js:36, :662), and Décor kind to the first in the list (app.js:1352). Each changes the price.
- **Fix:**
  - No preselection. Make hang height and furniture kind/size required ("Please choose one").
  - Default clientType to blank and make it required.
  - "Same as me" should leave the role blank.

**P1-2 Switching to Install only silently turns sculpture, furniture and other pieces into "Painting".**
- **Where:** app.js:1345. The description and value stay, so a Sofa becomes a Painting.
- **Fix:** Block it with a message: "Install only covers wall pieces. Remove {piece} or choose Pickup, Delivery + Install."

**P1-3 Furniture has no size fields.**
- **Where:** app.js:667 and :955 (`needsDims` excludes furniture).
- **Why:** The stairwell-fit check (app.js:418, >80") and access fees never fire for a 96" sofa or an armoire. A dispatcher always asks the length.
- **Fix:** Ask W × H × D for furniture (approximate is fine).

**P1-4 Unknown weight skips the heavy-item photo** (Dot test → **partly fails**).
- **Rule:** Photo required when `weight > 500` (app.js:570, server.js:120). Exactly 500 lb → no photo (consistent with "over 500 lb"). 501 → required. Confirmed.
- **Gaps:**
  - An unknown-weight sculpture goes to review but needs no photo.
  - Furniture and paintings with no weight never trigger it (an armoire with no weight and no photo was accepted).
- **Fix:** Require a photo when `weightUnsure` on sculpture/other, and suggest one for "Large / heavy" furniture.

**P1-5 Rush and dedicated text is shown for every quote type.**
- **Where:** app.js:847: "Rush and dedicated-trip quotes go to Samantha…" also shows for chandelier, custom and unknown-weight quotes.
- **Fix:** "Samantha reviews your request and emails your price with a payment link. Nothing is charged until you approve it."

**P1-6 Multiplier math shown to clients.**
- **Where:** app.js:470, 913 "Quoted range (1.5×–2×)", app.js:800, email.js:31.
- **Why:** Luxury clients don't want to see the markup formula.
- **Fix:** "Estimated range". Drop "(1.5×–2×)", and app.js:800 → "Rush and dedicated trips are priced individually; you'll see the price before paying."

**P1-7 Dedicated-trip copy is internal-speak.**
- **Where:** app.js:799 "without displacing booked jobs", app.js:916 "Dedicated trips are scheduled around existing jobs, not instead of them."
- **Fix:** Toggle hint "A van and crew just for your job, at a time that works for you." Delete line 916.

**P1-8 Stairwell-fit consent is harsh.**
- **Where:** app.js:767: "If it doesn't fit, CAD will leave it at the bottom of the stairs and the full price still applies."
- **Fix:** "I've checked that this piece fits the stairwell. If it doesn't, our team will place it in the nearest safe spot and we'll talk through options." Any penalty belongs in the policy.

**P1-8b Stairwell-fit trigger.**
- **Where:** app.js:418 fires on any stairs (even "3 steps or fewer"), at either stop, including a pickup stair when only the delivery matters.
- **Note:** This is access logic. Hand it to the rebuild.

**P1-9 Hang summary repeats itself.**
- **Where:** app.js:425 + HANG_WHERES:331 → "Higher than eye level — Higher than eye level (ladder needed)".
- **Fix:** Print the pick label only: `Piece 1: Higher than eye level (ladder needed)`.

**P1-10 Install address labelled "Drop-off" in emails.**
- **Where:** email.js:84. Install-only email shows "Drop-off 1 Ocean Ave".
- **Fix:** "Install at" for install_only, "Delivery" otherwise. Never use "Drop-off" (also pricing.js:497).

**P1-11 Cross-region note uses ops jargon.**
- **Where:** pricing.js:497 "Pickup and drop-off are in different regions. North/South exchanges usually take 1–2 weeks and are split across the next opposite-region route days."
- **Fix:** "Your pickup and delivery are in different parts of the state, so delivery is usually 1–2 weeks after pickup."

**P1-12 Internal names in customer emails.**
- **Where:** email.js:97 "(she may consult Chad)", app.js:779 "our Irvine hub".
- **Fix:** Remove both.

**P1-13 Membership pitch shown to people who said they're members.**
- **Where:** app.js:755 renders inside `S.member ? … :` → "Not a member? CAD Membership is $200/month…" only after they tick "I'm a CAD member".
- **Fix:** Move it under the toggle when it's OFF, or drop it from checkout.

**P1-14 Cancellation promise.**
- **Where:** app.js:847 "Need to change or cancel? Reply to your confirmation email and we'll take care of it."
- **Why:** There's no policy yet (pending with Chad), and this implies free cancellation.
- **Fix:** Link the policy: "Need to change or cancel? Reply to your confirmation email. See our cancellation policy." Hold until the policy is written.

**P1-15 "Fully insured through our shipping partners."**
- **Where:** app.js:816/870, pricing.js:599, shiptext.js:17.
- **Why:** This is an unverified absolute claim.
- **Fix:** "Covered by our shipping partner's insurance up to your declared value." Confirm the wording with the partner first.

**P1-16 "Final price is confirmed by CAD." on the item page.**
- **Where:** app.js:701 via config.js `exampleRatesNotice`.
- **Why:** It contradicts instant booking (see P0-5).
- **Fix:** Remove, or "Prices shown are CAD's published rates."

**P1-17 "Other fragile or valuable item" exposes pricing logic and contradicts instant pay.**
- **Where:** app.js:673, pricing.js:488.
- **Why:** "Priced by weight from our sculpture rates… CAD may adjust the final quote after seeing photos" on an instant-pay order.
- **Fix:** Make "other" always a quote. Copy: "Priced by weight. CAD reviews your photos before you pay."

**P1-18 The estimate can change between steps** (Dot test → **mostly passes**).
- **Passes:** The dock and Pay screen use the same `/api/quote`, and install, access, high-value and quote lines all appear. There's no tax line anywhere; confirm CA tax treatment.
- **Fails:**
  - The dock shows the price before Where, so stairs and technical carry appear only after the addresses (expected, but there's no "+ access fees if any" hint).
  - The P0-6 "may apply" fees can still change it after payment.
- **Fix:** Dock label on step 1: "Estimate · before access".

**P1-19 Value cliff at $50,000.**
- **Probe:** $50,000 → $950 total. $50,001 → $400 total (high-value handling +100% instead of 1.5%). Over $1M → +600% = $1,400.
- **Why:** A $50,000 piece pays more than a $50,001 piece.
- **Fix:** Chad should confirm the tiers. Consider charging the max(1.5% protection, handling) or smoothing.

**P1-20 Payer "Referring partner" goes nowhere.**
- **Where:** app.js:842/845.
- **Why:** There's no invoice path (server refuses invoice), so who pays?
- **Fix:** Same as P0-8.

**P1-21 Photo upload failures are silent.**
- **Where:** app.js:1409/1416/1422/1428 (`catch → return`).
- **Fix:** Show "That photo didn't upload. Please try again." `fileFilter` also silently drops HEIC with non-image mimetype.

**P1-22 Dock price can truncate.**
- **Where:** styles.css:152 `.est-total{overflow:hidden;text-overflow:ellipsis}`.
- **Why:** At 320–375px, "$412.50–$550" or "$62,612.50" can show "$412.50–$5…". A truncated price is a wrong price.
- **Fix:** Drop the ellipsis, step the font size down on long values, and keep `white-space:nowrap`.

**P1-23 Segmented buttons truncate.**
- **Where:** styles.css:79 `.seg button{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`.
- **Why:** The 3-way payer seg ("Referring partner") and hardware seg ("CAD brings it") get cut off on small phones.
- **Fix:** Allow wrapping (`white-space:normal`) or stack below 400px.

**P1-24 Shipping review layout.**
- **Where:** app.js:859.
- **Why:**
  - It joins with " · " even when the weight is blank, giving "30 × 40 × 2 in ·  · Painting".
  - Pickup and destination phones are unformatted (app.js:860–861 print the raw `contactPhone`).
- **Fix:** Filter the blanks and use `formatPhone`.

**P1-25 Contact role labels.**
- **Status:** "Pickup/Delivery/Install contact role" works for both "Same as me" and a different person. Confirmed.
- **Gaps:**
  - "Other" free text reuses the same label (app.js:718) with the placeholder "e.g. House sitter".
  - The error says "Please choose the contact's role." when the box is a text field (app.js:1007).
  - The role list says "Designer" while client type says "Interior designer".
- **Fix:**
  - Other label "Describe their role", with error "Please describe the contact's role."
  - Use "Interior designer" in both places.

**P1-26 No condition or damage question** (Dot item).
- **Why:** A dispatcher asks about existing damage, flaking or loose parts before touching a piece.
- **Fix:** Add an optional "Any existing damage or condition notes?" field per piece. It's also used for check-in photos.

**P1-27 No packing or debris question for in-CA white-glove delivery.**
- **Why:** Shipping has "debris removal", but in-CA doesn't say whether we unwrap and remove packing.
- **Fix:** Optional "Unwrap and take away packing" toggle, or state it's included.

**P1-28 Holiday coverage ends Jan 1, 2027.**
- **Where:** config.js:303. Availability shows dates out to April 2027.
- **Why:** Jan 18 (MLK) is offered as an OC Monday, Feb 15 (Presidents Day) is open, and Thanksgiving week relies on two dates.
- **Fix:** Extend the blackout list through 2027 (confirm with Samantha), or cap `showDays` to the covered range.

**P1-29 Same-region delivery copy.**
- **Where:** app.js:554 "Same-day delivery is available when that route serves both areas."
- **Fix:** Fine, but also say "Same-day isn't available between Northern and Southern California" to explain the 1–2 week gap up front.

**P1-30 Item-type helper on non-install services.**
- **Where:** app.js:684/685 "Hung on a wall, so we can install it." shows on Pickup + Delivery and Shipping.
- **Fix:** Show only when `hasInstall()`. Otherwise "Prints and photographs, framed or unframed."

**P1-31 Description placeholders.**
- **Where:** app.js:658 `other: 'e.g. Antique clock, wine collection'`.
- **Why:** Do we carry wine? Confirm with Chad. The `custom` placeholder implies storage ("hold them"), which isn't a listed service.
- **Fix:** `'e.g. Antique clock, Murano glass chandelier'`.

**P1-32 "Your details" sits under "Where are we going?"**
- **Where:** app.js:746–748.
- **Fix:** H1 "Contact and addresses", sub "Who we're working with and where we're going."

**P1-33 Item sizing for "Wall sculptures" and "Tapestries" priced as Wall Decor.**
- **Where:** app.js:663.
- **Why:** They use S/M/L size classes and dimensions, and both feed price. The customer isn't told what S/M/L means for décor.
- **Fix:** Add the dimension ranges to the size labels.

**P1-34 Resume after refresh lands on step 1.**
- **Where:** app.js:39 (`step` isn't persisted).
- **Why:** Data is restored, but the customer lands back on "How can we help?".
- **Fix:** Persist `step` (capped to the last valid step) with the order.

---

## P2 — polish

1. **Region balance:** the address placeholders are SoCal only ("8678 Melrose Ave / West Hollywood / 90069", app.js:711–712) for both pickup and delivery. Use a NorCal example for pickup ("2 Henry Adams St / San Francisco / 94103") and keep the SoCal one for delivery, or alternate Carmel and La Jolla.
2. The business placeholder "e.g. Hamilton Selway" (app.js:761) is LA only. Use "e.g. Hamilton Selway (LA) or Winfield (SF)", or a neutral "Gallery or showroom name".
3. **Phone placeholder "(650) 460-4296"** (app.js:750, 760, 844, 876) looks like a real number. Use "(415) 555-0123", and "(310) 555-0100" elsewhere.
4. app.js:714 "Business or gallery (optional)" has the placeholder "Gallery, showroom or residence". A residence isn't a business, so use "e.g. gallery, showroom, hotel".
5. app.js:742 "Special instructions" placeholder "Gate codes, parking, anything else": parking is already asked above. Use "Gate codes, who to ask for, anything else".
6. The review card title "Pickup special instructions" (app.js:836, email.js:88) contains contact and access, not instructions. Use "Pickup details".
7. app.js:553/783 "Choose your <b>DELIVERY</b> date" / "<b>PICKUP</b>" is in all caps. Use "Choose your delivery date".
8. app.js:570–572 "Photos required: out-of-the-ordinary items." Use "Please add a photo so we can plan the right handling."
9. app.js:674 "…a home, gallery, warehouse, hotel or sculpture garden. Same price either way." Change to "…wherever you want it." and drop "Same price either way."
10. app.js:762 "We love our clients and referrals mean everything to us." Change to "If someone referred you, we'd love to thank them."
11. app.js:756 "Welcome back — we don't need to ask how you found us." Change to "Welcome back."
12. app.js:807 "…with no back-and-forth." Delete it.
13. app.js:525 vs :524: the helper says "Need it before 10am? Tell us…" but the placeholder is "not available before 10am". Use a single example: "e.g. Must be done by noon".
14. app.js:538 "Your date · price confirmed with your quote". Use "Price confirmed with your quote".
15. Mixed voice: "CAD sets…", "Samantha prices…", "We'll…". Pick one: "we" for the company, and name Samantha only in the "who's reviewing" line.
16. "Mobile" (your details) vs. "Phone" (contacts): use "Mobile" everywhere, since we text ETAs.
17. "REQUIRED" in small caps on nearly every field (styles.css:68) is noisy. Mark the optional ones instead ("optional"), as is already done for some.
18. app.js:695 "Fine art, luxury furniture and décor are our specialty, and we handle anything fragile or valuable." Change "anything" to "other fragile or valuable pieces".
19. "Install only" vs. "Pickup, Delivery + Install" capitalization: use "Install Only" or sentence case consistently. The same applies to "Pickup + Delivery".
20. The email "when your handler is on the way" (email.js:94/96): "handler" is odd, so use "our team".
21. email.js:98 "CAD has approved your rush  request" has a double space when it isn't Shipping, and "approved your custom request request" for custom. Use the fixed template "Your price is ready".
22. app.js:1163 "Request quote" (<360px) vs. "Request a shipping quote": shorten consistently to "Request quote".
23. pricing.js:302 vs. :489 give two different "weight not sure" notes for the same case. Use one.
24. The "Glass is assumed for mirrors." helper (app.js:671) is unnecessary for clients, so delete it.

---

## Dot's test cases — results

| # | Test | Result |
|---|------|--------|
| 1 | Install-only never asks for pickup or says balance "at pickup" | **Confirmed passes** for the form, quote and deposit (`balanceWhen: "at installation"`, pricing.js:308). **Fails in email:** install address labelled "Drop-off" (email.js:84, P1-10). |
| 2 | Estimate doesn't omit install/access/high-value/tax/quote lines then change | **Partly confirmed.** The same API feeds the dock and checkout, and all line types appear. There's no tax line (needs a decision). **Fails:** "additional fee may apply" and over-700 lb on instant-paid jobs (P0-6), and the $75/$0 "regular rate" on unpriced items (P0-18). |
| 3 | Route days vs schedule across weeks and holidays, incl. 94109 | **Fails.** 94109 at Van Ness gets the correct Wed/Fri. 94109 at Laguna St gets OC days (P0-1). Holidays aren't covered past Jan 1, 2027 (P1-28). The server accepts blackout and past dates (P0-2). Week alternation matches config (anchor Nov 16 = NorCal). |
| 4 | Unknown weight/size doesn't skip heavy photo or review; exactly 500 vs >500 | **500 → no photo, 501 → photo: confirmed consistent.** Unknown weight on sculpture/other → review: confirmed. **Fails:** no photo needed when unknown, furniture never checked (P1-4). Zero or missing dimensions accepted by the server (P0-2). |
| 5 | Buyer, pickup contact, recipient and payer all different; who gets confirmations | **Fails.** Only the buyer is emailed. The payer gets nothing, and the buyer is charged anyway (P0-8). |
| 6 | Double tap, failed payment, abandoned checkout → no duplicate jobs or false confirmations | **Partly.** Repeat /pay is idempotent (confirmed), and a failed card shows an error with no confirmation (confirmed). Abandoned orders stay `awaiting_payment` and never reach the schedule (confirmed). **Fails:** concurrent POST creates two orders (no server idempotency), refresh after Done allows a second paid job (P0-16), and Stripe cancel shows "Your quote is approved" (P0-17). |
| 7 | Save-for-next-time, value protection and cancellation claims don't overpromise | **Fails:** "one tap" (P0-12), "included" (P0-4), "we'll take care of it" (P1-14), and the ETA cadence (P0-14). |
| 8 | No default selects access, paid protection or consent | **Fails:** protection is forced and labelled "included" (P0-4), hang height, size, kind, client type and wall type are preselected (P1-1), and access defaults are being rebuilt (§4). Consent (stairwell fit) is not preselected: passes. |
| 9 | Validation, back/edit, refresh/resume, mobile CSS | Client validation is thorough, but the server doesn't mirror it (P0-2). Back/Edit keep data: passes. Refresh loses the step (P1-34) and allows a duplicate after Done (P0-16). CSS: prices are `nowrap` in cards (passes), but the dock ellipsis can truncate (P1-22) and seg buttons can truncate (P1-23). |

---

## §4 Access / stairs / elevator (re-audited after `1a9b997`, fixed in `6fd85e3`)
- **Silent “Ground level, no elevator” default: verified fixed.** “How do we get in?” has no default and blocks Continue; the review never prints that phrase (e2e).
- **Floor 2 with no stairs: verified fixed.** Floor only exists under Elevator and is cleared when the answer changes.
- **“Will everything fit?” had no “No”: verified fixed** (Yes / Tight fit / Not sure).
- **Stairwell-fit for “A few steps (3 or fewer)”: fixed.** It now fires for real stairs (including stairs on the way to an elevator); for a few steps only when the piece is also over 150 lb.
- **Dot review fixes:** Elevator → “Any stairs on the way?” (No / A few steps / Stairs) reusing flights, up-or-down and tight turns, same fees as Stairs (tested: $300 for 2 flights; pickup half flight + delivery elevator with 2 flights = $375). 5th answer “Not sure”: no stairs fee, never shown as ground level, sets `accessReview` (order, “ACCESS REVIEW” in the schedule sheet notes and admin list), estimate + review say “We’ll confirm access with you before the job.” Loading dock available? for every mode; Service elevator available?; Doors (optional); fit helper for every mode; tight-fit photo line and “Photos help if you have them.”; optional Narrowest opening (inches); “Enter the total number of flights (4 or more).”; no skipped answer is ever printed; “1 photo” / “2 photos”. The shipping destination card already asked the access questions, so it keeps them.

## Dot’s second review: Chad’s decisions (applied Nov 16, 2026)
- Elevator **“Any stairs on the way?” is required**: No / A few steps (3 or fewer) / Stairs / Not sure, with the helper “Count steps before or after the elevator.”; Not sure sets the access-review flag.
- Fit photo line: “Please add a photo of the tight spot and the way in.” (at least one photo). The 4+ input is now “Total number of flights” (placeholder “e.g. 4”), and a whole number of 4 or more is required in the browser and on the server. An invalid count is never priced.
- Review, email and sheet say “Elevator, floor 30”. Floor takes text (Basement, Ground, Mezzanine, B1, 30) with the placeholder “e.g. 3, Basement”.
- Access, fit or elevator stairs = Not sure: checkout stays allowed and the access-review flag is set. The estimate (dock: “Estimate · access to confirm”), the review and payment-link price cards, and the confirmation email show “Access to be confirmed. If stairs or a tricky carry add a fee, we’ll confirm it with you before charging anything.” No line calls the price final (tested).
- Photos: over 500 lb (501+) still required; unknown weight now required too. Fit Not sure keeps photos optional.
- Boundary tests in the browser (e2e) and on the server (audit-regression §8): 80"/81", 150/151 lb, 500/501 lb, unknown weight, floor “Basement”, 4 flights accepted, 3 (and 4.5) rejected, and every elevator stairs answer.

## Dot round 3 (live build NO, applied Nov 16, 2026)

1. **Not sure → base price now.** When any stop is flagged for access review, the review, payment page, Done page and confirmation email show the note “Access isn’t confirmed yet. If it needs an added fee, we’ll go over it with you and get your OK before charging it.”, “Estimated total (before access check)” instead of “Total”, and “Due today (base price)” instead of “Due today · paid in full at booking” (50/50: balance marked “before access check”; email: “Paid today (base price)”). The bottom bar stays “Estimate · access to confirm”, including on the payment step. No “paid in full” or “final” wording appears in that branch. Normal orders are unchanged.
2. **Same as me hides the contact role.** The role field is shown only when the contact is someone else (it comes back if Same as me is turned off or the name/mobile is edited). The browser sends no role for a Same as me stop; the server sets the role from the booker’s “I am a…” answer, ignores any role the client sent, and refuses the order if “I am a…” is blank (no silent default).
3. **Narrow screens.** Fields carry `scroll-margin-bottom` equal to the measured dock height, and a focus handler (plus `visualViewport` resize for the on-screen keyboard) scrolls the focused field above the dock. e2e checks every field at 430px and the last field at the bottom of the page.

Tests: e2e (review wording in both branches, dock label, Same as me role hidden/shown, payload, 430px focus) and audit-regression §9–10 (email wording in both branches, server role from “I am a…”, client role ignored, blank “I am a…” refused).

## Probe artifacts
- /tmp/aud/probe.js, probe2.js, probe3.js, probe4.js, with output in /tmp/aud/quotes.txt.
- Test orders and emails are in /tmp/auditstore (not in the repo).
