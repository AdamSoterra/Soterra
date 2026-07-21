// ─── The category map ────────────────────────────────────────────────────
//
// Every failed inspection item gets exactly one category. The counts on the
// Insights page are counts per category, so this file IS the product's opinion
// about what a builder keeps getting pulled up on.
//
// It is drafted from the 27 real Auckland Council reports in
// `All inspection reports/Council/` (270 distinct checklist line items across
// IPL, IPP, IPB, IFG, ICA, IF2, IDT and IME). ADAM MUST CHECK IT — see
// CATEGORY-MAP.md for the human-readable version and the judgement calls.
//
// How classification works, in order:
//   1. RULES below, first match wins. Deterministic and auditable, so the same
//      wording always lands in the same bucket no matter which model ran.
//   2. The extractor model's own suggestion, if it's a valid category.
//   3. The inspection code's default category.
//   4. "Other".
// Order inside RULES matters a lot: "fire lining" is Fire, not Interior;
// "fire damper" is Fire, not Mechanical; "riser hydrant" is Fire, not Access.

export const CATEGORIES = [
  "Structural",
  "Weathertightness / Cladding",
  "Fire",
  "Electrical",
  "Plumbing & Drainage",
  "Mechanical",
  "Interior / Linings",
  "Access & Barriers",
  "Site / External",
  "Acoustic",
  "Seismic",
  "Architect",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

// ─── Council inspection codes ────────────────────────────────────────────
// The council is still the dominant inspector, so its own codes are primary.
// `category` is only a FALLBACK for an item whose wording matched no rule —
// several inspections (pre-line, post-line, final) legitimately produce fails
// across half the categories, which is exactly why the item wording wins.
export const INSPECTION_CODES: Record<string, { name: string; category: Category }> = {
  IFO: { name: "Foundation", category: "Structural" },
  ISF: { name: "Slab / floor", category: "Structural" },
  IFG: { name: "Framing", category: "Structural" },
  IBF: { name: "Block fill", category: "Structural" },
  IPF: { name: "Pre-pour / reinforcing", category: "Structural" },
  ICA: { name: "Cavity wrap", category: "Weathertightness / Cladding" },
  ICL: { name: "Cladding", category: "Weathertightness / Cladding" },
  ITK: { name: "Waterproofing / tanking", category: "Weathertightness / Cladding" },
  IRF: { name: "Roofing", category: "Weathertightness / Cladding" },
  IDT: { name: "Drainage", category: "Plumbing & Drainage" },
  IDP: { name: "Drainage pre-cover", category: "Plumbing & Drainage" },
  IPP: { name: "Plumbing", category: "Plumbing & Drainage" },
  IPB: { name: "Pre-line building", category: "Interior / Linings" },
  IPL: { name: "Post-line", category: "Interior / Linings" },
  IF1: { name: "Final (residential)", category: "Interior / Linings" },
  IF2: { name: "Final (commercial)", category: "Interior / Linings" },
  IME: { name: "Site meeting", category: "Other" },
  IMV: { name: "Minor variation", category: "Other" },
};

/** Readable name for a council code — "ICA" → "Cavity wrap". */
export function codeName(code: string | null | undefined): string | null {
  if (!code) return null;
  return INSPECTION_CODES[code.toUpperCase()]?.name ?? null;
}

// ─── Item wording → category ─────────────────────────────────────────────
// Each rule is [regex, category]. FIRST MATCH WINS, so the exceptions
// ("fire lining", "fire damper", "emergency lighting") sit above the general
// rules they'd otherwise be swallowed by.
const RULES: [RegExp, Category][] = [
  // ── Fire first: it steals words from nearly every other category. Passive
  //    fire is by far the most-failed thing in the sample set (30+ line items).
  [/\bpassive fire|fire ?stop|firestop|fire collar|fire wrap|fire sleeve|fire seal|fire lin(?:ing|ed)|fire rated|fire[- ]resist|fire wall|fire cell|frr\b|fire curtain|fire damper|fire door|smoke door|smoke seal|intumescent|fire glazing|fire design|fire report|fire alarm|manual call point|smoke detector|heat detector|exit sign|emergency light|sprinkler|hydrant|fire service|non-?combustib|penetration.*fire|fire.*penetration|service penetration|final exit|fire blocked|fire protection/i, "Fire"],

  // ── Seismic before Structural/Mechanical: restraints and clearances read as
  //    both, and Adam's prediction is that this is the top "electrical" item.
  [/\bseismic|sway brace|service restraint|restrained? (?:for|against) earthquake|bracing of services|seismic (?:gap|clearance|restraint)/i, "Seismic"],

  // ── Acoustic before Interior: "intertenancy walls- acoustic system".
  [/\bacoustic|\bstc\b|\biic\b|sound (?:seal|insulation|transmission|rating)|noise (?:level|control)|inter-?tenancy/i, "Acoustic"],

  // ── Weathertightness: the cavity/wrap/flashing/membrane family.
  [/\bcavity|building wrap|rigid air barrier|\brab\b|flashing|weather ?(?:tight|proof)|\bcladding\b|membrane|saddle|upstand|apron|brick (?:rebate|veneer|tie)|capillary gap|deck\/?balcony|threshold step|roof(?:ing)? (?:underlay|junction|penetration)|soffit|spouting|gutter|downpipe|tanking|waterproof|damp ?proof|\bdpc\b|joinery.*(?:tape|air seal)|window (?:flashing|seal)|vermin proof|drainage enabled|wrap (?:restraint|lapped|returned)/i, "Weathertightness / Cladding"],

  // ── Plumbing & drainage: also catches the hot-water cylinder family.
  [/\bplumb|drain(?:age|layer|s)?\b|foul water|storm ?water|waste ?water|water supply|\bpipe(?:s|work)?\b|gully|\btrap(?:s|ped)?\b|air admittance|\bhwc\b|hot water|cylinder|tempering valve|\btpr\b|backflow|back flow|non return valve|sanitary|gradient|\bvent(?:s|ing|ed)?\b|tundish|overflow relief|syphon|cesspit|reflux valve|inspection junction|\bmanhole|non-?potable|\bg13\b|\bg12\b|as\/?nzs ?3500/i, "Plumbing & Drainage"],

  // ── Electrical. Note the fire rules above already took the intumescent
  //    flush-box pads, which the council files under passive fire.
  [/\belectric(?:al|ity)?\b|flush box|switchboard|distribution board|\bcable(?:s|way|tray)?\b|conduit|earth(?:ing|ed|bond)|\bsocket|luminaire|light fitting|\blighting\b|power (?:outlet|supply|point)|\bcomms?\b|data (?:cabling|outlet)|\bmeter box/i, "Electrical"],

  // ── Mechanical.
  [/\bhvac\b|mechanical (?:services|plant)|ventilation|\bduct(?:s|work|ing)?\b|extract(?:or|ion)|air ?condition|heat pump|\bfan\b|make-?up air|\bdamper/i, "Mechanical"],

  // ── Structural.
  [/\bframing\b|\bstud(?:s)?\b|\blintel|\bbeam(?:s)?\b|\bbracing\b|\bbrace(?:s|d)?\b|bottom plate|top plate|foundation|\bslab\b|\bfooting|reinforc|\brebar\b|\bpile(?:s|d)?\b|\btruss|portal|point load|diaphragm|structural (?:steel|stability|design)|\bengineer(?:'s)? (?:confirm|approval|review)|moisture content|timber (?:treatment|grade)|\bh1\.2\b|\bsg8\b|notches and holes|bearing|tie ?down|anchor|block ?wall|strapping|pallet racking/i, "Structural"],

  // ── Access & barriers (F4 falls, stairs, D1 access routes).
  [/\bbarrier|balustrade|handrail|\bstair(?:s|case|well)?\b|\bramp\b|accessible|\bf4\b|restrictor|opening.*(?:100 ?mm|1 ?m wide)|door width|landing|nosing|riser (?:height|and going)|\bgoing\b|clear width|wheelchair|access hatch|\bd1\b/i, "Access & Barriers"],

  // ── Interior / linings (after Fire and Acoustic have taken theirs).
  [/\blining(?:s)?\b|\bgib\b|plasterboard|\bwet area|shower|\btile(?:s|d|ing)?\b|insulation|\br-?value|ceiling|stopp(?:ed|ing)|floor covering|slip resistance|manifestation|safety glass|\bglazing\b|impervious|coved|vanity|\bbasin\b|kitchen|laundry|\bsheet (?:fixing|edge|lining)|back ?block|building interior|\bnzs ?2208/i, "Interior / Linings"],

  // ── Site / external.
  [/\bsite safety|excavat|retaining|\bfenc(?:e|ing)|driveway|paving|ground (?:level|clearance)|erosion|sediment|\bsite (?:tidy|access)|boundary|landscap|stormwater (?:detention|soak)/i, "Site / External"],

  // ── Architect: consultant observation reports about setout / finish /
  //    conformance with the architectural documents, when nothing else fits.
  [/\barchitect|as per (?:the )?architectural|setout|set-?out|\bfinish(?:es)? schedule|colour|aesthetic|\bdetail \d|non-?conformance with (?:the )?drawings/i, "Architect"],
];

/**
 * Deterministic classifier. Returns null when nothing matches, so the caller
 * can fall back to the model's suggestion and then to the inspection code.
 */
export function categoryFromText(text: string): Category | null {
  const t = (text || "").trim();
  if (!t) return null;
  for (const [re, cat] of RULES) if (re.test(t)) return cat;
  return null;
}

/**
 * The one place a category is decided. Rules win, then the model's suggestion,
 * then the inspection code's default, then "Other".
 */
export function classify(opts: {
  title: string;
  detail?: string | null;
  suggested?: string | null;
  inspectionCode?: string | null;
}): { category: Category; by: "rule" | "model" | "code" | "fallback" } {
  const byRule = categoryFromText(opts.title) ?? categoryFromText(opts.detail ?? "");
  if (byRule) return { category: byRule, by: "rule" };
  if (isCategory(opts.suggested) && opts.suggested !== "Other") return { category: opts.suggested, by: "model" };
  const code = opts.inspectionCode ? INSPECTION_CODES[opts.inspectionCode.toUpperCase()] : undefined;
  if (code) return { category: code.category, by: "code" };
  return { category: "Other", by: "fallback" };
}

// Display order on the Insights page when counts tie — roughly "how much it
// costs you when it fails".
export const CATEGORY_ORDER: Category[] = [...CATEGORIES];

// Colour per category, reusing the app palette so Insights matches the calendar.
export const CATEGORY_COLOR: Record<Category, string> = {
  Fire: "#EF4444",
  "Weathertightness / Cladding": "#0E74BD",
  Structural: "#0A2540",
  "Plumbing & Drainage": "#06B6D4",
  Electrical: "#F59E0B",
  Mechanical: "#8B5CF6",
  "Interior / Linings": "#10B981",
  "Access & Barriers": "#EC4899",
  "Site / External": "#65A30D",
  Acoustic: "#7C3AED",
  Seismic: "#B45309",
  Architect: "#0891B2",
  Other: "#94A6BE",
};
