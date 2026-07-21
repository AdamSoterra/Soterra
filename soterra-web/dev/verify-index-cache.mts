// Verifies the project-index cache: it must be FAST on a hit, and must still
// pick up a change immediately (the guarantee the old uncached version gave).
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { getProjectIndex, cachedProjectCount } = await import("../lib/projectIndex.ts");
const { db } = await import("../lib/db.ts");
const { planPages } = await import("../lib/schema.ts");
const { eq, and } = await import("drizzle-orm");

const PROJECT = "7b66634b-30ac-4722-9fbe-e375f273ecb2"; // Kauri Tower
const TEST_DOC = "__cache_probe__";
let pass = true;
const check = (ok: boolean, msg: string) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) pass = false; };

try {
  const t0 = performance.now();
  const a = await getProjectIndex(PROJECT);
  const cold = performance.now() - t0;

  const t1 = performance.now();
  const b = await getProjectIndex(PROJECT);
  const warm = performance.now() - t1;

  console.log(`\ncold load: ${cold.toFixed(0)}ms   warm (cached): ${warm.toFixed(0)}ms   speedup ${(cold / warm).toFixed(1)}x`);
  console.log(`pages: ${a.pages.length}\n`);

  check(b.pages.length === a.pages.length, "cached index returns the same page count");
  check(b === a, "warm call returns the SAME object (genuine cache hit, no reload)");
  check(warm < cold, `warm call is faster (${warm.toFixed(0)}ms < ${cold.toFixed(0)}ms)`);
  check(cachedProjectCount() === 1, "exactly one project cached");

  // The important one: a new upload must be visible IMMEDIATELY, with no
  // explicit invalidation call — this is what the old uncached code guaranteed.
  await db.insert(planPages).values({
    projectId: PROJECT, doc: TEST_DOC, file: `${PROJECT}/probe.pdf`,
    page: 1, npages: 1, text: "cache probe page inserted by verify-index-cache",
  });
  const c = await getProjectIndex(PROJECT);
  check(c.pages.length === a.pages.length + 1, `new upload visible immediately (${a.pages.length} -> ${c.pages.length})`);
  check(c !== a, "index was genuinely rebuilt, not served stale");

  // ...and a delete must also be picked up.
  await db.delete(planPages).where(and(eq(planPages.projectId, PROJECT), eq(planPages.doc, TEST_DOC)));
  const d = await getProjectIndex(PROJECT);
  check(d.pages.length === a.pages.length, `delete visible immediately (back to ${d.pages.length})`);

  console.log(`\n${pass ? "ALL PASS" : "FAILURES ABOVE"}`);
} finally {
  // Never leave the probe row behind.
  await db.delete(planPages).where(and(eq(planPages.projectId, PROJECT), eq(planPages.doc, TEST_DOC)));
}
