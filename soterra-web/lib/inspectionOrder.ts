import type { Category } from "./categories";

// ─── The order inspections happen in ─────────────────────────────────────
//
// From Auckland Council's "Building consents — information for contractors
// and construction industry professionals" (AC1229 V13, December 2024), the
// two "Typical order of notifiable inspections" flowcharts on pages 12-15.
//
// This is the bit of that booklet worth encoding rather than just indexing,
// because it answers questions prose can't:
//   • what comes next after framing?
//   • can I book pre-line building yet?
//   • what has to have PASSED before this one can?
//
// The last of those is the one that costs money. The council states three
// hard dependencies outright, and each is a wasted inspection fee plus a
// re-book if you get it wrong.

export type Stage = {
  /** Booking code where the flowchart stage maps to one. Several stages
   *  ("Strip footings", "Above ground blockwork") are steps within a code
   *  rather than codes of their own — those are left null rather than
   *  invented. */
  code: string | null;
  name: string;
  category: Category;
  /** Must have PASSED before this one can be approved. Council's own wording. */
  requires?: string[];
  /** Why, in the council's words — shown to the user, so it has to be exact. */
  requiresNote?: string;
  /** Only applies to some jobs (retaining, membrane decks, piled floors). */
  conditional?: string;
};

/** Residential, concrete floor — the main line of the flowchart. */
export const RESIDENTIAL_ORDER: Stage[] = [
  { code: "IRM", name: "Pre-construction meeting", category: "Other", conditional: "Required for all reclads and complex commercial work" },
  { code: "IFO", name: "Strip footings", category: "Structural" },
  { code: "ICB", name: "Below slab blockwork", category: "Structural" },
  { code: "ITK", name: "Tanking", category: "Weathertightness / Cladding", conditional: "If retaining — may be done with the blockwork or separately" },
  { code: "IPP", name: "Slab plumbing", category: "Plumbing & Drainage" },
  {
    code: "ISF", name: "Slab", category: "Structural",
    requires: ["Slab plumbing"],
    requiresNote: "Slab-building cannot be approved until slab plumbing has been completed.",
  },
  { code: "ICB", name: "Above ground blockwork", category: "Structural" },
  { code: "IFG", name: "Framing", category: "Structural" },
  { code: "ITK", name: "Membrane roof / deck", category: "Weathertightness / Cladding", conditional: "Where there's a membrane roof or deck" },
  { code: "ICA", name: "Wrap and cavity", category: "Weathertightness / Cladding" },
  { code: "ICL", name: "Cladding", category: "Weathertightness / Cladding" },
  { code: "IPP", name: "Pre-line plumbing", category: "Plumbing & Drainage" },
  {
    code: "IPB", name: "Pre-line building and insulation", category: "Interior / Linings",
    requires: ["Pre-line plumbing"],
    requiresNote: "Pre-line building cannot be approved until pre-line plumbing has been completed.",
  },
  { code: "IPL", name: "Post-line", category: "Interior / Linings" },
  { code: null, name: "Fire and acoustic rating", category: "Fire" },
  { code: "ITK", name: "Waterproofing", category: "Weathertightness / Cladding" },
  { code: "IF1", name: "Final", category: "Interior / Linings" },
  { code: null, name: "CCC", category: "Other" },
];

/** Timber piled foundations replace the first few stages above. */
export const PILED_START: Stage[] = [
  { code: "IRM", name: "Pre-construction meeting", category: "Other", conditional: "If required" },
  { code: "IFO", name: "Siting and piles", category: "Structural" },
  { code: "IFG", name: "Subfloor framing", category: "Structural", conditional: "May be done with the framing inspection or separately" },
];

