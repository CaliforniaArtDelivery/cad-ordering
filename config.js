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
    exampleRatesNotice: 'Prices are from CAD’s published rate card.',
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
    // Over 700 lb: flat rate, booked and paid like any other piece (Chad, Nov 16 2026: heavy pieces are never sent to quote review).
    sculptureOver700: { nonMember: 1000, member: 750 },
    // Oversize add-ons from the rate-card footnotes
    largePainting: { overInches: 72, deliveryFee: 100, installFee: 200 }, // per painting 72" or larger
    largeWallDecor: { overInches: 48, deliveryFee: 100, installFee: 200 }, // per wall-décor piece 48" or larger
    // Mirror pricing (Chad, Nov 15 2026): multipliers on the painting prices for that size
    // (including the 72"+ oversize fees when they apply). Face size only (width or height;
    // depth does not count). Every multiplier is rounded UP to the next $5.
    // Install thresholds are exclusive ("over"): up to 48" = 1×; over 48" = 1.5×;
    // over 60" = 2.5×; over 70" = 3×. No 50" tier.
    // Transport (pickup & delivery) uses the painting delivery tables as the base:
    // under 60" = 1×; 60" or more (inclusive) = 1.5×; over 70" = 2×.
    // Décor → Mirror uses this same path.
    mirrorInstall: {
      roundTo: 5,
      tiers: [
        { overInches: 70, multiplier: 3 },
        { overInches: 60, multiplier: 2.5 },
        { overInches: 48, multiplier: 1.5 },
      ],
    },
    mirrorTransport: {
      roundTo: 5,
      tiers: [
        { overInches: 70, multiplier: 2 },
        { minInches: 60, multiplier: 1.5 },
      ],
    },
    // Frame type is asked when a framed painting, photograph or other wall-art piece is over 48" on any side.
    // Pickup & delivery: only Large/heavy/ornate is surcharged (+$25), any size over 48".
    // Install (install jobs only): all frame types are surcharged on a >48"/≤72" and >72" table.
    heavyFrame: {
      askOverInches: 48,
      midInches: 72,
      deliveryFee: 25,
      install: {
        upTo72: { small: 25, medium: 50, large: 100 },
        over72: { small: 75, medium: 100, large: 150 },
      },
    },
    // Height/location install surcharge (install jobs only), from the Hanging height question.
    hangInstall: {
      standard: 0,
      mantel: { upTo72: 50, over72: 75 },
      high: 125,
      stairwell: 150,
      other: 0,
    },
    // Declared value protection (Chad, Nov 16 2026): REQUIRED on every in-California piece valued $50,000 or less,
    // 1.5% of the declared value. Not optional. Pieces over $50,000 get high-value handling instead (no protection).
    // A lower total than at $50,000 is intended, because we carry less liability (Chad, Nov 16 2026).
    valuation: { optional: false, rate: 0.015, maxValue: 50000, overRate: 0.0075 },
    // Member plan
    membership: { monthly: 200, discount: 0.25, label: 'CAD membership (25% off)' },
    // Furniture card footnote only: furniture-only orders of $1,000 or more get an additional 10% off the total.
    // Paintings, sculpture, and mixed jobs never get this discount (paintings already get cheaper with quantity).
    volumeDiscount: { threshold: 1000, rate: 0.10, furnitureOnly: true },
    // Stairs & technical-carry access fees (per piece, per stop). The per-flight rate is the
    // higher of the weight rate and the size rate. Technical carry adds one extra unit at that
    // same rate, on top of any stairs at that stop. Half flight = half the per-flight rate.
    // ≤3 steps is $0. Not member-discounted. Edit the numbers here only.
    accessFees: {
      weight: [
        { minLb: 400, fee: 200 }, // ≥400 lb
        { minLb: 200, fee: 150 }, // ≥200 lb
        { minLb: 100, fee: 75 },  // ≥100 lb
        { minLb: 50,  fee: 50, exclusive: true }, // >50 lb (not including 50)
        { minLb: 0,   fee: 0 },
      ],
      size: [
        { minIn: 80, fee: 100, exclusive: true }, // >80"
        { minIn: 72, fee: 50 },  // 72–80" inclusive
        { minIn: 0,  fee: 0 },   // <72"
      ],
    },
    // Household moving & packing mid-range cheat sheet (Notes/Info) is for full-home moves, not this art-ordering form.
    // Rush / dedicated trips are not auto-priced. CAD (Samantha) quotes 1.5×–2× the regular rate.
    // "Other fragile or valuable item": priced by weight from the sculpture-by-weight card (closest published
    // handling-by-weight rate); CAD may adjust after reviewing photos.
    otherItemNote: 'Other fragile or valuable items are priced by weight from our sculpture rates.',
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
      // Printed member prices for Décor & Lighting rows (25% off, rounded to the nearest $5 as on the card).
      itemMembers: {
        'Mirror': [130, 175, 215],
        'Table Lamp': [115, 130, 150],
        'Floor Lamp': [135, 160, 180],
        'Chandelier': [280, 340, 410],
        'Wall Decor': [145, 175, 230],
      },
      // Décor & Lighting section (bottom of the furniture/décor card on Notes/Info).
      // The last printed row is one five-size rate covering vases, sculptural décor, accents, figurines, and similar.
      // The form lists those as separate kinds, plus Other (describe), so clients can find them. Same prices for each.
      // Mirror stays a top-level item type (painting tables, plus the mirrorInstall / mirrorTransport multipliers).
      // Choosing Mirror under Décor routes to that same Mirror item and pricing — the card rates
      // on the Mirror row below are kept as a record of the printed card, not used by the form.
      decorKinds: [
        'Wall Decor', 'Wall sculptures', 'Tapestries & textiles', 'Mirror',
        'Table Lamp', 'Floor Lamp', 'Sconces', 'Chandelier',
        'Baskets', 'Bookends', 'Bowls & trays', 'Candle holders & candelabras',
        'Ceramics & pottery', 'Clocks', 'Decorative boxes', 'Figurines', 'Globes',
        'Lanterns', "Objets d'art", 'Picture frames (tabletop)', 'Planters & pots',
        'Sculptural Décor', 'Statues & busts', 'Urns', 'Vases', 'Other (describe)',
      ],
      decorKindGroups: [
        { label: 'Wall', items: ['Wall Decor', 'Wall sculptures', 'Tapestries & textiles', 'Mirror'] },
        { label: 'Lighting', items: ['Table Lamp', 'Floor Lamp', 'Sconces', 'Chandelier'] },
        { label: 'Accents & objects', items: [
          'Baskets', 'Bookends', 'Bowls & trays', 'Candle holders & candelabras',
          'Ceramics & pottery', 'Clocks', 'Decorative boxes', 'Figurines', 'Globes',
          'Lanterns', "Objets d'art", 'Picture frames (tabletop)', 'Planters & pots',
          'Sculptural Décor', 'Statues & busts', 'Urns', 'Vases', 'Other (describe)',
        ] },
      ],
      // Same published rates as the named card row. Keeps item/member tables from being duplicated.
      priceAs: {
        'Tapestries & textiles': 'Wall Decor',
        'Wall sculptures': 'Wall Decor',
        'Sconces': 'Table Lamp',
      },
      // 48"+ wall-décor surcharge from the card footnote.
      wallDecorKinds: ['Wall Decor', 'Tapestries & textiles', 'Wall sculptures'],
      hungDecor: ['Wall Decor', 'Wall sculptures', 'Tapestries & textiles', 'Mirror'],
      // Hanging/mounting these is not a published rate (electrical work may also apply for sconces).
      quoteHang: ['Chandelier', 'Sconces'],
      sizeLabels: {
        standard: [['small', 'Small / light'], ['medium', 'Medium / average'], ['large', 'Large / heavy']],
        accents: [['xs', 'Extra small'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['xl', 'Extra large']],
      },
      // Five unlabeled sizes on the printed card. Legacy `label` keeps older orders pricing on the first three tiers.
      accents: {
        label: 'Vases / Sculptural Décor / Accents / Figurines',
        kinds: [
          'Baskets', 'Bookends', 'Bowls & trays', 'Candle holders & candelabras',
          'Ceramics & pottery', 'Clocks', 'Decorative boxes', 'Figurines', 'Globes',
          'Lanterns', "Objets d'art", 'Picture frames (tabletop)', 'Planters & pots',
          'Sculptural Décor', 'Statues & busts', 'Urns', 'Vases',
          'Accents', 'Other (describe)',
        ],
        nonMember: [85, 140, 195, 250, 305],
        member: [65, 105, 145, 190, 230],
      },
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
    // Samantha, Nov 18 2026 (KB thread 1a1f0399ecb6ebd1): a 10-hour day holds 8 job rows (PU and DEL rows each count).
    // Hard ceiling: the ROUTE CALENDAR capacity column can only LOWER it for a day. At flagAtRows the team gets an alert.
    dailyJobCap: 8,
    flagAtRows: 6,
    // Remote areas: pencil-in, confirmed by the team within 1 business day (never auto-confirmed). Far north has no zone, so no dates are offered.
    remoteZones: ['Sacramento', 'Tahoe', 'SD', 'Coachella'],
    preferredPartners: ['paloma', 'aerena', 'ærena', 'caldwell snyder'],
    // NEED HELPER rules: over 150 lb, any sofa / heavy furniture regardless of weight, installs needing a ladder, stairwell or custom hang
    // (the site has no "Level" question, so these stand in for install Level 2/3 until Samantha defines them).
    helperRules: {
      holdOrders: false, // true: NEED HELPER orders are held for the team (date on hold until a helper is booked). false: only label NEED HELPER on the sheet.
      overLb: 150,
      heavyFurnitureKinds: ['Sofa', 'Loveseat', '2-Piece Sectional', '3-Piece Sectional', '4-Piece Sectional', 'Armoire', 'Buffet / Hutch', 'Credenza / Sideboard', 'Dresser', 'Desk', 'Dining Table', 'Headboard / Bed Frame', 'Storage Trunk / Chest', 'Vanity'],
      installProxy: { hangWhere: ['high', 'stairwell', 'other'], quoteHangKinds: ['Chandelier', 'Sconces'] },
    },
    showDays: 12,
    rushEnabled: true,
    // No regular route days on federal and major holidays, plus Thanksgiving Friday, Christmas Eve and New Year's Eve.
    // Weekend holidays also block the observed weekday. Extend this list each year (covers bookings out to the end of 2027).
    blackoutDates: [
      // 2026
      '2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2026-12-31',
      // Days the real SCHEDULE 2026 sheet shows as off or re-routed (checked against the sheet Nov 18, 2026). Held closed until
      // Samantha confirms (see lib/sheet-days.js, which also closes any day the live sheet marks off):
      '2026-11-23', '2026-11-24', '2026-11-25', // Thanksgiving week: Newport Beach/Palm Springs, San Diego, "Max drives North"
      '2026-11-30', // "Off day"
      '2026-12-28', '2026-12-29', '2026-12-30', // "Christmas day off"

      // 2027
      '2027-01-01', // New Year's Day
      '2027-01-18', // Martin Luther King Jr. Day
      '2027-02-15', // Presidents' Day
      '2027-03-28', // Easter Sunday
      '2027-05-31', // Memorial Day
      '2027-06-18', '2027-06-19', // Juneteenth (Sat) and observed Fri
      '2027-07-04', '2027-07-05', // Independence Day (Sun) and observed Mon
      '2027-09-06', // Labor Day
      '2027-10-11', // Columbus / Indigenous Peoples' Day
      '2027-11-11', // Veterans Day
      '2027-11-25', '2027-11-26', // Thanksgiving and the Friday after
      '2027-12-24', '2027-12-25', // Christmas Eve and Christmas Day (Sat)
      '2027-12-31', // New Year's Eve (also New Year's Day 2028 observed)
      '2028-01-01', // New Year's Day
    ],
    // Time-of-day guidance (CAD scheduling practice):
    // Routes are built from midday outward. Jobs typically run 10am–evening, with
    // preferred starts 11am–1pm. 8–9am is only used on packed days or for
    // hard-deadline / important clients — never offer or imply 8am availability
    // in the booking UI. Customers may note a before-10am need; we try but
    // cannot promise.
    timePrefs: [
      { value: 'none', label: 'No preference' },
      { value: 'midday', label: 'Midday' },
      { value: 'afternoon', label: 'Afternoon / later in the day' },
    ],
    socalZipMax: 935,
    // Simple OC Monday stop: 1–2 standard items only (not 1–3). Oversize paintings (72"+),
    // oversize wall décor (48"+), and sculpture over 700 lb are not booked as a simple stop.
    // Monday OC stops are NOT offered automatically (Samantha); an order that lands on one goes to team review. Set autoOffer true to bring the old offer back.
    simpleOcMonday: { maxStandardItems: 2, autoOffer: false },
    // Zone ids referenced by the weekly day catalog below.
    // Monday includes 'LA' in BOTH week types so LA customers can book either Monday.
    //
    // routeType (not in the source sheet; inferred from the Notes/Info tab route maps
    // and the day descriptions above):
    //   through     — one-way "through" days (the van keeps going). No flexibility note.
    //   downAndBack — out-and-back or hub-based days, more flexibility to come early
    //                 or on the way back. Shown as a small note when that day is selected.
    // Assumptions: NorCal Mon/Tue/Sat/Sun and SoCal Mon are through (directional runs).
    // NorCal Wed/Thu/Fri are down-and-back / based around San Jose. SoCal Tue Coachella,
    // Wed San Diego, and Thu Orange County (Irvine hub) are down-and-back from the hub.
    // Simple OC Monday stops sit at the hub start or return, so they are downAndBack
    // even though the rest of that Monday is a through LA run.
    dayCatalog: {
      NorCal: {
        0: { zones: ['Central', 'SB'], label: 'Central Coast → Santa Barbara (or on to LA)', shortLabel: 'Central Coast → SB', routeType: 'through' },
        1: { zones: ['LA', 'SB'], label: 'LA, heading northwest (SB late or Fresno very late)', shortLabel: 'LA · heading NW', routeType: 'through',
            simpleStops: [{ zone: 'OC', maxStandardItems: 2, label: 'OC simple stop (1–2 standard items) leaving the Irvine hub, then LA heading northwest', shortLabel: 'OC · simple stop', routeType: 'downAndBack' }] },
        2: { zones: ['Carmel'], label: 'Carmel, Salinas and Monterey Bay (night in San Jose)', shortLabel: 'Carmel / Monterey', routeType: 'through' },
        3: { zones: ['BayWest'], label: 'Silicon Valley, SF, Marin, Healdsburg, Cupertino', shortLabel: 'SV / SF / Marin', routeType: 'downAndBack' },
        4: { zones: ['EastBay', 'Sacramento', 'Tahoe'], label: 'Sacramento & surroundings; East Bay if quick', shortLabel: 'Sacramento / East Bay', routeType: 'downAndBack' },
        5: { zones: ['EastBay', 'NapaWine', 'BayWest'], label: 'East Bay, Napa; SF & Silicon Valley if quick', shortLabel: 'East Bay / Napa', routeType: 'downAndBack' },
        6: { zones: ['Carmel'], label: 'Carmel / Salinas (then toward SLO or Fresno)', shortLabel: 'Carmel / Salinas', routeType: 'through' },
      },
      SoCal: {
        0: { zones: [], label: 'No regular stops (OC overflow only)', overflow: true },
        1: { zones: ['LA'], label: 'LA, heading southeast toward the Irvine hub', shortLabel: 'LA · heading SE', routeType: 'through',
            simpleStops: [{ zone: 'OC', maxStandardItems: 2, label: 'OC simple stop (1–2 standard items) on the way back to the Irvine hub', shortLabel: 'OC · simple stop', routeType: 'downAndBack' }] },
        2: { zones: ['Coachella'], label: 'Coachella Valley', shortLabel: 'Coachella Valley', routeType: 'downAndBack' },
        3: { zones: ['SD'], label: 'San Diego County', shortLabel: 'San Diego County', routeType: 'downAndBack' },
        4: { zones: ['OC'], label: 'Orange County (Irvine hub)', shortLabel: 'Orange County', routeType: 'downAndBack' },
        5: { zones: [], label: 'No regular stops (OC overflow only)', overflow: true },
        6: { zones: [], label: 'No regular stops (OC overflow only)', overflow: true },
      },
    },
  },
};
