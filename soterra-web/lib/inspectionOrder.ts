import type { Category } from "./categories";

// ─── The order inspections happen in ─────────────────────────────────────
//
// From Auckland Council's "Building consents — information for contractors
// and construction industry professionals" (AC1229 V13, December 2024), the
// two "Typical order of notifiable inspections" flowcharts on pages 12-15.
//
// This is the bit of that booklet worth encoding rather than just indexing,
// because it answers questions prose can't: what comes next after framing,
// can I book pre-line yet, what has to have PASSED before this one can.
//
// The charts are drawings, so this file was checked box-by-box and
// arrow-by-arrow against them. Things that check found and this now gets
// right: Tanking hangs off Strip footings (not off Below slab blockwork);
// the commercial Audit spans Pre-construction all the way to Framing; the
// piled branch rejoins at Framing; the residential "any stage" inspections
// are capped at stage 10, not unlimited; and the membrane-before-cladding
// rule is COMMERCIAL ONLY.
//
// ⚠️ The booking CODES below are not from this booklet — its Appendix 2 isn't
// in the published PDF. They come from the council's "Types of building
// inspections" page. Where the two disagree on wording, the booking page wins,
// because that's the name you actually book under.

export type Stage = {
  /** Booking code where the flowchart stage maps to one. Several stages
   *  ("Above ground blockwork", "Audit") are steps within a code rather than
   *  codes of their own — those are null rather than invented. */
  code: string | null;
  name: string;
  category: Category;
  /** On the chart's main horizontal run? Only these are numbered, because the
   *  council's own "up to stage 10" note counts the main row. */
  main: boolean;
  /** For a branch box: the main-row stage it hangs off. */
  after?: string;
  /** For a branch box: the main-row stage its arrow rejoins. */
  rejoins?: string;
  /** Must have PASSED before this one can be approved. */
  requires?: string[];
  /** The council's exact wording, verbatim — it's quoted to the user. */
  requiresNote?: string;
  /** Only applies to some jobs. Marked when it's our paraphrase, not theirs. */
  conditional?: string;
};

/** Residential, concrete floor. 12 main-row stages, 6 branches. */
export const RESIDENTIAL_ORDER: Stage[] = [
  { code: "IRM", name: "Pre-construction", category: "Other", main: true, conditional: "If required — the booklet says a pre-construction meeting must be booked for all reclads and complex commercial work" },
  { code: "IFO", name: "Strip footings", category: "Structural", main: true },
  { code: "ICB", name: "Below slab blockwork", category: "Structural", main: true },
  { code: "ISF", name: "Slab", category: "Structural", main: true, requires: ["Slab plumbing"], requiresNote: "Slab-building cannot be approved until slab plumbing has been completed." },
  { code: "ICB", name: "Above ground blockwork", category: "Structural", main: true },
  { code: "IFG", name: "Framing", category: "Structural", main: true },
  { code: "ICA", name: "Wrap and cavity", category: "Weathertightness / Cladding", main: true },
  { code: "ICL", name: "Cladding", category: "Weathertightness / Cladding", main: true },
  { code: "IPB", name: "Pre-line building and insulation", category: "Interior / Linings", main: true, requires: ["Pre-line plumbing"], requiresNote: "Pre-line building cannot be approved until pre-line plumbing has been completed." },
  { code: "IPL", name: "Postline", category: "Interior / Linings", main: true },
  { code: "ITK", name: "Water-proofing", category: "Weathertightness / Cladding", main: true },
  { code: "IF1", name: "Final", category: "Interior / Linings", main: true },
  // Branches. Tanking and Below slab blockwork are PARALLEL — both fan into
  // Slab plumbing — so tanking is not "after" the blockwork.
  { code: "ITK", name: "Tanking", category: "Weathertightness / Cladding", main: false, after: "Strip footings", rejoins: "Slab plumbing", conditional: "If retaining — may be done with the blockwork or as a separate inspection" },
  { code: "IPP", name: "Slab plumbing", category: "Plumbing & Drainage", main: false, after: "Strip footings", rejoins: "Slab" },
  { code: "ITK", name: "Membrane roof/deck", category: "Weathertightness / Cladding", main: false, after: "Framing", rejoins: "Wrap and cavity" },
  { code: "IPP", name: "Pre-line plumbing", category: "Plumbing & Drainage", main: false, after: "Cladding", rejoins: "Pre-line building and insulation" },
  { code: null, name: "Fire and acoustic rating", category: "Fire", main: false, after: "Postline", rejoins: "Water-proofing" },
  { code: null, name: "CCC", category: "Other", main: false, after: "Final" },
];

/** Timber piled foundations replace everything up to Framing. */
export const PILED_START: Stage[] = [
  { code: "IRM", name: "Pre-construction", category: "Other", main: true, conditional: "If required" },
  { code: "IFO", name: "Siting and piles", category: "Structural", main: true },
  { code: "IFG", name: "Subfloor framing", category: "Structural", main: true, rejoins: "Framing", conditional: "May be done with the framing inspection or as a separate one" },
];