export const COMMERCIAL_ORDER: Stage[] = [
  { code: "IRM", name: "Pre-construction meeting", category: "Other" },
  { code: null, name: "Audit", category: "Other", conditional: "Commercial jobs" },
  { code: "IFO", name: "Strip footings", category: "Structural" },
  { code: "IFO", name: "Piling", category: "Structural", conditional: "Where piled" },
  { code: "ICB", name: "Blockwork", category: "Structural" },
  { code: "ITK", name: "Tanking", category: "Weathertightness / Cladding", conditional: "If retaining — may be done with the blockwork or separately" },
  { code: "IPP", name: "Slab plumbing", category: "Plumbing & Drainage" },
  {
    code: "ISF", name: "Slab", category: "Structural",
    requires: ["Slab plumbing"],
    requiresNote: "Slab-building cannot be approved until slab plumbing has been completed.",
  },
  { code: "ICB", name: "Blockwork above ground", category: "Structural" },
  { code: "IFG", name: "Framing", category: "Structural" },
  { code: "ITK", name: "Membrane deck", category: "Weathertightness / Cladding" },
  { code: "ICA", name: "Wrap and cavity", category: "Weathertightness / Cladding" },
  {
    code: "ICL", name: "Claddings", category: "Weathertightness / Cladding",
    requires: ["Membrane deck"],
    requiresNote: "Membranes must be approved before cladding is completed.",
  },
  { code: "IPP", name: "Pre-line plumbing", category: "Plumbing & Drainage" },
  {
    code: "IPB", name: "Pre-line building", category: "Interior / Linings",
    requires: ["Pre-line plumbing"],
    requiresNote: "Pre-line building cannot be approved until pre-line plumbing has been completed.",
  },
  { code: "IPB", name: "Insulation", category: "Interior / Linings" },
  { code: null, name: "Above ceiling passive", category: "Fire" },
  { code: "IPL", name: "Post-line bracing", category: "Interior / Linings" },
  { code: null, name: "Fire rated walls and ceilings", category: "Fire" },
  { code: "ITK", name: "Waterproofing wet areas", category: "Weathertightness / Cladding" },
  { code: null, name: "Pre-CCC vet", category: "Other" },
  { code: "IF2", name: "Final", category: "Interior / Linings" },
  { code: null, name: "Code compliance certificate", category: "Other" },
  { code: null, name: "Compliance schedule", category: "Other", conditional: "Where the building has specified systems" },
];

/** Inspections the council says can happen at any point in the run, so they
 *  never belong in the main sequence. */
export const ANY_STAGE: { code: string | null; name: string; scope: "both" | "commercial" }[] = [
  { code: "IDT", name: "Drainage", scope: "both" },
  { code: "IFO", name: "Footings — isolated pads and footings", scope: "both" },
  { code: "IME", name: "Site meeting", scope: "both" },
  { code: "CPU", name: "Certificate for Public Use", scope: "commercial" },
];

/** Every hard "X cannot be approved until Y" the booklet states. Keyed by the
 *  booking code you're about to sit, since that's what a user picks. */
export function blockersFor(code: string | null | undefined): { needs: string; note: string }[] {
  if (!code) return [];
  const c = code.toUpperCase();
  const out: { needs: string; note: string }[] = [];
  for (const s of [...RESIDENTIAL_ORDER, ...COMMERCIAL_ORDER]) {
    if (s.code !== c || !s.requires) continue;
    for (const need of s.requires) {
      if (!out.some((o) => o.needs === need)) out.push({ needs: need, note: s.requiresNote ?? "" });
    }
  }
  return out;
}

/** What typically comes next, for "we've just passed framing — what now?" */
export function nextAfter(name: string, order: Stage[] = RESIDENTIAL_ORDER): Stage[] {
  const i = order.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());
  if (i < 0 || i === order.length - 1) return [];
  return order.slice(i + 1, i + 3);
}

/** A compact rendering for the assistant's cached system prompt — small
 *  enough to carry on every request, specific enough to answer "what's next"
 *  and "can I book this yet" without a tool call. */
export function orderForPrompt(): string {
  const line = (s: Stage) => `${s.name}${s.code ? ` (${s.code})` : ""}${s.conditional ? ` [${s.conditional}]` : ""}`;
  return `AUCKLAND COUNCIL INSPECTION ORDER (their booklet AC1229 V13, Dec 2024)

Residential, concrete floor — typical order:
${RESIDENTIAL_ORDER.map((s, i) => `${i + 1}. ${line(s)}`).join("\n")}

Timber piled foundations start instead with: ${PILED_START.map(line).join(" → ")}

Commercial — typical order:
${COMMERCIAL_ORDER.map((s, i) => `${i + 1}. ${line(s)}`).join("\n")}

Can happen at ANY stage: ${ANY_STAGE.map((s) => `${s.name}${s.code ? ` (${s.code})` : ""}`).join(", ")}.

HARD DEPENDENCIES — the council states these outright, and getting them wrong
costs a wasted inspection fee plus a re-book:
- Slab building cannot be approved until slab plumbing has been completed.
- Pre-line building cannot be approved until pre-line plumbing has been completed.
- Membranes must be approved before cladding is completed (commercial).

Any of these may happen more than once (two blockwork or slab inspections is
normal), and some can happen at the same time. Reclad inspection regimes differ
from the standard flowchart — say so rather than assuming.`;
}
