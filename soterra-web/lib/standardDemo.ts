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

export const STANDARD_DEMOS: StandardDemoSet[] = [
  {
    ref: "NZS 3604:2011",
    slug: "nzs-3604-2011",
    // Only attach these pages when the answer is genuinely about a lintel, so a
    // stud or bracing question doesn't get handed the lintel tables.
    topic: /lintel/i,
    pages: [
      { page: 209, label: "Table 8.8 — which lintel table applies" },
      { page: 210, label: "Table 8.9 — lintel supporting roof only" },
      { page: 211, label: "Table 8.10 — lintel supporting roof and wall" },
    ],
  },
];

/** The rendered pages available for a standards answer, or [] when we have none
 *  for this standard/topic. `context` is whatever text describes the answer
 *  (the question, or the "holds" line), used to keep pages on-topic. */
export function demoPagesFor(standardRef: string, context: string): { slug: string; pages: StandardDemoPage[] } | null {
  const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase().match(/(\d{3,4}(?:\.\d+)?)/)?.[1] ?? "";
  const k = norm(standardRef);
  const set = STANDARD_DEMOS.find((d) => norm(d.ref) === k);
  if (!set) return null;
  if (!set.topic.test(context)) return null;
  return { slug: set.slug, pages: set.pages };
}
