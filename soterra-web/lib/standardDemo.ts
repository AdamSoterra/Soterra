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
   *  from that account's own licensed copy — never to any other user.
   *  OPTIONAL: most topics carry pages only. Without an answer the assistant
   *  gives the qualitative handoff and the card opens the real page; that is
   *  the default posture, and an answer is added only after hand-verification
   *  against the rendered page (see the corrosion entry for why). */
  answer?: string;
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
      // Two-storey case, caption read from the rendered page 2026-08-18.
      { page: 212, label: "Table 8.11 - Lintel supporting roof, wall and floor for all wind zones - SG 8 for up to 2 kPa floor loads" },
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
      // The map that tells you WHICH zone you are in (both islands). Captions
      // read from the rendered pages 2026-08-18; page 65 is the North Island,
      // page 66 ("continued") the South Island.
      { page: 65, label: "Figure 4.2 - Exposure zone map" },
      { page: 66, label: "Figure 4.2 - Exposure zone map (continued)" },
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

  // ── The entries below carry PAGES ONLY, no transcribed answer. ────────────
  // Added 2026-08-18. Every page number and caption below was confirmed by
  // rendering the page and reading it (dev/render-standard-pages.mjs); the
  // caption text is the page's own printed caption. The assistant still gives
  // only the qualitative handoff for these topics — the figure lives on the
  // rendered page the user opens, never in our text.

  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    // Bracing demand and capacity (Section 5). The demand tables are stated
    // for 2 kPa floor load, soil D/E, EQ zone 3, with multiplication factors
    // for the other zones printed under each table.
    topic: /\bbrac(?:e|es|ed|ing)/i,
    pages: [
      { page: 81, label: "Table 5.4 - Determination of wind zone" },
      { page: 87, label: "Figure 5.4 - Earthquake zones" }, // North Island
      { page: 88, label: "Figure 5.4 - Earthquake zones (continued)" }, // South Island
      { page: 90, label: "Table 5.8 - Bracing demand for various combinations of cladding on single-storey buildings on subfloor framing (2 kPa floor load, soil type D/E, earthquake zone 3)" },
      { page: 91, label: "Table 5.9 - Bracing demand for various combinations of cladding for two-storey buildings on subfloor framing (2 kPa floor load, soil type D/E, earthquake zone 3)" },
      { page: 92, label: "Table 5.10 - Bracing demand for various combinations of cladding for single and two-storey buildings on concrete slab-on-ground (2 kPa floor load, soil type D/E, earthquake zone 3)" },
    ],
  },
  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    // Roof members (Section 10). Checked BEFORE the floor-joist topic so a
    // "ceiling joist" question lands here, not on the floor tables. Page 297
    // carries both purlin tables (flat and edge) on the one page.
    topic: /\b(rafters?|purlins?|underpurlins?|ridge\s?beams?|ceiling\s?joists?|ceiling\s?runners?|roof\s?fram)/i,
    pages: [
      { page: 270, label: "Table 10.1 - Rafters for all wind zones - SG 8" },
      { page: 278, label: "Table 10.3 - Ceiling joists - SG 8" },
      { page: 281, label: "Table 10.5 - Underpurlins for all wind zones - SG 8" },
      { page: 297, label: "Tables 10.10 and 10.11 - Purlins on their flat / on their edge in all wind zones - SG 8" },
    ],
  },
  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    // Floor joists (Section 7). Table 7.1 holds both halves on the one page:
    // (a) 1.5 kPa dry in service and (b) 2 kPa / wet in service.
    topic: /\bjoists?\b/i,
    pages: [
      { page: 147, label: "Table 7.1 - Floor joists - SG 8 up to 2 kPa floor loads" },
    ],
  },
  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    // Studs and plates (Section 8). Table 8.2 spans two pages: (a) single or
    // top storey on 197, (b) lower of two storeys on 198.
    topic: /\b(studs?|plates?|wall\s?fram)/i,
    pages: [
      { page: 197, label: "Table 8.2 - Studs in loadbearing walls for all wind zones - SG 8" },
      { page: 198, label: "Table 8.2 - Studs in loadbearing walls for all wind zones - SG 8 (continued)" },
      { page: 219, label: "Table 8.16 - Top plates of loadbearing walls - SG 8" },
    ],
  },
  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    // Foundations and subfloor (Section 6).
    topic: /\b(piles?|footings?|bearers?|foundations?|subfloor)\b/i,
    pages: [
      { page: 104, label: "Table 6.1 - Pile footings" },
      { page: 134, label: "Table 6.4 - Bearers - SG 8 for up to 2 kPa floor loads" },
    ],
  },
  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    // "Which zone am I in" — the maps and the wind-zone procedure. Kept LAST
    // among the 3604 entries so a member-sizing question that merely mentions
    // its wind zone is routed to the member tables above, not here.
    topic: /\b(wind\s?zones?|earthquake\s?zones?|exposure\s?zones?|corrosion\s?zones?|topographic)\b/i,
    pages: [
      { page: 65, label: "Figure 4.2 - Exposure zone map" },
      { page: 66, label: "Figure 4.2 - Exposure zone map (continued)" },
      { page: 81, label: "Table 5.4 - Determination of wind zone" },
      { page: 87, label: "Figure 5.4 - Earthquake zones" },
      { page: 88, label: "Figure 5.4 - Earthquake zones (continued)" },
    ],
  },

  // ─── NZS 4229:2013 Concrete masonry buildings ─────────────────────────────
  // Same licensed-copy arrangement as 3604: pages rendered from Adam's own
  // copy, served only to the demo-corpus account. Pages verified 2026-08-18.
  {
    ref: "NZS 4229:2013",
    slug: "nzs-4229-2013",
    // Masonry lintels (Section 11), 190 mm deep by block series. The 390 mm
    // deep tables (11.4-11.6) are not rendered; say so rather than guessing.
    topic: /lintel/i,
    pages: [
      { page: 114, label: "Table 11.1 - 190 mm deep lintels: 15 Series" },
      { page: 115, label: "Table 11.2 - 190 mm deep lintels: 20 Series" },
      { page: 116, label: "Table 11.3 - 190 mm deep lintels: 25 Series" },
    ],
  },
  {
    ref: "NZS 4229:2013",
    slug: "nzs-4229-2013",
    // Bond beams (Section 10).
    topic: /\bbond\s?beams?\b/i,
    pages: [
      { page: 108, label: "Table 10.1 - Bond beam - Maximum spans" },
    ],
  },
  {
    ref: "NZS 4229:2013",
    slug: "nzs-4229-2013",
    // Footings for masonry walls (Section 6). Table 6.1 gives the wall weight
    // that sets the contributing load Table 6.2 is entered with.
    topic: /\b(footings?|foundations?)\b/i,
    pages: [
      { page: 56, label: "Table 6.2 - Dimensions and reinforcement details for footings" },
      { page: 55, label: "Table 6.1 - Wall types and wall weights" },
    ],
  },
  {
    ref: "NZS 4229:2013",
    slug: "nzs-4229-2013",
    // Wall reinforcement (Section 8). Page 82 carries Tables 8.2 AND 8.3 on
    // the one page (partially filled and solid-filled walls).
    topic: /\b(reinforc|rebar|bars?\b|grout|block|filled|vertical\s?load)/i,
    pages: [
      { page: 82, label: "Tables 8.2 and 8.3 - Reinforcement for partially filled / solid-filled masonry structural walls" },
      { page: 81, label: "Table 8.1 - Vertical load capacity of wall" },
    ],
  },
];

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase().match(/(\d{3,4}(?:\.\d+)?)/)?.[1] ?? "";

/** The rendered pages available for a standards answer, or null when we have
 *  none for this standard/topic. `context` is whatever text describes the answer
 *  (the question plus the "holds" line), used to keep pages on-topic. First
 *  entry whose standard AND topic match wins. `answer` is present only for the
 *  hand-verified transcriptions; page-only topics leave it out and the caller
 *  falls back to the qualitative handoff. */
export function demoPagesFor(standardRef: string, context: string): { slug: string; pages: StandardDemoPage[]; answer?: string } | null {
  const k = norm(standardRef);
  if (!k) return null;
  const set = STANDARD_DEMOS.find((d) => norm(d.ref) === k && d.topic.test(context));
  return set ? { slug: set.slug, pages: set.pages, ...(set.answer ? { answer: set.answer } : {}) } : null;
}

/** Whether (slug, page) is a page we actually rendered — the gate the render
 *  route checks so no arbitrary page can be requested. Considers every topic
 *  entry for that slug, not just the first. */
export function isStandardDemoPage(slug: string, page: number): boolean {
  return STANDARD_DEMOS.some((d) => d.slug === slug && d.pages.some((p) => p.page === page));
}
