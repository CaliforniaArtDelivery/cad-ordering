# Multi-piece order flow: review for Dot

Site: CAD ordering test site (code in `/workspace/cad-ordering-deploy`, **not deployed**).
Updated Nov 18, 2026, with Dot's review items and Chad's 7:31 PM pricing rule.

## 1. The bug
The items step had a quantity box. "Painting, quantity 10" was treated as one piece, so the size, framed, declared value, weight and photo questions were asked once for all ten. Nobody could tell whether "$12,000" meant one piece or all ten. The "Anything else to deliver?" screen showed "10x Canvas Painting", but the pricing, validation, emails, admin view and schedule sheet all used the single set of answers.

## 2. The new flow
- **One entry is exactly one piece.** The quantity control is gone everywhere. Each piece gets its own what/size/value/weight/handling/photos screens.
- **Labels:** "Piece 1", "Piece 2" … everywhere: the steps, the list, the review, the quote lines, emails, admin, the schedule sheet payload and the Drive test log. Multi-piece orders show "Piece 3 — Canvas".
- **Piece IDs:** every piece has a permanent internal id. Labels renumber after a removal; ids never change. Legacy items get deterministic ids, so refreshing never creates duplicates.
- **List screen ("Anything else to deliver?")** shows "Piece 1 — Canvas Painting" with size/value facts and **Edit · Duplicate · Remove**, plus "Add another piece".
- **Duplicate** asks "How many additional pieces would you like to create?" (capped so the order stays within 60). It copies the details. A "Use this piece's photos on the copies" switch only shows when the piece has photos, and is off by default, so photos are never copied silently. Copies keep the declared value but are flagged **Check value** (a tag on the list, a note on the value screen, "Value is right" to clear; editing the value also clears it).
- **Remove** asks first ("Remove Piece 4 — Canvas?" Keep it / Yes, remove). Labels renumber and the price recalculates immediately.
- **Quick edit pieces:** a collapsed section under the list. One collapsible row per piece for the common fields (description, size, framed, value, weight or Not sure, handling). It works at 390px with no sideways scroll, and the list above it updates as you type.
- **Incomplete pieces** show "Needs details" with a link to the missing field. They block Next, the quote and submit. Editing one piece from the list returns to the list afterwards instead of walking through every later piece.
- **Final review:** one row per piece with Edit, plus the sentence "Each piece is listed and priced separately. Please check the dimensions, declared value, handling requirements, and photos for every piece."
- **Weight "Not sure" / special handling** photo rules apply per piece (only that piece asks for a photo). Next frees up as soon as the photo uploads.
- **Refresh and double-submit:** refresh keeps all pieces with the same ids. Double-clicking Pay (or double-posting the API) creates exactly one order. After booking, a refresh shows the confirmation and books nothing new.

## 3. Data and pricing model
- One authoritative piece model in `lib/itemtypes.js` (`expandPieces`, `ensureIds`, `piecesOf`, `pieceLabel`, `pieceDetail`). Server `validate()`, pricing, emails, shipping text, schedule rows and admin all go through it.
- **Backward compatibility:** any saved order, in-progress browser draft or API call with `qty > 1` is expanded into separate pieces on load or at the API (draft: `normalizePieces` in the browser and written back immediately; server: `migratePieces` on load and `expandPieces` in validate). Nothing crashes, and old orders show as Piece 1…N. Paloma's partner flow keeps its own quantities (it is a different model); it is untouched and its test suite passes.
- Limit: 60 pieces per order. Server errors name the piece, e.g. "declared value for Piece 3 - Canvas".
- **Pricing is per piece and summed.** Painting delivery/installation table prices still apply to the group of paintings, with the lines labeled "Pieces 1–10".

### Declared value rules (per piece, never from the order total)
| Declared value of the piece | What the customer pays |
|---|---|
| $50,000 or less (exactly $50,000 included) | normal moving price + a separate "Required declared value protection" line, 1.5% of that piece's value (one line per piece, named "Piece N") |
| over $50,000 (Chad, Nov 18) | normal moving price + **0.75% of the declared value, rolled into one price**. No protection line, wording or note. A painting over $50,000 has its own moving-price line (see Fixes after Dot review) |

The old tiered high-value handling (+100% to +600%) is **retired**. The $50,000 cliff is intentional and not smoothed. The neutral checkout sentence now reads "Declared value protection applies to pieces valued up to $50,000." Nothing says over-$50k pieces have "no protection".

