import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { inspectionItems, inspections, projects } from "./schema";
import type { Scope } from "./company";
import { CATEGORIES, type Category } from "./categories";
import type { ExtractedInspection } from "./inspectionExtract";

// ─── The company-scoped history layer ────────────────────────────────────
//
// EVERY read and write of inspection history goes through this file, and every
// function takes a `Scope` as its first argument. A Scope can only be minted by
// lib/company.ts::resolveScope(), which derives companyId from a verified
// project membership — so a route that forgot to authorise the caller cannot
// even construct the argument. That's the whole point: the filter isn't
// something you remember to add, it's something you can't leave out.

/** Store one inspection + its failed items. Re-ingesting the same document on
 *  the same site REPLACES it, so a re-upload corrects the counts rather than
 *  doubling them. */
export async function saveInspection(
  scope: Scope,
  input: {
    doc: string;
    file?: string | null;
    eventId?: string | null;
    extracted: ExtractedInspection;
    createdBy?: string | null;
  }
): Promise<{ inspectionId: string; items: number }> {
  const { extracted } = input;

  const [row] = await db
    .insert(inspections)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      doc: input.doc,
      file: input.file ?? null,
      source: extracted.source,
      inspectionCode: extracted.inspectionCode,
      inspectionType: extracted.inspectionType,
      inspector: extracted.inspector,
      outcome: extracted.outcome,
      inspectedOn: extracted.inspectedOn,
      eventId: input.eventId ?? null,
      itemCount: extracted.items.length,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoUpdate({
      target: [inspections.projectId, inspections.doc],
      set: {
        file: input.file ?? null,
        source: extracted.source,
        inspectionCode: extracted.inspectionCode,
        inspectionType: extracted.inspectionType,
        inspector: extracted.inspector,
        outcome: extracted.outcome,
        inspectedOn: extracted.inspectedOn,
        itemCount: extracted.items.length,
      },
    })
    .returning({ id: inspections.id });

  // Replace this inspection's items wholesale — a re-run of the extractor
  // should correct the history, not append a second copy of it.
  await db.delete(inspectionItems).where(and(eq(inspectionItems.inspectionId, row.id), eq(inspectionItems.companyId, scope.companyId)));

  if (extracted.items.length) {
    await db.insert(inspectionItems).values(
      extracted.items.map((it) => ({
        companyId: scope.companyId,
        projectId: scope.projectId,
        inspectionId: row.id,
        category: it.category,
        title: it.title,
        detail: it.detail,
        location: it.location,
        inspectionCode: extracted.inspectionCode,
        inspectedOn: extracted.inspectedOn,
      }))
    );
  }

  return { inspectionId: row.id, items: extracted.items.length };
}

export type CategoryCount = { category: Category; count: number };
export type TopItem = {
  title: string;
  category: Category;
  /** How many INSPECTIONS this item appeared on — not how many rows it filed.
   *  Council reports carry a rolling "items to be resolved" register, so one
   *  unfixed fire door reappears on every subsequent report. Counting rows
   *  turned one defect into "failed 23 times", which is wrong by an order of
   *  magnitude on the founder's own data. Distinct inspections is the honest
   *  number, and first→last seen is the genuinely useful one: how long the
   *  thing stayed open. */
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
};

/** The shared grouping key: the first 5 words of the title, lowercased, with
 *  every run of punctuation and whitespace collapsed to ONE space.
 *
 *  Two bugs lived here. Punctuation was replaced character-by-character with a
 *  space and the empty strings were kept, so "Head/ sill/ jamb" burned three of
 *  the window's slots on nothing and identical defects split into separate
 *  groups. And the window was 6 words, so "Cavity battens as per plan" (5
 *  words) could never merge with "Cavity battens as per plan and installed
 *  correctly" — the exact pair the old comment claimed it merged. */
const TITLE_GROUP = (col: unknown) =>
  sql<string>`lower(array_to_string((string_to_array(trim(regexp_replace(${col}, '[^a-zA-Z0-9]+', ' ', 'g')), ' '))[1:5], ' '))`;

/** Failed items per category, company-wide. This IS the Insights page. */
export async function categoryCounts(scope: Scope): Promise<CategoryCount[]> {
  const rows = await db
    .select({ category: inspectionItems.category, count: sql<number>`count(*)::int` })
    .from(inspectionItems)
    .where(eq(inspectionItems.companyId, scope.companyId))
    .groupBy(inspectionItems.category);
  const byName = new Map(rows.map((r) => [r.category, r.count]));
  return CATEGORIES.map((c) => ({ category: c, count: byName.get(c) ?? 0 })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
}

/** The individual things this company keeps failing, most-repeated first.
 *  Grouped on the normalised title (see TITLE_GROUP) and counted by DISTINCT
 *  INSPECTION, so a rolling carried-forward register can't inflate one open
 *  item into a pile of "failures". */
export async function topItems(scope: Scope, opts: { category?: string | null; limit?: number } = {}): Promise<TopItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 100);
  const where = opts.category
    ? and(eq(inspectionItems.companyId, scope.companyId), eq(inspectionItems.category, opts.category))
    : eq(inspectionItems.companyId, scope.companyId);

  const rows = await db
    .select({
      grp: TITLE_GROUP(inspectionItems.title),
      title: sql<string>`min(${inspectionItems.title})`,
      category: sql<string>`min(${inspectionItems.category})`,
      count: sql<number>`count(distinct ${inspectionItems.inspectionId})::int`,
      firstSeen: sql<string | null>`min(${inspectionItems.inspectedOn})`,
      lastSeen: sql<string | null>`max(${inspectionItems.inspectedOn})`,
    })
    .from(inspectionItems)
    .where(where)
    .groupBy(sql`1`)
    .orderBy(sql`count(distinct ${inspectionItems.inspectionId}) desc`)
    .limit(limit);

  return rows.map((r) => ({ title: r.title, category: r.category as Category, count: r.count, firstSeen: r.firstSeen, lastSeen: r.lastSeen }));
}

