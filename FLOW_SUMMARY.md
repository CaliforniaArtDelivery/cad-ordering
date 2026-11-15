# CAD online ordering — flow summary (4 steps)

Test URL: https://finite-inspired-court.liveapps.dev · Admin (Samantha): /admin?key=cad-admin
Test payments only: card 4242 4242 4242 4242 · ACH routing 110000000 / account 000123456789 · Apple Pay / Google Pay buttons are mock in test mode.
Orders go only to `data/orders.json` + `data/schedule-2026.csv` (never the real CAD SCHEDULE sheet). Emails are written to `outbox/` (never sent).

Header shows "Step N of 4" + a 4-segment progress bar. The bottom dock always shows the running total (on step 4: amount due today) and the main button.

## 1. What are we moving?
Three services, because CAD has no delivery-only or pickup-only job (everything picked up gets delivered):
- **Pickup + Delivery** (from $200): white-glove pickup and delivery for fine art, sculpture, luxury furniture, décor and antiques, placed exactly where you want it.
- **Pickup, Delivery + Install** (from $275): everything above, plus expert installation of paintings, mirrors and wall décor.
- **Install only** (from $75): already on site; we hang paintings, mirrors and wall décor (item types limited to Painting, Mirror, Other wall art, wall-hung Décor and Other request).
- **Shipping** (custom quote): out-of-state shipping by air or ground (pieces may be crated or soft-packed as needed). Always a quote request priced by Samantha; never instant payment. Within California, CAD always provides white-glove delivery.

Copy: fine art, luxury furniture and décor are CAD's core, and we handle anything fragile or valuable.

Item fields appear once a service is picked, and each item type shows only its relevant fields:
- **Item type chips (in order):** Painting, Mirror, Other wall art (photography, mixed media, wall sculpture, etc.), Sculpture, Furniture, Décor, Other fragile or valuable item, Other request.
- **Painting / Other wall art:** qty, description (placeholder "e.g. Oil on canvas by J. Smith"), W×H×D, required **Framed?** Yes/No (no default; Continue blocked until answered), and if Yes a required **Glass or acrylic glazing?** Yes/No, declared value, photos. The server rejects these pieces without the answers.
- **Mirror:** same fields as a painting, no framing question (glass is implied).
- **Other request:** free-text description; always routed to a custom quote reviewed by CAD (no payment until approved).
- **Pricing assumption (flagged):** Mirror and Other wall art use the painting size-based delivery and hanging tables for now. Wall sculpture under Other wall art hangs, so it is installable; freestanding Sculpture is placed, never hung.
- Item type, Framed Yes/No and glazing show in the review, the admin Pieces panel, the quote/confirmation emails and the schedule CSV.
- **Sculpture:** qty, description, W×H×D, weight (required), declared value, photos
- **Furniture:** kind + size, qty, description, declared value, photos (not offered for Install only)
- **Décor:** Type of décor (grouped: Wall — Wall Decor, Wall sculptures, Tapestries & textiles, Mirror; Lighting — Table Lamp, Floor Lamp, Sconces, Chandelier; Accents & objects — common small décor A–Z, plus Other (describe)) + size (3 tiers, or 5 for accents), qty, description, W×H×D, declared value, photos
- **Other fragile or valuable item:** qty, description, W×H×D, weight (required), declared value, photos, plus a note that the final quote may be adjusted

Each piece has Duplicate and Remove. Custom crating is a toggle (not for Install only). Choosing it turns the booking into a quote request.

### Pricing (from the Notes/Info rate-card images in notes-info-extract/)
- **Sculpture is never hung or installed. One weight price covers pickup, delivery and placement** wherever the client wants it (residence, hotel, sculpture garden; a plain gallery/warehouse drop is the same price). The line reads "Sculpture: pickup, delivery & placement (X lb)" on both Pickup + Delivery and Pickup, Delivery + Install, with no separate placement line. It's priced only by weight from the "Sculpture Delivery Pricing" card. Non-member / member:
  - <50 lb: $200 / $150
  - 50–99 lb: $300 / $225
  - 100–149 lb: $400 / $300
  - 150–199 lb: $500 / $375
  - 200–299 lb: $600 / $450
  - 300–499 lb: $800 / $600
  - 500–700 lb: $1,000 / $750