Test cases (single 120 lb sculpture, normal moving price $400; also asserted in the browser and API):
| Declared value | Result |
|---|---|
| $50,000 | $750 protection line, total $1,150 |
| $50,001 | $375.01 built in, total $775.01, one price line |
| $75,000 | $562.50 built in, total $962.50 |
| $500,000 | $3,750 built in, total $4,150 |

Other checks: two $40,000 pieces both keep protection (the order total is $80,000). The 60 × 40 mirror at $100,001 adds $750.01. A 900 lb sculpture at $1,000,001 adds $7,500.01. The admin view shows "Over $50,000 (0.75% … built into its price)" per piece, internal only.

### How $0 and very low values are handled (no minimum fee added)
- **$0 or blank:** the form blocks it ("Please enter the value of this piece") and the server rejects it with a message naming the piece. Only a "custom request" piece may have no value. If the quote engine is called with $0 directly, there is no protection line and nothing built in, so the move is priced at the normal price only.
- **Very low values:** protection is a straight 1.5%, rounded to the cent, with no minimum. $1 adds $0.02 (total $400.02); $0.50 would add $0.01. Please tell Chad if a minimum protection fee is wanted. Not added, as instructed.

## 4. Tests and results
Run in the repo; the temporary servers use scratch storage and send no real emails.

| Suite | Result |
|---|---|
| `scripts/pricing-test.js` (unit, quote engine) | all pass, including the four new-rule cases, per-piece mixes, $0/$1 |
| `scripts/multipiece-test.js` (new): 53 API checks + 114 browser checks at a 390px phone viewport | **167 passed, 0 failed** |
| `scripts/audit-regression.js` | pass (updated to per-piece lines and the 0.75% rule) |
| `scripts/palomas-test.js` | 181 passed, 0 failed |
| `scripts/date-guard-rules-test.js` / `scripts/bridge-test.js` | 57 / 62 passed, 0 failed (schedule sheet rows untouched) |
| `scripts/e2e.js` (old) | retired after Dot's review (see "Fixes after Dot review"); no known-failing test remains |

What the new suite covers: 1 piece; 10 different pieces; legacy qty 10 expanded to ten with correct totals; Duplicate (count, no-photo default, same-photo switch, check-value flags, missing-photo prompt); Remove with confirm and renumbering; 30 pieces (no overflow, totals match a fresh server quote); Quick edit changes only the chosen piece and recalculates; incomplete piece blocks Next and the link jumps to the right field; refresh and Back/Edit navigation; mixed values at $49,999 / $50,000 / $50,001 (+ $75,000, $500,000 via the API); Not-sure weight photo rule on one piece only; full run to the review; double-click Pay creates one order; confirmation survives refresh; the schedule-sheet payload and admin text list one line per piece; confirmation email has per-piece protection lines and none for over-$50k pieces; no JavaScript errors in the browser.

Bugs found and fixed along the way: draft ids churned on every refresh; the Duplicate switch could not be clicked in the test (hidden input); Quick edit did not update the list rows above it; "Fix" and "Edit" walked on into the next piece instead of returning to the list; Next stayed grey after a photo upload while a text box had focus.

Screenshots (390px phone) in `/workspace/multipiece_shots/`: 01 what-is-it, 02 one-piece list, 03 duplicate dialog, 04 after duplicate (check-value flags), 05 copy needs value check and photo, 06 remove confirm, 07 thirty pieces, 08 quick edit open, 09 incomplete piece, 10 three pieces at the thresholds, 11 review top, 12 review full, 13 confirmation.

## 5. Open questions
1. Minimum protection fee for $0 / tiny values? (None added.)
2. Paloma's partner flow still uses quantities (it is a separate bulk-furniture model). Should it get the same one-piece rule?
3. 60-piece cap per order: is that the right ceiling?
4. For painting groups, the 0.75% is folded into the grouped "Painting delivery × N" line, so one line can include several pieces' amounts. Is that OK, or should paintings over $50k be priced on their own line? (Per Chad, no separate protection-style line either way.)
5. Shipping/out-of-state orders: pieces are one-per-entry too, but pricing there is still a custom quote.

## 6. Fixes after Dot review (NOT APPROVED TO DEPLOY → 3 blockers + recommendations)

