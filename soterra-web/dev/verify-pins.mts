// Verifies Foundation 2 (plan pins) at the data layer:
//   - a pin round-trips with double-precision x/y intact
//   - sheet-scoped and record-scoped reads return it
//   - a DIFFERENT project id sees nothing (isolation at the query shape the
//     API uses — the route adds Clerk + resolveScope on top)
//   - delete removes it; sentinel sweep leaves nothing behind
// Run: npx tsx dev/verify-pins.mts
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { db } = await import("../lib/db.ts");
const { planPins } = await import("../lib/schema.ts");
const { and, eq } = await import("drizzle-orm");

let pass = true;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) pass = false;
};

const P = "__pins-verify-project__";
const C = "__pins-verify-company__";
const sweep = () => db.delete(planPins).where(eq(planPins.projectId, P));

await sweep();
try {
  const [pin] = await db
    .insert(planPins)
    .values({ companyId: C, projectId: P, doc: "A3-00-7400 Rev.2", page: 3, x: 23.7, y: 61.15, recordType: "qa_flag", recordId: "flag-test-1", label: "1" })
    .returning();
  check(!!pin?.id, "pin inserted");
  check(pin.x === 23.7 && pin.y === 61.15, "x/y survive as doubles (23.7, 61.15)");

  const bySheet = await db
    .select()
    .from(planPins)
    .where(and(eq(planPins.projectId, P), eq(planPins.doc, "A3-00-7400 Rev.2"), eq(planPins.page, 3)));
  check(bySheet.length === 1, "sheet-scoped read finds it (project + doc + page)");

  const byRecord = await db
    .select()
    .from(planPins)
    .where(and(eq(planPins.projectId, P), eq(planPins.recordType, "qa_flag"), eq(planPins.recordId, "flag-test-1")));
  check(byRecord.length === 1, "record-scoped read finds it");

  const otherProject = await db
    .select()
    .from(planPins)
    .where(and(eq(planPins.projectId, "__some-other-project__"), eq(planPins.doc, "A3-00-7400 Rev.2"), eq(planPins.page, 3)));
  check(otherProject.length === 0, "a different project sees nothing (isolation)");

  await db.delete(planPins).where(and(eq(planPins.id, pin.id), eq(planPins.projectId, P)));
  const after = await db.select({ id: planPins.id }).from(planPins).where(eq(planPins.id, pin.id));
  check(after.length === 0, "delete removes it");
} finally {
  await sweep();
}
const leftover = await db.select({ id: planPins.id }).from(planPins).where(eq(planPins.projectId, P));
check(leftover.length === 0, "sentinel rows cleaned up");

console.log(pass ? "\nALL PASS ✅" : "\nFAILURES ❌");
process.exit(pass ? 0 : 1);
