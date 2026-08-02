import { sql } from "drizzle-orm";
import { db } from "./db";

// ─── MBIE determinations ──────────────────────────────────────────────────
//
// A determination is MBIE's binding ruling on a specific dispute: an owner and
// a council disagreed about whether something complies, and MBIE decided it.
// That makes them the only public record of how the Building Code gets applied
// at the boundary, which is exactly where a builder's question lives ("the
// council failed me on X, are they right?").
//
// Searched in Postgres rather than the in-memory TF-IDF used for the Code, for
// two reasons: the corpus is ~6,100 pages (nearly double code_pages) and would
// be loaded into every warm lambda, and it grows to ~1,359 documents if the
// range is ever widened back to 2005.
//
// ⚠️ AUTHORITY: a determination decides ONE case on ITS facts. It is evidence of
// how the Code was read, never the rule itself. Every caller must present it
// with its year and must defer to the current Acceptable Solution for any
// figure. MBIE say this themselves, and older determinations cite Acceptable
// Solutions that have since been superseded.

export type DeterminationHit = {
  ref: string; // "2024/001"
  year: number;
  subject: string | null;
  page: number;
  npages: number;
  text: string;
};

/**
 * Full-text search over the determinations corpus. Returns at most one page per
 * determination (the best-matching one), so eight results mean eight different
 * rulings rather than eight pages of the same one.
 */
export async function searchDeterminations(
  query: string,
  opts: { limit?: number; fromYear?: number } = {}
): Promise<DeterminationHit[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.min(Math.max(opts.limit ?? 6, 1), 20);
  const fromYear = opts.fromYear ?? 0;

  // websearch_to_tsquery takes ordinary prose (and quoted phrases) without
  // throwing on punctuation, unlike to_tsquery.
  const rows = await db.execute(sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${q}) AS tq)
    SELECT ref, year, subject, page, npages, text
    FROM (
      SELECT DISTINCT ON (d.ref)
             d.ref, d.year, d.subject, d.page, d.npages, d.text,
             ts_rank(d.tsv, q.tq) AS rank
      FROM determination_pages d, q
      WHERE d.tsv @@ q.tq AND d.year >= ${fromYear}
      ORDER BY d.ref, ts_rank(d.tsv, q.tq) DESC, d.page ASC
    ) best
    ORDER BY rank DESC, year DESC
    LIMIT ${limit}
  `);

  const list = (rows as unknown as { rows?: Record<string, unknown>[] }).rows ?? (rows as unknown as Record<string, unknown>[]);
  return (list ?? []).map((r) => ({
    ref: String(r.ref),
    year: Number(r.year),
    subject: r.subject == null ? null : String(r.subject),
    page: Number(r.page),
    npages: Number(r.npages),
    text: String(r.text),
  }));
}

/** The citation label. The YEAR is always present: currency has to be visible,
 *  because a 2019 ruling may cite an Acceptable Solution that has since changed. */
export function determinationLabel(d: DeterminationHit): string {
  return `Determination ${d.ref}${d.subject ? " · " + d.subject : ""} · page ${d.page} of ${d.npages}`;
}

/** How many determinations are loaded, and the year span. */
export async function determinationStats(): Promise<{ docs: number; pages: number; minYear: number; maxYear: number } | null> {
  const rows = await db.execute(sql`
    SELECT count(DISTINCT ref)::int AS docs, count(*)::int AS pages,
           coalesce(min(year), 0)::int AS "minYear", coalesce(max(year), 0)::int AS "maxYear"
    FROM determination_pages
  `);
  const list = (rows as unknown as { rows?: Record<string, unknown>[] }).rows ?? (rows as unknown as Record<string, unknown>[]);
  const r = list?.[0];
  if (!r) return null;
  return { docs: Number(r.docs), pages: Number(r.pages), minYear: Number(r.minYear), maxYear: Number(r.maxYear) };
}
