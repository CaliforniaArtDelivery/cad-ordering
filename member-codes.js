/**
 * CAD member codes — add a line here to give a new member the 25% rate.
 *
 * This file is server-side only. The ordering form never receives this list.
 *
 * To override without editing this file, set the MEMBER_CODES env var:
 *   MEMBER_CODES=JONES-TERWILLIGER:Jones & Terwilliger,PALOMAS:Paloma's Home Furnishings
 *
 * Codes are matched case-insensitively after trimming whitespace.
 */
module.exports = [
  { code: 'JONES-TERWILLIGER', company: 'Jones & Terwilliger' },
  { code: 'PALOMAS', company: "Paloma's Home Furnishings" },
];
