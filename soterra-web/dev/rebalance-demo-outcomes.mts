/**
 * Demo polish: the council side was partial-heavy. Flip a few council partials
 * to a hard FAIL (their items stay) and add a few clean council PASSES (no
 * items), so the demo shows the full Pass / Partial / Fail range at a glance.
 * Surgical + idempotent — leaves subs, checklists and everything else alone.
 *   npx tsx dev/rebalance-demo-outcomes.mts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { db } = await import("../lib/db.ts");
const { inspections } = await import("../lib/schema.ts");
const { and, eq, inArray } = await import("drizzle-orm");

const PID = "7b66634b-30ac-4722-9fbe-e375f273ecb2"; // Kauri Tower
const CID = "e9210ba0-b03b-402b-8cfa-e6fa66d39055";
const UID = "user_3GcPx9L3pXhpSe20wl9H5rTuS8E";
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// 1) A few council partials become hard fails (items kept — a fail still has
//    a list to fix). Chosen so the failed themes still read realistically.
const toFail = [
  "BCA IPL Post-line Level 1 partial 1",
  "BCA ICL Cladding partial 2",
  "BCA IF1 Final residential partial 3",
];
const flipped = await db.update(inspections).set({ outcome: "fail" })
  .where(and(eq(inspections.companyId, CID), inArray(inspections.doc, toFail)))
  .returning({ id: inspections.id });
console.log(`flipped ${flipped.length} council reports to fail`);

// 2) A few clean council passes (no items to fix).
const passes = [
  { doc: "BCA ISF Foundations pass 5", code: "ISF", type: "Slab / floor", inspector: "Auckland Council", d: 168 },
  { doc: "BCA IPP Plumbing pass 6", code: "IPP", type: "Pre-line plumbing", inspector: "Southern Districts Council", d: 92 },
  { doc: "BCA IFG Framing pass 7", code: "IFG", type: "Framing", inspector: "Waikato City Council", d: 64 },
];
// Idempotent: drop any prior copy of these exact docs before inserting.
await db.delete(inspections).where(and(eq(inspections.companyId, CID), inArray(inspections.doc, passes.map((p) => p.doc))));
for (const p of passes) {
  await db.insert(inspections).values({
    companyId: CID, projectId: PID, doc: p.doc, source: "council",
    inspectionCode: p.code, inspectionType: p.type, inspector: p.inspector,
    outcome: "pass", inspectedOn: iso(daysAgo(p.d)), itemCount: 0,
    createdBy: UID, createdAt: daysAgo(p.d),
  });
}
console.log(`added ${passes.length} clean council passes`);

const rows = await db.select({ source: inspections.source, outcome: inspections.outcome }).from(inspections).where(eq(inspections.companyId, CID));
const councilMix = rows.filter((r) => r.source === "council").reduce<Record<string, number>>((a, r) => ((a[r.outcome ?? "?"] = (a[r.outcome ?? "?"] ?? 0) + 1), a), {});
console.log(`council outcome mix now: ${JSON.stringify(councilMix)} · consultant rows: ${rows.filter((r) => r.source === "consultant").length}`);
process.exit(0);