- **Sculpture placement:** the card has no separate placement rate, so it's included in the weight price. There is no separate $0 placement line. The card's footnote: for sculptures "particularly long/wide or involving stairs, an additional delivery or install fee may apply". Over 700 lb isn't on the card; the $1,000 starting rate is shown and CAD confirms.
- **Décor:** Furniture & Décor card, "Décor & Lighting" rows by size: Mirror, Table Lamp, Floor Lamp, Chandelier, and Wall Decor use Small/Light, Medium/Average, Large/Heavy. Tapestries & textiles and Wall sculptures use Wall Decor rates. Sconces use Table Lamp rates. Common accent items (A–Z, including vases, figurines, and sculptural décor) plus Other (describe) share the five printed accent prices (Extra small through Extra large).
- **Hanging:** only wall-hung pieces (paintings, wall décor, mirrors) are hung, priced per piece from the Painting Installation table. Oversize: 72"+ painting is +$100 delivery / +$200 install, and 48"+ wall décor is +$100 / +$200.
- **Placed pieces:** furniture, lamps, accents, sculpture and other items are placed, included in delivery.
- **Other fragile or valuable item:** no card covers it. It's priced by weight from the sculpture card, with a note that CAD may adjust.
- **Not covered by any card:**
  - Chandelier and sconce hanging becomes a quote request (mounting/electrical is not on the rate card).
  - Install only for sculpture, furniture or other pieces isn't offered (the form tells them to call).
  - A per-piece rate for hanging small wall décor and mirrors isn't printed. They use the painting install table, an assumption to confirm.
- **10% off at $1,000+:** applies when every piece is furniture or décor.

## 2. Where are we going?
- **Your details:** name, email, mobile (required), company, client type, member toggle, and referral toggle (partner type/name/email).
- **Pickup address** is required for every non-install job, and **Delivery address** is always required. Install only asks just the **Installation address**.
- Each site:
  - Street, city, ZIP, business.
  - **On-site contact** name + phone (required) with **Same as me**.
  - Access (compact): floor, access hours, Elevator, Loading dock, **Parking or loading restrictions** (toggle + note), "**Will everything fit through the doors (and elevator)?**" (Yes / Not sure), **Stairs or steps** (always asked, even with an elevator).
  - One **Special instructions** box.
