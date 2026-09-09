import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { checklistItems, checklists } from "./schema";
import type { Scope } from "./company";
import { historySearchTerms } from "./history";

// ─── The assistant's read of THIS SITE's programme reviews ─────────────────
//
// A programme review (Upload tab → Build programme) is stored as a checklist
// of kind "programme" whose items are the findings: missing scope, out of
// sequence, unrealistic duration, missing inspection hold-point, each with a
// severity and the programme line it came from (source_ref). This is the
// assistant's window onto them - "what did the programme review flag about
// pre-line?" - scoped to the project (a programme is the job's own), never
// company-wide like inspection history. Context on how the job is planned,
// never authority for what to build.

export const FINDING_LABEL: Record<string, string> = {
  missing_scope: "Missing scope",
  out_of_sequence: "Out of sequence",
  unrealistic_duration: "Unrealistic duration",
  missing_hold_point: "Missing inspection hold-point",
};
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export type ProgrammeFinding = {
  reviewId: string;
  review: string; // the checklist title ("<programme file> — critique")
  reviewedOn: string; // ISO date of the review
  type: string | null;
  typeLabel: string;
  severity: string | null;
  title: string;
  detail: string | null;
  programmeLine: string | null; // source_ref: the line / date on the programme it came from
};

export async function searchProgrammeReviews(
  scope: Scope,
  query: string,
  opts: { severity?: string | null; findingType?: string | null; limit?: number } = {}
): Promise<{ reviews: { id: string; title: string; reviewedOn: string; findings: number }[]; findings: ProgrammeFinding[] }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 80);
  const terms = historySearchTerms(query);

  // Every review on this site, newest first, so the assistant can say which
  // programme (and how recent) a finding belongs to, and notice an old one.
  const reviews = await db
    .select({ id: checklists.id, title: checklists.title, createdAt: checklists.createdAt })
    .from(checklists)
    .where(and(eq(checklists.companyId, scope.companyId), eq(checklists.projectId, scope.projectId), eq(checklists.kind, "programme")))
    .orderBy(desc(checklists.createdAt));
  if (!reviews.length) return { reviews: [], findings: [] };

  const conds = [eq(checklistItems.companyId, scope.companyId), eq(checklistItems.projectId, scope.projectId), eq(checklists.kind, "programme")];
  const sev = opts.severity?.toLowerCase();
  if (sev && sev in SEVERITY_RANK) conds.push(eq(checklistItems.severity, sev));
  const ft = opts.findingType?.toLowerCase();
  if (ft && ft in FINDING_LABEL) conds.push(eq(checklistItems.findingType, ft));
  if (terms.length) {
    conds.push(
      sql`(${sql.join(
        // Title + detail only: the programme line ("Line 42 · …") would make
        // "line" match every finding.
        terms.map((t) => sql`(${checklistItems.title} ILIKE ${"%" + t + "%"} OR coalesce(${checklistItems.detail}, '') ILIKE ${"%" + t + "%"})`),
        sql` OR `
      )})`
    );
  }
  const rank = terms.length
    ? sql<number>`(${sql.join(terms.map((t) => sql`(case when ${checklistItems.title} ILIKE ${"%" + t + "%"} then 2 when coalesce(${checklistItems.detail}, '') ILIKE ${"%" + t + "%"} then 1 else 0 end)`), sql` + `)})`
    : sql<number>`0`;

  const rows = await db
    .select({
      reviewId: checklists.id,
      review: checklists.title,
      reviewedOn: checklists.createdAt,
      type: checklistItems.findingType,
      severity: checklistItems.severity,
      title: checklistItems.title,
      detail: checklistItems.detail,
      programmeLine: checklistItems.sourceRef,
      ord: checklistItems.ord,
      score: rank,
    })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklistItems.checklistId, checklists.id))
    .where(and(...conds))
    // Best match first (only when there are terms - a bare "0" in ORDER BY is
    // a column ordinal to Postgres); within that the newest review, then high
    // before low, then programme order.
    .orderBy(...(terms.length ? [desc(rank)] : []), desc(checklists.createdAt), sql`case ${checklistItems.severity} when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end`, checklistItems.ord)
    .limit(limit);

  const findings = rows.map((r) => ({
    reviewId: r.reviewId,
    review: r.review,
    reviewedOn: r.reviewedOn.toISOString().slice(0, 10),
    type: r.type,
    typeLabel: (r.type && FINDING_LABEL[r.type]) || "Finding",
    severity: r.severity,
    title: r.title,
    detail: r.detail,
    programmeLine: r.programmeLine,
  }));

  const counts = new Map<string, number>();
  const all = await db
    .select({ id: checklistItems.checklistId, n: sql<number>`count(*)::int` })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklistItems.checklistId, checklists.id))
    .where(and(eq(checklistItems.projectId, scope.projectId), eq(checklists.kind, "programme")))
    .groupBy(checklistItems.checklistId);
  for (const r of all) counts.set(r.id, Number(r.n));

  return {
    reviews: reviews.map((r) => ({ id: r.id, title: r.title, reviewedOn: r.createdAt.toISOString().slice(0, 10), findings: counts.get(r.id) ?? 0 })),
    findings,
  };
}