/** Past inspections — the bottom half of the Insights page. Company-wide by
 *  default, because "what failed on the last cavity wrap?" is rarely a
 *  this-site-only question. */
export async function listInspections(scope: Scope, opts: { projectOnly?: boolean; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 300);
  const where = opts.projectOnly
    ? and(eq(inspections.companyId, scope.companyId), eq(inspections.projectId, scope.projectId))
    : eq(inspections.companyId, scope.companyId);

  return db
    .select({
      id: inspections.id,
      doc: inspections.doc,
      projectId: inspections.projectId,
      projectName: projects.name,
      source: inspections.source,
      inspectionCode: inspections.inspectionCode,
      inspectionType: inspections.inspectionType,
      outcome: inspections.outcome,
      inspectedOn: inspections.inspectedOn,
      itemCount: inspections.itemCount,
      createdAt: inspections.createdAt,
    })
    .from(inspections)
    .leftJoin(projects, eq(projects.id, inspections.projectId))
    .where(where)
    .orderBy(desc(sql`coalesce(${inspections.inspectedOn}, to_char(${inspections.createdAt}, 'YYYY-MM-DD'))`))
    .limit(limit);
}

/** Delete one filed inspection and its items. Company-scoped like every other
 *  read and write in this file. This existed nowhere for a long time, so a
 *  badly-read report was permanent short of raw SQL — the only "fix" was
 *  re-uploading a file with the identical name and hoping the upsert replaced
 *  it. Items first: inspection_items has no cascade. */
export async function deleteInspection(scope: Scope, inspectionId: string): Promise<boolean> {
  const [head] = await db
    .select({ id: inspections.id })
    .from(inspections)
    .where(and(eq(inspections.id, inspectionId), eq(inspections.companyId, scope.companyId)))
    .limit(1);
  if (!head) return false;
  await db.delete(inspectionItems).where(and(eq(inspectionItems.inspectionId, inspectionId), eq(inspectionItems.companyId, scope.companyId)));
  await db.delete(inspections).where(and(eq(inspections.id, inspectionId), eq(inspections.companyId, scope.companyId)));
  return true;
}

/** Every failed item on one inspection. */
export async function inspectionDetail(scope: Scope, inspectionId: string) {
  const [head] = await db
    .select()
    .from(inspections)
    .where(and(eq(inspections.id, inspectionId), eq(inspections.companyId, scope.companyId)))
    .limit(1);
  if (!head) return null;
  const items = await db
    .select({ id: inspectionItems.id, category: inspectionItems.category, title: inspectionItems.title, detail: inspectionItems.detail, location: inspectionItems.location })
    .from(inspectionItems)
    .where(and(eq(inspectionItems.inspectionId, inspectionId), eq(inspectionItems.companyId, scope.companyId)));
  return { inspection: head, items };
}

/**
 * Free-text search across this company's failure history — the data behind the
 * assistant's `search_history` tool ("what failed on the last cavity wrap?").
 *
 * Deliberately NOT wired into RFI drafting: an RFI goes to the consultant, and
 * a previous answer may sit under a different plan revision or a different
 * engineer's requirement. Surfacing "we asked this before" there is a silent
 * killer. See BUILD-PLAN.md §4.
 */
/** Question words and glue that carry no meaning in an item title. Without
 *  this, "what failed on the last cavity wrap?" searched for "the" — and since
 *  ILIKE '%the%' is a substring match, it scored a hit inside
 *  "Weathertightness", ranking an unrelated row equal to the real one. */
const SEARCH_STOPWORDS = new Set([
  "the", "and", "for", "was", "were", "what", "when", "where", "which", "with",
  "this", "that", "these", "those", "from", "have", "has", "had", "not", "are",
  "you", "your", "our", "did", "does", "doing", "how", "why", "who", "get",
  "got", "can", "could", "would", "should", "there", "here", "been", "being",
  "about", "any", "all", "last", "next", "time", "keep", "keeps", "kept",
]);

