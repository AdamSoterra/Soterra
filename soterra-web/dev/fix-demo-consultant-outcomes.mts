/**
 * One-off: the demo seed used to file consultant reports with outcome
 * "partial", but a consultant never issues a Pass/Partial/Fail — only the
 * council (BCA) does. Set every consultant inspection in the demo company to
 * no verdict ("unknown"). Surgical, so it leaves the rest of the demo (subs,
 * checklists, dates) untouched — no full re-seed needed.
 *   npx tsx dev/fix-demo-consultant-outcomes.mts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { db } = await import("../lib/db.ts");
const { inspections } = await import("../lib/schema.ts");
const { and, eq } = await import("drizzle-orm");

const COMPANY = "e9210ba0-b03b-402b-8cfa-e6fa66d39055"; // demo (Kauri)

const before = await db.select().from(inspections).where(and(eq(inspections.companyId, COMPANY), eq(inspections.source, "consultant")));
console.log(`consultant reports in demo: ${before.length}; outcomes now: ${JSON.stringify(count(before.map((r) => r.outcome)))}`);

const res = await db
  .update(inspections)
  .set({ outcome: "unknown" })
  .where(and(eq(inspections.companyId, COMPANY), eq(inspections.source, "consultant")))
  .returning({ id: inspections.id });

console.log(`updated ${res.length} consultant reports to outcome "unknown".`);

function count(xs: (string | null)[]): Record<string, number> {
  return xs.reduce<Record<string, number>>((a, x) => ((a[x ?? "null"] = (a[x ?? "null"] ?? 0) + 1), a), {});
}
process.exit(0);
