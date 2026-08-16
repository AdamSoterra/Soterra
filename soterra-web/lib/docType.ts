// ─── Document types — the Documents tab's picker and the assistant's
//     precedence labels ────────────────────────────────────────────────────
//
// Every uploaded document gets ONE of these. Detection is deliberately
// filename-first (people name construction documents well: "Fire Report.pdf",
// "4711 Masterspec.pdf", "A-101 Floor Plan.pdf") with the first page's text as
// the tiebreak. When nothing matches we call it a drawing: that is exactly
// what the app assumed about every upload before types existed, so the
// fallback never CHANGES behaviour, only fails to improve it — and the
// Documents tab lets a human correct it in one tap.

export const DOC_TYPES = ["drawings", "specs", "reports", "scopes", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  drawings: "Drawings",
  specs: "Specifications",
  reports: "Reports & PS",
  scopes: "Scopes",
  other: "Other",
};

/** What each type is, for the assistant's tool results — one line each. */
export const DOC_TYPE_NOTE: Record<DocType, string> = {
  drawings: "a project drawing/plan sheet",
  specs: "the project specification (materials, products, standards - same precedence level as the drawings)",
  reports: "a consultant report or producer statement (governs its own discipline)",
  scopes: "a subcontractor scope of works (what a trade is contracted to do - not a design document)",
  other: "a project document",
};

const isType = (v: unknown): v is DocType => typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);

/** Null-safe read for DB values: untyped legacy rows read as drawings, the
 *  pre-types behaviour. */
export function docTypeOf(v: string | null | undefined): DocType {
  return isType(v) ? v : "drawings";
}

// Signals, most specific first. A spec titled "Architectural Specification"
// must land on the spec rule before "architectural" can read as a drawing set,
// and "Fire Report" must never fall through to Fire drawings.
const RULES: { type: DocType; re: RegExp }[] = [
  // Producer statements: PS1-PS4, with or without separators.
  { type: "reports", re: /\bPS[\s-]?[1-4]\b|\bproducer statement\b/i },
  // Specifications: the word, or NZ's Masterspec.
  { type: "specs", re: /\bspecifications?\b|\bmasterspec\b|\bspecs?\b/i },
  // Named consultant/engineering reports and design features reports.
  {
    type: "reports",
    re: /\b(fire|geotech(nical)?|acoustic|structural|seismic|engineering|assessment|design features|DSA|traffic|stormwater)\s+(report|design|statement)\b|\bfire engineering\b|\breport\b.{0,20}\b(fire|geotech|acoustic|structural|seismic)\b/i,
  },
  // Subcontractor scopes and trade packages. SOW is its own case-sensitive
  // rule: lowercase "sow" is an English word and must not match.
  { type: "scopes", re: /\bscope of works?\b|\bsub-?contract(or)?\b|\btrade (package|scope)\b/i },
  { type: "scopes", re: /\bSOW\b/ },
  // Consents, contracts, insurances — filed, not designed from.
  { type: "other", re: /\b(building|resource) consent\b|\bcontract (works|agreement)\b|\binsurance\b|\bwarrant(y|ies)\b|\bminutes\b/i },
];

// Drawing-ish signals, used only as a positive confirmation (the fallback is
// drawings anyway; this exists so a match can stop us reading the first page).
const DRAWINGISH =
  /\b(floor plans?|site plans?|plans?|elevations?|sections?|details?|drawings?|general arrangement|GA|RCP|reflected ceiling|bracing|setout)\b|(^|[\s_-])[A-Z]{1,3}[-.]?\d{2,4}([\s_.-]|$)/i;

/**
 * Classify a document from its filename and (optionally) its first page of
 * text. Filename wins; the page text only breaks a filename that said nothing.
 */
export function detectDocType(filename: string, firstPageText?: string | null): DocType {
  const name = filename.replace(/\.pdf$/i, "");
  // Two unambiguous tokens outrank everything, including the sheet-code
  // shortcut below — "PS1-Structural.pdf" and "4711-Masterspec.pdf" both start
  // like a sheet code but are never drawings.
  if (/^PS[\s-]?[1-4]\b/i.test(name)) return "reports";
  if (/masterspec/i.test(name)) return "specs";
  // A name that STARTS with a sheet code (S0.01-, A3-00-0000-, 44000-,
  // AR109209-01-) is a sheet out of a drawing set, whatever its title says —
  // sets are full of "GENERAL NOTES & SPECIFICATIONS" title sheets that are
  // not the project specification.
  if (/^[A-Za-z]{0,4}\d[\d.]*[-.]/.test(name)) return "drawings";
  for (const r of RULES) if (r.re.test(name)) return r.type;
  if (DRAWINGISH.test(name)) return "drawings";
  const text = (firstPageText || "").slice(0, 4000);
  if (text) {
    for (const r of RULES) if (r.re.test(text)) return r.type;
  }
  return "drawings";
}