/** Turn a question into search terms: meaningful words only, folded to their
 *  singular so "flashings" finds "flashing". The fold matters more than it
 *  looks: ILIKE '%flashing%' matches "flashings", but '%flashings%' does NOT
 *  match "flashing" — the plural excluded the right rows from the WHERE
 *  entirely, not just ranked them low. Exported so it can be tested as a pure
 *  function. */
export function historySearchTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  const terms = words
    .filter((w) => !SEARCH_STOPWORDS.has(w))
    // Strip a plural s, but not from "ss" endings (access, harness) and not
    // from short words where the stem gets too greedy as a substring.
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return [...new Set(terms)].slice(0, 8);
}

export async function searchHistory(
  scope: Scope,
  query: string,
  opts: { code?: string | null; category?: string | null; limit?: number } = {}
) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 60);
  const terms = historySearchTerms(query);

  const conds = [eq(inspectionItems.companyId, scope.companyId)];
  if (opts.code) conds.push(eq(inspectionItems.inspectionCode, opts.code.toUpperCase()));
  if (opts.category) conds.push(eq(inspectionItems.category, opts.category));
  if (terms.length) {
    // OR across the terms, ranked below by how many matched — a plain ILIKE on
    // the whole phrase matches almost nothing on real inspector wording.
    conds.push(sql`(${sql.join(terms.map((t) => sql`(${inspectionItems.title} ILIKE ${"%" + t + "%"} OR coalesce(${inspectionItems.detail}, '') ILIKE ${"%" + t + "%"})`), sql` OR `)})`);
  }

  const rank = terms.length
    ? sql<number>`(${sql.join(terms.map((t) => sql`(case when ${inspectionItems.title} ILIKE ${"%" + t + "%"} then 2 when coalesce(${inspectionItems.detail}, '') ILIKE ${"%" + t + "%"} then 1 else 0 end)`), sql` + `)})`
    : sql<number>`0`;

  return db
    .select({
      title: inspectionItems.title,
      detail: inspectionItems.detail,
      location: inspectionItems.location,
      category: inspectionItems.category,
      inspectionCode: inspectionItems.inspectionCode,
      inspectedOn: inspectionItems.inspectedOn,
      projectName: projects.name,
      score: rank,
    })
    .from(inspectionItems)
    .leftJoin(projects, eq(projects.id, inspectionItems.projectId))
    .where(and(...conds))
    .orderBy(desc(rank), desc(inspectionItems.inspectedOn))
    .limit(limit);
}

/** What this company keeps failing on a given inspection type — the "what we
 *  personally keep failing" source for a checklist. Same grouping and same
 *  distinct-inspection counting as topItems, for the same rolling-register
 *  reason. */
export async function historyForCode(scope: Scope, code: string, limit = 12): Promise<TopItem[]> {
  const rows = await db
    .select({
      grp: TITLE_GROUP(inspectionItems.title),
      title: sql<string>`min(${inspectionItems.title})`,
      category: sql<string>`min(${inspectionItems.category})`,
      count: sql<number>`count(distinct ${inspectionItems.inspectionId})::int`,
      firstSeen: sql<string | null>`min(${inspectionItems.inspectedOn})`,
      lastSeen: sql<string | null>`max(${inspectionItems.inspectedOn})`,
    })
    .from(inspectionItems)
    .where(and(eq(inspectionItems.companyId, scope.companyId), eq(inspectionItems.inspectionCode, code.toUpperCase())))
    .groupBy(sql`1`)
    .orderBy(sql`count(distinct ${inspectionItems.inspectionId}) desc`)
    .limit(limit);
  return rows.map((r) => ({ title: r.title, category: r.category as Category, count: r.count, firstSeen: r.firstSeen, lastSeen: r.lastSeen }));
}

/** Headline numbers for the top of the Insights page.
 *
 *  `graded` is the one that matters: a consultant's site observation report
 *  carries no overall pass/fail, so its outcome is 'unknown'. Counting those in
 *  the denominator produced a "0% passed first time" headline off twelve
 *  reports that were never graded in the first place — a made-up number in the
 *  largest text on the page. The pass rate is now only ever computed over
 *  inspections that actually have a verdict. */
export async function historySummary(scope: Scope) {
  const [row] = await db
    .select({
      inspections: sql<number>`(select count(*)::int from ${inspections} where ${inspections.companyId} = ${scope.companyId})`,
      failedItems: sql<number>`(select count(*)::int from ${inspectionItems} where ${inspectionItems.companyId} = ${scope.companyId})`,
      graded: sql<number>`(select count(*)::int from ${inspections} where ${inspections.companyId} = ${scope.companyId} and ${inspections.outcome} in ('pass','partial','fail'))`,
      cleanPasses: sql<number>`(select count(*)::int from ${inspections} where ${inspections.companyId} = ${scope.companyId} and ${inspections.outcome} = 'pass')`,
      returnVisits: sql<number>`(select count(*)::int from ${inspections} where ${inspections.companyId} = ${scope.companyId} and ${inspections.outcome} in ('fail','partial'))`,
    })
    .from(sql`(select 1) as _`);
  return row ?? { inspections: 0, failedItems: 0, graded: 0, cleanPasses: 0, returnVisits: 0 };
}
