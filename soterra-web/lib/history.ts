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
export type TopItem = { title: string; category: Category; count: number; lastSeen: string | null };

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
 *  Grouped on a normalised title so "Cavity battens as per plan" and
 *  "Cavity battens as per plan and installed correctly" don't split the count. */
export async function topItems(scope: Scope, opts: { category?: string | null; limit?: number } = {}): Promise<TopItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 100);
  const where = opts.category
    ? and(eq(inspectionItems.companyId, scope.companyId), eq(inspectionItems.category, opts.category))
    : eq(inspectionItems.companyId, scope.companyId);

  const rows = await db
    .select({
      // Fold to the first 6 words, lowercased — enough to merge the same defect
      // written two ways without merging two different defects.
      grp: sql<string>`lower(array_to_string((string_to_array(regexp_replace(${inspectionItems.title}, '[^a-zA-Z0-9 ]', ' ', 'g'), ' '))[1:6], ' '))`,
      title: sql<string>`min(${inspectionItems.title})`,
      category: sql<string>`min(${inspectionItems.category})`,
      count: sql<number>`count(*)::int`,
      lastSeen: sql<string | null>`max(${inspectionItems.inspectedOn})`,
    })
    .from(inspectionItems)
    .where(where)
    .groupBy(sql`1`)
    .orderBy(sql`count(*) desc`)
    .limit(limit);

  return rows.map((r) => ({ title: r.title, category: r.category as Category, count: r.count, lastSeen: r.lastSeen }));
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
export async function searchHistory(
  scope: Scope,
  query: string,
  opts: { code?: string | null; category?: string | null; limit?: number } = {}
) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 60);
  const q = query.trim();
  const terms = (q.toLowerCase().match(/[a-z0-9]{3,}/g) || []).slice(0, 8);

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

/** How many times this company has failed each thing on a given inspection
 *  type — the "what we personally keep failing" source for a checklist. */
export async function historyForCode(scope: Scope, code: string, limit = 12): Promise<TopItem[]> {
  const rows = await db
    .select({
      grp: sql<string>`lower(array_to_string((string_to_array(regexp_replace(${inspectionItems.title}, '[^a-zA-Z0-9 ]', ' ', 'g'), ' '))[1:6], ' '))`,
      title: sql<string>`min(${inspectionItems.title})`,
      category: sql<string>`min(${inspectionItems.category})`,
      count: sql<number>`count(*)::int`,
      lastSeen: sql<string | null>`max(${inspectionItems.inspectedOn})`,
    })
    .from(inspectionItems)
    .where(and(eq(inspectionItems.companyId, scope.companyId), eq(inspectionItems.inspectionCode, code.toUpperCase())))
    .groupBy(sql`1`)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
  return rows.map((r) => ({ title: r.title, category: r.category as Category, count: r.count, lastSeen: r.lastSeen }));
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