/** Commercial. 13 main-row stages, 11 branches. */
export const COMMERCIAL_ORDER: Stage[] = [
  { code: "IRM", name: "Pre-construction meeting", category: "Other", main: true },
  { code: "IFO", name: "Strip footings", category: "Structural", main: true },
  { code: "ICB", name: "Blockwork", category: "Structural", main: true },
  { code: "ISF", name: "Slab", category: "Structural", main: true, requires: ["Slab plumbing"], requiresNote: "Slab-building cannot be approved until slab plumbing has been completed." },
  { code: "ICB", name: "Blockwork above ground", category: "Structural", main: true },
  { code: "IFG", name: "Framing", category: "Structural", main: true },
  { code: "ICA", name: "Wrap and cavity", category: "Weathertightness / Cladding", main: true },
  { code: "ICL", name: "Claddings", category: "Weathertightness / Cladding", main: true, requires: ["Membrane deck"], requiresNote: "Membranes must be approved before cladding is completed." },
  { code: "IPB", name: "Preline building", category: "Interior / Linings", main: true, requires: ["Preline plumbing"], requiresNote: "Pre-line building cannot be approved until pre-line plumbing has been completed." },
  { code: "IPB", name: "Insulation", category: "Interior / Linings", main: true },
  { code: "IPL", name: "Postline bracing", category: "Interior / Linings", main: true },
  { code: "ITK", name: "Waterproofing wet areas", category: "Weathertightness / Cladding", main: true },
  { code: "IF2", name: "Final", category: "Interior / Linings", main: true },
  // Branches. The Audit arc spans the whole substructure phase.
  { code: null, name: "Audit", category: "Other", main: false, after: "Pre-construction meeting", rejoins: "Framing" },
  { code: "IFO", name: "Piling", category: "Structural", main: false, after: "Strip footings", conditional: "Where piled" },
  { code: "ITK", name: "Tanking", category: "Weathertightness / Cladding", main: false, after: "Blockwork", rejoins: "Slab plumbing", conditional: "If retaining — may be done with the blockwork or as a separate inspection" },
  { code: "IPP", name: "Slab plumbing", category: "Plumbing & Drainage", main: false, after: "Blockwork", rejoins: "Slab" },
  { code: "ITK", name: "Membrane deck", category: "Weathertightness / Cladding", main: false, after: "Framing", rejoins: "Wrap and cavity" },
  { code: "IPP", name: "Preline plumbing", category: "Plumbing & Drainage", main: false, after: "Claddings", rejoins: "Preline building" },
  { code: null, name: "Above ceiling passive", category: "Fire", main: false, after: "Insulation", rejoins: "Postline bracing" },
  { code: null, name: "Fire rated walls and ceilings", category: "Fire", main: false, after: "Postline bracing", rejoins: "Waterproofing wet areas" },
  { code: null, name: "Pre-CCC vet", category: "Other", main: false, after: "Waterproofing wet areas", rejoins: "Final" },
  { code: null, name: "Code compliance certificate", category: "Other", main: false, after: "Final" },
  { code: null, name: "Compliance schedule", category: "Other", main: false, after: "Code compliance certificate", conditional: "Where the building has specified systems" },
];

/**
 * Inspections that don't sit in the main run. The residential chart caps them:
 * "These 3 inspections may occur at any point up to stage 10" — stage 10 on
 * that chart's main row is Postline. The commercial chart has no cap: "These 4
 * inspection types may occur at any stage."
 */
export const ANY_STAGE: { code: string | null; name: string; scope: "both" | "commercial"; upTo?: string }[] = [
  { code: "IDT", name: "Drainage", scope: "both", upTo: "Postline" },
  { code: "IFO", name: "Footing (isolated pads and footings)", scope: "both", upTo: "Postline" },
  { code: "IME", name: "Site meeting", scope: "both", upTo: "Postline" },
  // The chart prints "Certificate of public use"; the council's booking page
  // calls it "Certificate for Public Use (CPU)". Booking name wins.
  { code: "CPU", name: "Certificate for Public Use", scope: "commercial" },
];

/**
 * Gates the booklet states in prose rather than on the charts. Both stop an
 * inspection dead, so they belong with the chart dependencies.
 */
export const PROCESS_GATES = [
  { applies: "any", text: "Inspections may only proceed if the variation has been documented and approved.", where: "AC1229 p5" },
  { applies: "final", text: "Prior to final inspection, you must have obtained producer statements (where applicable) and included them with the inspection records documents.", where: "AC1229 p4" },
  { applies: "any", text: "The booklet, any specialist reports (e.g. fire report) and all approved plans must be printed and available onsite in hard copy for all inspections. Specifications and manufacturers' literature may be digital.", where: "AC1229 p3" },
] as const;

export type Blocker = { needs: string; note: string; scope: "residential" | "commercial" | "both" };