- Jobs with wall-hung pieces in an install service add a **Hanging** block on the install address: center height (default 57" museum standard), wall type, hanging hardware (CAD brings it / On site / Not sure), and an optional wall photo.

## 3. Choose your date
- Route days for the pickup region, and pickup and delivery on the same route day by default. Then an arrival window and the promise card.
- **Deliver on a later date** toggle: pick a later delivery route day for the delivery address. It's booked as a separate stop (its own row in the schedule CSV), and the promise reads "Pickup Mon, Nov 16 · Delivery Mon, Nov 23".
- Cross-region jobs don't show the toggle. Instead they explain that delivery goes on the next opposite-region route day.
- Rush days and Dedicated trip make it a quote (1.5×–2×).

## 4. Review & pay
- Promise card on top (date + window, or pickup + delivery dates).
- Summary with Edit links, per-site access and install details.
- Price lines, mandatory **Declared value protection (1.5%)** on pieces up to $50K and **High-value handling** lines above $50K (see Declared value rules), total, and the payment plan (under $3K paid in full; $3K+ is 50% now and the balance at pickup, or at installation for install only).
- Who's paying: "Referring partner" only appears when a referral was entered.
- Short cancellation note.
- Payment: Apple Pay / Google Pay / Card / Bank (ACH), save for next time, and a dock button reading "Pay $X". It confirms instantly; ACH shows as "ACH processing".
- **Quote requests** (rush, dedicated trip, or custom crating) show no payment UI. The button reads "Request a rush quote" or "Request a quote" and leads to "Quote request received". For crating alone, transport is at the regular rate and the crating line says "Quoted by CAD".

## Confirmation
"**You're booked for Monday, November 16, Morning (8–12).**" Shows order id, route, payment (Paid $X · Card/Apple Pay/Google Pay, or ACH processing $X), any balance due, and the total. Confirmation, reminder and ETA emails go to outbox/.

## Quote path (rush / dedicated / crating)
Step 4 shows "Review your request", the quoted range and "no payment due yet", and no payment buttons. The button reads "**Request a rush quote**" (or "Request a quote" for a dedicated trip) and leads to "**Quote request received**". Samantha approves and prices it in admin. The payment-link email (outbox) opens a "Pay to confirm" screen.

## Shipping (quote only)
- **Pieces:** type, qty, description, W × H × D and weight (required), declared value (required), framed with glass, uniquely fragile, crating (needs crating / already crated / not sure), photos.
- **Where:** full pickup site card (access, dock, elevator, stairs, hours, on-site contact). Destination: country (default United States). International addresses switch to a free-form address plus city, with a customs / import contact (name, phone, email). Residential or commercial. Same access fields at both ends.
- **Step 3 becomes "Shipping details":** service at the destination (curbside, inside delivery, inside + unpack & install, unpack + install + debris removal), ship-by and arrive-by dates, "My dates are flexible" toggle.
- **Review:** "Review your shipping request", price shown as "Custom quote", "Insurance: Fully insured through our shipping partners" with the total declared value (declared value is required per piece for the insurance quote; no declared value protection and no high-value markup on shipping), payer. Button: "Request a shipping quote". No wallets or card form.
- **After:** "Shipping quote request received"; quote email labeled shipping with all details; admin shows SHIPPING, a "Shipping details" panel and "Samantha — price this shipping quote" (no rate-card estimate). Once paid, the CSV gets a "SHIPPING" row with the shipping details in Update Notes.

## Declared value rules (Chad; in-California white-glove jobs only)
- Declared value per piece is **required** on every item.
- Pieces valued **$50,000 or less**: declared value protection at 1.5% of value is **mandatory** (no toggle). Line: "Declared value protection (1.5%) on $X".
- Pieces **over $50,000**: no protection offered. Instead a per-piece line "High-value handling +X% · [piece] ($value)" on that piece's normal price (for paintings, its share of the painting delivery/installation table price):

  | Value per piece | Markup |
  |---|---|
  | over $50,000 | +100% (×2) |
  | over $100,000 | +200% (×3) |
  | over $300,000 | +300% (×4) |
  | over $500,000 | +400% (×5) |
  | over $750,000 | +500% (×6) |
  | over $1,000,000 | +600% (×7) |

  With a note: "CAD doesn't offer declared value protection on pieces valued over $50,000… Please cover them with your own fine art insurance."
- The markup is added after the furniture & décor 10% discount and is not discounted.
- Shipping quotes (Shipping service or out of state): none of the above; "Fully insured through our shipping partners."

## Out-of-state rule (Chad)
Any job with a pickup or delivery address outside California (state field, a non-CA ZIP, or a non-US country) automatically becomes a Shipping custom quote, even if the customer picked Pickup + Delivery. A short note explains it ("Pickups and deliveries outside California are custom quoted as Shipping… Within California we always provide white-glove delivery."). Step 3 switches to Shipping details (adds dims/weight/crating per piece and destination type). The order is saved as `crating_shipping` (display label: Shipping) with `outOfState: true` and the service the customer originally picked.

## Photo rules (Chad)
Photos are optional by default (deliveries and shipping). They're required, with a one-line reason shown, when:
- a piece is 300 lb or heavier, is an "Other" item, or is marked **Uniquely fragile** (toggle on every piece);
- a site has **Tight spaces, backyard or technical carry** turned on (photos of the carry path);
- a hanging job is **High or above a stairwell** (photo of the wall).
The server enforces the same rules.

## Mobile layout guarantees (iPhone / in-app browsers)
- The header is in normal page flow (not fixed or sticky), so content can never sit under it. Its top padding includes `env(safe-area-inset-top)` (viewport-fit=cover), so it clears notches and in-app browser toolbars that report a top inset.
- The bottom dock is fixed. Its height is measured live, and the page's bottom padding and `scroll-padding-bottom` match it, so nothing (including focused fields) hides behind it.
- Nothing scrolls the page on its own. History scroll restoration is manual, a new step starts at scroll 0, and in-step taps (toggles, chips, Same as me, item type) keep the scroll position. There's no auto-scroll after picking a service, no autofocus, and no scroll-snap.
- There's no horizontal overflow. Long price labels wrap instead of pushing the page wider.
- Verified by `node scripts/layout-qa.js` (E2E_BROWSER=webkit or chromium) at 390×844, 375×667, 430×932 and 320×568.
