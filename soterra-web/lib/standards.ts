// ─── NZ Standards we can POINT AT but must never QUOTE ────────────────────
//
// The Building Code routes to a Standard constantly ("comply with NZS 3604"),
// and the Standard, not the Code, holds the actual number. We are not licensed
// to reproduce Standards content, so the honest answer names the standard and
// the section and stops there.
//
// The important fact most people get wrong, including us until we checked: these
// are NOT paywalled. MBIE's Building System Performance branch sponsors free
// view-and-print access under copyright licence LN001498. Anyone can download a
// single PDF copy for their own use. What is restricted is REPRODUCTION.
//
// So this registry exists to make the handoff CONCRETE: the exact reference, the
// edition, which Code clauses it serves, and the link to get it free. The model
// names the standard; the edition and URL come from here, never from the model,
// for the same reason manufacturer documents resolve against our own list.
//
// Source: standards.govt.nz sponsored building-related standards, read 3 Aug 2026.

export type SponsoredStandard = {
  /** As the Code cites it, e.g. "NZS 3604:2011". */
  ref: string;
  title: string;
  /** Building Code clauses this standard is cited by. */
  clauses: string[];
  url: string;
};

const SHOP = "https://www.standards.govt.nz";

export const SPONSORED: SponsoredStandard[] = [
  { ref: "NZS 1170.5:2004", title: "Structural design actions, Part 5: Earthquake actions", clauses: ["A1", "B1", "G12"], url: `${SHOP}/shop/NZS-1170-52004-EXCLUDES-AMDT-1` },
  { ref: "NZS 3101.1&2:2006", title: "Concrete structures standard", clauses: ["B1", "B2"], url: `${SHOP}/shop/NZS-3101-1-AND-22006-INC-A1-A2-A3` },
  { ref: "NZS 3109:1997", title: "Concrete construction", clauses: ["B1"], url: `${SHOP}/shop/NZS-31091997` },
  { ref: "NZS 3404 Parts 1 and 2:1997", title: "Steel structures standard", clauses: ["B1"], url: `${SHOP}/shop/NZS-3404-PARTS-1-AND-21997` },
  { ref: "NZS 3604:2011", title: "Timber-framed buildings", clauses: ["B1", "B2", "E1", "E2", "G12", "G13"], url: `${SHOP}/shop/NZS-36042011` },
  { ref: "NZS 4219:2009", title: "Seismic performance of engineering systems in buildings", clauses: ["B1", "G10", "G14"], url: `${SHOP}/shop/NZS-42192009` },
  { ref: "NZS 4223.3:2016", title: "Glazing in buildings, Part 3: Human impact safety requirements", clauses: ["B1", "D2", "F2"], url: `${SHOP}/shop/NZS-4223-32016` },
  { ref: "NZS 4229:2013", title: "Concrete masonry buildings not requiring specific engineering design", clauses: ["B1", "E1", "G13"], url: `${SHOP}/shop/NZS-42292013` },
  { ref: "SNZ TS 3404:2018", title: "Durability requirements for steel structures and components", clauses: ["B1", "B2"], url: `${SHOP}/shop/SNZ-TS-34042018` },
  { ref: "NZS 4512:2010", title: "Fire detection and alarm systems in buildings", clauses: ["C1", "C2", "C3", "C4", "C5", "C6", "F7"], url: `${SHOP}/shop/NZS-45122010` },
  { ref: "NZS 4514:2009", title: "Interconnected smoke alarms for houses", clauses: ["C1", "C2", "F7"], url: `${SHOP}/shop/NZS-45142009` },
  { ref: "NZS 4121:2001", title: "Design for access and mobility: Buildings and associated facilities", clauses: ["D1", "G1", "G5"], url: `${SHOP}/shop/NZS-41212001` },
  { ref: "NZS 8500:2006", title: "Safety barriers and fences around swimming pools, spas and hot tubs", clauses: ["F9"], url: `${SHOP}/shop/NZS-85002006` },
  { ref: "NZS 4218:2009", title: "Thermal insulation, housing and small buildings", clauses: ["H1"], url: `${SHOP}/shop/NZS-42182009` },
  { ref: "NZS 4246:2016", title: "Energy efficiency, installing bulk thermal insulation in residential buildings", clauses: ["H1"], url: `${SHOP}/shop/NZS-42462016` },
];

/** Just the digits that identify a standard: "NZS 3604:2011" and "nzs3604" both
 *  reduce to "3604", so the model naming it loosely still resolves. Part numbers
 *  are kept ("4223.3" stays distinct from "4223"). */
function key(s: string): string {
  const m = s.replace(/\s+/g, "").toUpperCase().match(/(\d{3,4}(?:\.\d+)?)/);
  return m ? m[1] : "";
}

/** Resolve a loosely-written standard name to the sponsored registry. Returns
 *  null for anything we don't hold a verified record of, so the card never
 *  invents an edition or a link. */
export function resolveStandard(name: string): SponsoredStandard | null {
  const k = key(name);
  if (!k) return null;
  const exact = SPONSORED.find((s) => key(s.ref) === k);
  if (exact) return exact;
  // "NZS 4223" with no part number → the part we actually hold.
  return SPONSORED.find((s) => key(s.ref).split(".")[0] === k) ?? null;
}

/** The standards a given Code clause routes to, e.g. "F2" → NZS 4223.3. */
export function standardsForClause(clause: string): SponsoredStandard[] {
  const c = clause.trim().toUpperCase();
  return SPONSORED.filter((s) => s.clauses.includes(c));
}
