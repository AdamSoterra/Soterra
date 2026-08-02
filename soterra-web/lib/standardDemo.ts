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
export type StandardDemoSet = { ref: string; slug: string; topic: RegExp; pages: StandardDemoPage[] };

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
  },
  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    // Minimum concrete cover to reinforcing steel.
    topic: /\b(concrete cover|cover to (?:the )?(?:steel|reinforc)|reinforc|rebar|reo)\b/i,
    pages: [
      { page: 73, label: "Clause 4.5.1 — concrete cover to reinforcing" },
    ],
  },
];

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase().match(/(\d{3,4}(?:\.\d+)?)/)?.[1] ?? "";

/** The rendered pages available for a standards answer, or null when we have
 *  none for this standard/topic. `context` is whatever text describes the answer
 *  (the question plus the "holds" line), used to keep pages on-topic. First
 *  entry whose standard AND topic match wins. */
export function demoPagesFor(standardRef: string, context: string): { slug: string; pages: StandardDemoPage[] } | null {
  const k = norm(standardRef);
  if (!k) return null;
  const set = STANDARD_DEMOS.find((d) => norm(d.ref) === k && d.topic.test(context));
  return set ? { slug: set.slug, pages: set.pages } : null;
}

/** Whether (slug, page) is a page we actually rendered — the gate the render
 *  route checks so no arbitrary page can be requested. Considers every topic
 *  entry for that slug, not just the first. */
export function isStandardDemoPage(slug: string, page: number): boolean {
  return STANDARD_DEMOS.some((d) => d.slug === slug && d.pages.some((p) => p.page === page));
}
