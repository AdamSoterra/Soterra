// ─── Personal-use standards demo (NOT shipped to customers) ───────────────
//
// A tiny hand-authored map from a standard + topic to the specific pages we
// rendered from Adam's OWN licensed copy (see dev/render-standard-demo.mjs).
// Served only through /api/standard-page, gated to DEMO_CORPUS_USERS, so this
// is visible to one account for personal evaluation and to nobody else.
//
// This holds NO standard content: only page numbers and the table's own name.
// The values themselves are never in our system as text; they exist only as the
// rendered page image the user reads for themselves. That is the whole design:
// point at the page, never reproduce the table.

export type StandardDemoPage = { page: number; label: string };
export type StandardDemoSet = {
  ref: string; slug: string; topic: RegExp; pages: StandardDemoPage[];
  /** The correct answer, HAND-TRANSCRIBED from the page (the auto-extracted
   *  tables come out column-major and would state the wrong figure). Returned
   *  only to a demo-corpus account, so the assistant can answer with the figure
   *  from that account's own licensed copy — never to any other user. */
  answer: string;
};

// One entry per demo topic. Each is matched on its own keyword regex so a
// lintel question gets the lintel tables and a corrosion question gets the
// durability tables — never the wrong ones. Order matters: the first entry
// whose ref AND topic match wins (lintel is checked before fixings so a
// "lintel fixing" phrasing still lands on the lintel tables).
export const STANDARD_DEMOS: StandardDemoSet[] = [
  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    topic: /lintel/i,
    pages: [
      { page: 209, label: "Table 8.8 — which lintel table applies" },
      { page: 210, label: "Table 8.9 — lintel supporting roof only" },
      { page: 211, label: "Table 8.10 — lintel supporting roof and wall" },
    ],
    answer:
      // ⚠️ VERIFIED against the rendered Table 8.9 page 2026-08-04. The table
      // gives MAXIMUM SPAN per lintel size per loaded dimension, so read down to
      // the loaded dimension and across to the first size whose span is >= 2.4.
      "For a lintel supporting the roof only in a single-storey house, SG8 timber, over a 2.4 m clear opening (Table 8.9): with a LIGHT roof a 190 x 70 covers a loaded dimension up to 3 m (its limit is 2.4 m span at that loaded dimension), 190 x 90 takes you to a 4 m loaded dimension, and at 6 m you need 240 x 90. With a HEAVY roof, 240 x 70 covers a loaded dimension up to 3 m, 240 x 90 to 4 m, and at 6 m you need 290 x 90. Loaded dimension is roughly half the roof span bearing on the lintel, taken off the plans; these tables apply for all wind zones.",
  },
  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    // Corrosion / fixing material by exposure zone (coastal, sea spray).
    topic: /\b(fixing|fixings|nail|nails|screw|screws|galvan|stainless|corros|coast|sea[\s-]?spray|rust|durabil)\b/i,
    pages: [
      { page: 71, label: "Table 4.1 — fixings protection by corrosion zone" },
      { page: 72, label: "Table 4.3 — nails and screws by corrosion zone" },
    ],
    // ⚠️ VERIFIED against the rendered pages 2026-08-04, after an earlier
    // transcription of this answer was found to be WRONG. It had applied Table
    // 4.1's "sheltered AND exposed → stainless" rule to nails and screws, but
    // 4.1 explicitly EXCLUDES nails and screws — those are Table 4.3, where Zone
    // D sheltered framing is galvanized, not stainless. The two tables must not
    // be merged. Re-read both pages before ever editing this string.
    answer:
      "In a sea-spray site (corrosion exposure Zone D) it depends on the fixing and on where it sits. For framing NAILS AND SCREWS (Table 4.3): stainless steel in EXPOSED areas, galvanized steel in SHELTERED areas, and mild steel in closed areas including roof spaces — stainless nails being minimum Type 304 with annular grooves. For other structural FIXINGS such as bolts, brackets, nail plates and wire dogs (Table 4.1, which excludes nails and screws): Type 304 stainless steel in both sheltered and exposed. \"Sheltered\" means above a 45-degree line drawn from the lower edge of a projecting weathertight structure such as a floor, roof or deck; \"exposed\" is below that line. So galvanised nails are NOT sufficient for EXPOSED framing on the coast, but they are acceptable in sheltered locations in Zone D. Note also that nails, screws and other fixings into piles within 600 mm of the ground must be stainless steel regardless.",
  },
  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    // Minimum concrete cover to reinforcing steel.
    topic: /\b(concrete cover|cover to (?:the )?(?:steel|reinforc)|reinforc|rebar|reo)\b/i,
    pages: [
      { page: 73, label: "Clause 4.5.1 — concrete cover to reinforcing" },
    ],
    answer:
      "Minimum concrete cover to the reinforcing steel (clause 4.5.1): 75 mm when the concrete is cast directly against the ground, 50 mm when placed in formwork, and 30 mm from the top of an interior floor slab (50 mm from the top of an exposed slab).",
  },
];

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase().match(/(\d{3,4}(?:\.\d+)?)/)?.[1] ?? "";

/** The rendered pages available for a standards answer, or null when we have
 *  none for this standard/topic. `context` is whatever text describes the answer
 *  (the question plus the "holds" line), used to keep pages on-topic. First
 *  entry whose standard AND topic match wins. */
export function demoPagesFor(standardRef: string, context: string): { slug: string; pages: StandardDemoPage[]; answer: string } | null {
  const k = norm(standardRef);
  if (!k) return null;
  const set = STANDARD_DEMOS.find((d) => norm(d.ref) === k && d.topic.test(context));
  return set ? { slug: set.slug, pages: set.pages, answer: set.answer } : null;
}

/** Whether (slug, page) is a page we actually rendered — the gate the render
 *  route checks so no arbitrary page can be requested. Considers every topic
 *  entry for that slug, not just the first. */
export function isStandardDemoPage(slug: string, page: number): boolean {
  return STANDARD_DEMOS.some((d) => d.slug === slug && d.pages.some((p) => p.page === page));
}