**Blocker 1: copied values must be confirmed before Pay.**
- Pay is blocked while any piece still says "Check value". The customer can still move through every other step (Next on the list and the later steps is not blocked).
- **Confirm all N values** button (list screen and review) with the wording: "Confirm all says: the declared value shown for each of these pieces is correct." Each piece also has **Value is right** and **Edit value** (Edit returns straight to the review). Editing a value clears its flag.
- On the review screen the card lists each unconfirmed piece with its value and says "Payment is on hold until this is done". The Pay button shows "1 field left: Declared values".
- The server enforces it too: an order with any unconfirmed piece is refused ("please confirm the declared value for Piece 2; Piece 3"), so a stale or hand-made request cannot skip it.
- An old in-progress draft with a quantity is expanded in the browser, and each copy gets the Check value flag, so the customer must confirm before paying.

**Blocker 2: confirmation page and every output list every piece.**
- Confirmation page (paid, quote request and shipping request) has a collapsible **Your pieces (N)**, closed by default; open it to see each piece by number, description, dimensions and declared value.
- Verified with real output in the production-like smoke test (below), for a six-piece order: customer confirmation email (Piece 1–6 by number and description, protection lines only for pieces up to $50,000), internal team emails (pending-request review email and the manual-review email now list every piece; the review email did not before), admin view (Piece 1–6 with type, size, weight, value), schedule CSV, schedule-sheet rows (TEST ORDERS tab) and the raw log (every piece, no quantity field).

**Blocker 3: old quantity orders are never silently converted.**
- A stored order with a quantity keeps its original entry (`legacyQty`, including `originalItem` with the original `qty` and the piece numbers it became) and is flagged `needsManualReview` with a reason. Its saved quote and payment are untouched.
- Same for an old page or API caller that submits a quantity now: accepted, original kept, flagged, and the team is emailed.
- Admin shows a red **NEEDS MANUAL REVIEW** badge in the list and a banner with the original entry in the order detail; the schedule-sheet notes carry the flag too.

**Dot's recommendations**
- Each painting over $50,000 now has its own moving-price line ("Piece 3 — Painting delivery", and "— Painting installation" when installed) with the 0.75% built in and no extra wording. Ordinary paintings stay grouped. The total is unchanged by this: the table price is still worked out for all the paintings together; the grouped line shows the remainder.
- Long lists: with more than 8 pieces, finished pieces collapse to one short row (title + value, Edit/Duplicate/Remove, a Details toggle), with a summary line ("12 pieces · 12 complete · $144,000 total declared value"). Pieces that need details or a value check stay open.
- Sticky footer: checked at 375×667 on the first, size, value, list and long-list screens (last control is always above the bar), and with the keyboard open (visible height 330px): the focused value and weight fields are fully visible. The bar now slims down on short screens (about 90px instead of 125px).
- `scripts/e2e.js` retired (it was stale and failing before this work). `npm run e2e` now runs the new browser/API suite; new `npm run smoke` and `npm run test:all`.

**Production-like smoke test** (`scripts/smoke-test.js`, 33 checks): a real server process in production mode with strict Date Guard, a fresh data folder, an admin key, and the Google Sheet bridge test double running the real Code.gs. It runs: site up, test-mode payments, quote (per-piece protection, $50,000 line, own line for the $75,000 painting, $500,000 sculpture, lines add up), refused unconfirmed value, double submit, test-mode payment (and a second pay call books nothing), confirmation data, customer email, admin, schedule CSV, sheet rows, raw log, nothing in the live tab, team emails, old quantity entry.

**Results after the fixes**
| Suite | Result |
|---|---|
| `pricing-test.js` | pass (new own-line cases for each service) |
| `multipiece-test.js` (API + 390px browser + 375×667 and keyboard checks) | **211 passed, 0 failed** |
| `smoke-test.js` | 33 passed, 0 failed |
| `audit-regression.js` | pass |
| `palomas-test.js` | 181 passed, 0 failed |
| `date-guard-rules-test.js` / `bridge-test.js` | 57 / 62 passed, 0 failed |

New screenshots in `/workspace/multipiece_shots/`: `14-bulk-confirm-list.png` (Confirm all 4 values), `15-blocked-pay-review.png` (Pay blocked with the confirm card), `16-confirmation-your-pieces.png` (Your pieces (5), opened), `17-long-list-collapsed.png` (12 pieces collapsed), `18-keyboard-open-value.png` (short screen, keyboard open).

Still open: the questions in section 5 (minimum fee for tiny values, Paloma's quantities, the 60-piece cap). One note: the over-$50,000 line rule covers paintings only; a mirror, photograph or wall-art piece over $50,000 still has its 0.75% built into its group's line.