/**
 * Every hard "X cannot be approved until Y", keyed by the booking code you're
 * about to sit.
 *
 * Scope matters and used to leak: ICL is the code for residential "Cladding"
 * AND commercial "Claddings", but membranes-before-cladding is drawn on the
 * COMMERCIAL chart only. Merging the two arrays handed a residential builder a
 * commercial-only rule as "the council's own wording". Each blocker now carries
 * the chart it came from, so the caller can label it instead of asserting it.
 */
export function blockersFor(code: string | null | undefined): Blocker[] {
  if (!code) return [];
  const c = code.toUpperCase();
  const seen = new Map<string, Blocker>();
  const collect = (order: Stage[], scope: "residential" | "commercial") => {
    for (const s of order) {
      if (s.code !== c || !s.requires) continue;
      for (const need of s.requires) {
        // Normalised, because the two charts spell the same box differently —
        // residential "Pre-line plumbing", commercial "Preline plumbing". Keyed
        // on the raw string, one rule showed up twice with opposite scopes.
        const key = `${need.toLowerCase().replace(/[^a-z]/g, "")}|${s.requiresNote}`;
        const prev = seen.get(key);
        // The same rule on both charts applies to both.
        if (prev) prev.scope = "both";
        else seen.set(key, { needs: need, note: s.requiresNote ?? "", scope });
      }
    }
  };
  collect(RESIDENTIAL_ORDER, "residential");
  collect(COMMERCIAL_ORDER, "commercial");
  return [...seen.values()];
}

/** What typically comes next. Searches both charts, so a commercial-only stage
 *  ("Insulation") doesn't silently return nothing. */
export function nextAfter(name: string): Stage[] {
  const low = name.toLowerCase();
  for (const order of [RESIDENTIAL_ORDER, COMMERCIAL_ORDER]) {
    const main = order.filter((s) => s.main);
    const i = main.findIndex((s) => s.name.toLowerCase() === low);
    if (i >= 0) return main.slice(i + 1, i + 3);
    // A branch box points at where it rejoins.
    const branch = order.find((s) => !s.main && s.name.toLowerCase() === low);
    if (branch?.rejoins) {
      const j = main.findIndex((s) => s.name === branch.rejoins);
      if (j >= 0) return main.slice(j, j + 2);
    }
  }
  // The piled branch rejoins the main run at Framing.
  const piled = PILED_START.find((s) => s.name.toLowerCase() === low);
  if (piled?.rejoins) {
    const j = RESIDENTIAL_ORDER.filter((s) => s.main).findIndex((s) => s.name === piled.rejoins);
    if (j >= 0) return RESIDENTIAL_ORDER.filter((s) => s.main).slice(j, j + 2);
  }
  return [];
}

/** A compact rendering for the assistant's cached system prompt. Only the
 *  MAIN-ROW stages are numbered, so the council's "up to stage 10" lines up
 *  with this list instead of landing two boxes early. */
export function orderForPrompt(): string {
  const label = (s: Stage) => `${s.name}${s.code ? ` (${s.code})` : ""}${s.conditional ? ` [${s.conditional}]` : ""}`;
  const render = (order: Stage[]) => {
    const main = order.filter((s) => s.main);
    return main
      .map((s, i) => {
        const branches = order.filter((b) => !b.main && b.after === s.name);
        const kids = branches.map((b) => `\n     ↳ ${label(b)}${b.rejoins ? ` → rejoins at ${b.rejoins}` : ""}`).join("");
        return `${i + 1}. ${label(s)}${kids}`;
      })
      .join("\n");
  };
  return `AUCKLAND COUNCIL INSPECTION ORDER (their booklet AC1229 V13, Dec 2024). Numbers below are the chart's main-run stages.

Residential, concrete floor:
${render(RESIDENTIAL_ORDER)}

Timber piled foundations replace stages 1-5: ${PILED_START.map(label).join(" → ")} — subfloor framing then rejoins the run at Framing (stage 6).

Commercial:
${render(COMMERCIAL_ORDER)}

MAY HAPPEN AT ANY STAGE — residential: ${ANY_STAGE.filter((s) => s.scope === "both").map((s) => `${s.name}${s.code ? ` (${s.code})` : ""}`).join(", ")}, but only up to stage 10 (Postline). Commercial: the same three plus Certificate for Public Use (CPU), with no stage limit.

HARD DEPENDENCIES — the council states these outright, and getting one wrong means the inspector turns up, can't approve it, and you pay full price and re-book:
- Slab-building cannot be approved until slab plumbing has been completed. (both)
- Pre-line building cannot be approved until pre-line plumbing has been completed. (both)
- Membranes must be approved before cladding is completed. (COMMERCIAL chart only — don't state it as a rule on a residential job)

ALSO STOPS AN INSPECTION, from the booklet's text rather than the charts:
${PROCESS_GATES.map((g) => `- ${g.text}`).join("\n")}

Any of these may happen more than once (two blockwork or slab inspections is normal) and some can run at the same time — the branches above are parallel to the main run, not extra steps in it. Reclad regimes differ from the standard flowchart, and this is AUCKLAND's order: say so rather than assuming it holds elsewhere.`;
}
