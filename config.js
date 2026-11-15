/**
 * CAD Online Ordering — single configuration file.
 *
 * Pricing and route days transcribed from the CAD SCHEDULE Google Sheet
 * 1E4PDjudgBIXnuOtvHO-Ywc4Fp-Gxiy5qr6yGI_4fXhg, tab "Notes/Info"
 * (read-only, Nov 14, 2026). Official 2025 rate-card images are embedded
 * on that tab (painting/sculpture card and furniture/décor card), plus
 * Google-map route images with red arrows and day labels. Membership
 * is 25% off the published non-member tables ($200/month prepaid credit).
 */
module.exports = {
  company: {
    name: 'California Art Delivery',
    short: 'CAD',
    phone: 'North & Central: (831) 596-1139 · South: (949) 765-5255',
    phoneNorth: '(831) 596-1139',
    phoneSouth: '(949) 765-5255',
    email: 'contact@californiaartdelivery.com',
    website: 'https://californiaartdelivery.com',
    hub: {
      south: 'Irvine Spectrum area, Irvine, CA (6401 Oak Canyon, Irvine, CA 92618)',
      north: 'Precise Packaging, Pacific Grove (Carmel / Monterey Bay area)',
    },
  },

  // ---------- PRICING (2025 published rate cards, Notes/Info tab) ----------
  pricing: {
    currency: 'usd',
    source: 'CAD 2025 statewide pickup & delivery rate cards on Notes/Info',
    exampleRatesNotice: 'Final price is confirmed by CAD.',
    // Painting delivery / install by piece count (non-member). After 7 pieces, +$50 delivery / +$50 install each.
    // Member column is 25% off, rounded to the nearest $5 as printed on the card.
    paintingDelivery: { nonMember: [200, 300, 375, 425, 475, 525, 575], member: [150, 225, 280, 320, 355, 395, 430], extra: 50 },
    paintingInstall:  { nonMember: [75, 150, 200, 250, 300, 350, 400],  member: [55, 110, 150, 190, 225, 260, 300],  extra: 50 },
    // Sculpture delivery by piece weight (non-member / member). Over 700 lb is not on the card.
    sculptureByWeight: [
      { maxLbs: 49,  nonMember: 200,  member: 150 },
      { maxLbs: 99,  nonMember: 300,  member: 225 },
      { maxLbs: 149, nonMember: 400,  member: 300 },
      { maxLbs: 199, nonMember: 500,  member: 375 },
      { maxLbs: 299, nonMember: 600,  member: 450 },
      { maxLbs: 499, nonMember: 800,  member: 600 },
      { maxLbs: 700, nonMember: 1000, member: 750 },
    ],
    sculptureOver700: { nonMember: 1000, member: 750, note: 'Over 700 lb is not on the published card; starting rate shown, CAD confirms.' },
    // Oversize add-ons from the rate-card footnotes
    largePainting: { overInches: 72, deliveryFee: 100, installFee: 200 }, // per painting 72" or larger
    largeWallDecor: { overInches: 48, deliveryFee: 100, installFee: 200 }, // per wall-décor piece 48" or larger
    // Optional declared value protection, offered at intake (Aerena is auto-included operationally)
    valuation: { optional: true, rate: 0.015, label: 'Declared value protection (1.5%)' },
    // Member plan
    membership: { monthly: 200, discount: 0.25, label: 'CAD membership (25% off)' },
    // Furniture card footnote only: furniture-only orders of $1,000 or more get an additional 10% off the total.
    // Paintings, sculpture, and mixed jobs never get this discount (paintings already get cheaper with quantity).
    volumeDiscount: { threshold: 1000, rate: 0.10, furnitureOnly: true },
    // Stairs / exceptionally heavy or long pieces: "an additional delivery or install fee may apply" — not a fixed published rate.
    stairsNote: 'A stairs or special-handling fee may apply and will be confirmed by CAD.',
    // Household moving & packing mid-range cheat sheet (Notes/Info) is for full-home moves, not this art-ordering form.
    // Rush / dedicated trips are not auto-priced. CAD (Samantha) quotes 1.5×–2× the regular rate.
    // "Other fragile or valuable item": priced by weight from the sculpture-by-weight card (closest published
    // handling-by-weight rate); CAD may adjust after reviewing photos.
    otherItemNote: 'Other fragile or valuable items are priced by weight from our sculpture rates. CAD may adjust the final quote after reviewing photos.',
    quoteMultiplierMin: 1.5,
    quoteMultiplierMax: 2.0,
    furniture: {
      // [small/light, medium/average, large/heavy] non-member. Member = 25% off, as printed.
      items: {
        'Sofa': [400, 475, 550],
        'Loveseat': [340, 400, 460],
        '2-Piece Sectional': [400, 475, 550],
        '3-Piece Sectional': [490, 575, 660],
        '4-Piece Sectional': [570, 675, 780],
        'Armchair / Accent Chair': [270, 315, 360],
        'Recliner / Lounge Chair': [300, 350, 400],
        'Bench': [180, 215, 250],
        'Ottoman': [160, 190, 220],
        'Dining Table': [320, 375, 470],
        'Dining Chair (Single)': [130, 150, 170],
        'Dining Chair (Set of 4)': [300, 350, 400],
        'Dining Chair (Set of 6)': [385, 450, 520],
        'Dining Chair (Set of 8)': [470, 550, 635],
        'Barstool (Single)': [120, 140, 160],
        'Barstool (Set of 2)': [180, 215, 240],
        'Coffee Table': [230, 275, 320],
        'Side Table': [160, 185, 215],
        'Console Table': [300, 350, 400],
        'Credenza / Sideboard': [340, 400, 460],
        'Buffet / Hutch': [420, 490, 560],
        'Desk': [320, 375, 430],
        'Headboard / Bed Frame': [340, 400, 450],
        'Dresser': [310, 365, 420],
        'Nightstand': [170, 205, 235],
        'Nightstand (Set of 2)': [250, 290, 325],
        'Storage Trunk / Chest': [275, 325, 375],
        'Vanity': [320, 375, 430],
        'Armoire': [470, 550, 625],
        'Mirror': [175, 235, 290],
        'Table Lamp': [150, 175, 200],
        'Floor Lamp': [180, 210, 240],
        'Chandelier': [370, 455, 545],
        'Wall Decor': [190, 235, 305],
      },
      // Vases / sculptural décor / accents / figurines etc. — five printed sizes, not three.
      // Décor kinds (own item type in the form). Priced from the same furniture/décor card.
      // Mirror is its own item type now (priced from the painting tables); kept in `items` only so older orders still price.
      decorKinds: ['Wall Decor', 'Vases / Sculptural Décor / Accents / Figurines', 'Table Lamp', 'Floor Lamp', 'Chandelier'],
      accents: { label: 'Vases / Sculptural Décor / Accents / Figurines', nonMember: [85, 140, 195, 250, 305], member: [65, 105, 145, 190, 230] },
    },
  },

  // ---------- PAYMENT (Chad's policy, confirmed Nov 14 2026) ----------
  payment: {
    depositThreshold: 3000,
    depositPercent: 50,
    balanceDueLabel: 'at pickup',
    allowInvoice: false,
    methods: ['card', 'us_bank_account'],
    savePaymentMethod: true,
    // Confirm the job as soon as payment is submitted, including ACH.
    // Do not wait for the bank transfer to clear (ACH can take a few days).
    confirmOnSubmit: true,
  },

  // ---------- ROUTES / SCHEDULING ----------
  // One van alternates weeks. Anchor kept: week of Mon Nov 16, 2026 = NorCal week.
  // The Notes/Info route maps do not contradict that phase; they describe the repeating weekly pattern.
  //
  // Monday is LA day BOTH weeks, with opposite directions (Chad, Nov 14, 2026, and the two "South - Mon" maps):
  //   NorCal-week Monday: start at the SoCal hub (Irvine Spectrum / Irvine), head northwest
  //     through LA, then SB late or Fresno very late, overnight just south of Carmel.
  //     The "Mid-day" Anaheim label on that map is crossed out.
  //   SoCal-week Monday: Santa Barbara is saved for the prior Sunday at the end of the
  //     northern run. Monday starts in northwest LA (Malibu, Santa Monica, Beverly Hills)
  //     and heads southeast through LA back to the Irvine hub. Time-of-day labels on
  //     that map are crossed out — direction matters, not a promised morning/afternoon grid.
  //   So LA customers can book Mondays in either week.
  //   A simple Orange County stop is also possible on Monday (the van starts at or
  //   returns to the Irvine hub) but only for 1–2 standard items — not 3 or more.
  //   Larger OC jobs use the regular Thursday of a SoCal week.
  //
  // Midweek of a NorCal week is the north: Tue Carmel/Salinas/Monterey (night in San Jose);
  // Wed Silicon Valley / SF / Marin / Healdsburg / Cupertino; Thu East Bay (if quick) and
  // Sacramento (or Tahoe); Fri East Bay, Napa, SF and SV if quick, based around San Jose;
  // Sat Carmel/Salinas (then drive to SLO or Fresno for Sunday); Sun Central Coast
  // SLO/Pismo → SB or Fresno → SB (or straight to LA if no SB).
  // Midweek of a SoCal week: Tue Coachella Valley, Wed San Diego County, Thu Orange County.
  // SoCal Fri–Sun: no regular stops (OC overflow only; farther out only if a big job).
  scheduling: {
    anchorWeekStart: '2026-11-16',
    anchorRegion: 'NorCal',
    leadTimeDays: 2,
    showDays: 12,
    rushEnabled: true,
    blackoutDates: ['2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2027-01-01'],
    timeWindows: ['Morning (8–12)', 'Midday (11–3)', 'Afternoon (1–5)', 'Flexible / all day'],
    socalZipMax: 935,
    // Simple OC Monday stop: 1–2 standard items only (not 1–3). Oversize paintings (72"+),
    // oversize wall décor (48"+), and sculpture over 700 lb are not booked as a simple stop.
    simpleOcMonday: { maxStandardItems: 2 },
    // Zone ids referenced by the weekly day catalog below.
    // Monday includes 'LA' in BOTH week types so LA customers can book either Monday.
    dayCatalog: {
      NorCal: {
        0: { zones: ['Central', 'SB'], label: 'Central Coast → Santa Barbara (or on to LA)', shortLabel: 'Central Coast → SB' },
        1: { zones: ['LA', 'SB'], label: 'LA, heading northwest (SB late or Fresno very late)', shortLabel: 'LA · heading NW',
            simpleStops: [{ zone: 'OC', maxStandardItems: 2, label: 'OC simple stop (1–2 standard items) leaving the Irvine hub, then LA heading northwest', shortLabel: 'OC · simple stop' }] },
        2: { zones: ['Carmel'], label: 'Carmel, Salinas and Monterey Bay (night in San Jose)', shortLabel: 'Carmel / Monterey' },
        3: { zones: ['BayWest'], label: 'Silicon Valley, SF, Marin, Healdsburg, Cupertino', shortLabel: 'SV / SF / Marin' },
        4: { zones: ['EastBay', 'Sacramento', 'Tahoe'], label: 'Sacramento & surroundings; East Bay if quick', shortLabel: 'Sacramento / East Bay' },
        5: { zones: ['EastBay', 'NapaWine', 'BayWest'], label: 'East Bay, Napa; SF & Silicon Valley if quick', shortLabel: 'East Bay / Napa' },
        6: { zones: ['Carmel'], label: 'Carmel / Salinas (then toward SLO or Fresno)', shortLabel: 'Carmel / Salinas' },
      },
      SoCal: {
        0: { zones: [], label: 'No regular stops (OC overflow only)', overflow: true },
        1: { zones: ['LA'], label: 'LA, heading southeast toward the Irvine hub', shortLabel: 'LA · heading SE',
            simpleStops: [{ zone: 'OC', maxStandardItems: 2, label: 'OC simple stop (1–2 standard items) on the way back to the Irvine hub', shortLabel: 'OC · simple stop' }] },
        2: { zones: ['Coachella'], label: 'Coachella Valley', shortLabel: 'Coachella Valley' },
        3: { zones: ['SD'], label: 'San Diego County', shortLabel: 'San Diego County' },
        4: { zones: ['OC'], label: 'Orange County (Irvine hub)', shortLabel: 'Orange County' },
        5: { zones: [], label: 'No regular stops (OC overflow only)', overflow: true },
        6: { zones: [], label: 'No regular stops (OC overflow only)', overflow: true },
      },
    },
  },
};
