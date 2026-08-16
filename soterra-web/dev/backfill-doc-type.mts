/**
 * Backfill plan_pages.doc_type for every existing document, classified by the
 * same heuristic new uploads use (lib/docType.ts detectDocType, filename only —
 * page text isn't worth re-reading for a backfill; the Documents tab lets a
 * human correct any miss in one tap).
 *
 *   npx tsx dev/backfill-doc-type.mts          # DRY RUN - prints the plan
 *   npx tsx dev/backfill-doc-type.mts --apply  # writes
 *
 * Only touches rows where doc_type IS NULL, so re-running never overwrites a
 * human's manual correction.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { db } = await import("../lib/db.ts");
const { planPages } = await import("../lib/schema.ts");
const { and, eq, isNull, sql } = await import("drizzle-orm");
const { detectDocType } = await import("../lib/docType.ts");

const apply = process.argv.includes("--apply");

const rows = await db
  .select({ projectId: planPages.projectId, doc: planPages.doc, n: sql<number>`count(*)` })
  .from(planPages)
  .where(isNull(planPages.docType))
  .groupBy(planPages.projectId, planPages.doc);

if (!rows.length) {
  console.log("Nothing untyped. Done.");
  process.exit(0);
}

const byType: Record<string, number> = {};
for (const r of rows) {
  const t = detectDocType(r.doc);
  byType[t] = (byType[t] ?? 0) + 1;
  console.log(`${apply ? "SET " : "would set"} ${t.padEnd(8)} ${r.doc}  (${r.n}pp · project ${r.projectId.slice(0, 8)})`);
  if (apply) {
    await db
      .update(planPages)
      .set({ docType: t })
      .where(and(eq(planPages.projectId, r.projectId), eq(planPages.doc, r.doc), isNull(planPages.docType)));
  }
}
console.log(`\n${apply ? "Applied" : "DRY RUN"} · ${rows.length} documents · ${JSON.stringify(byType)}`);
if (!apply) console.log("Re-run with --apply to write.");
process.exit(0);
