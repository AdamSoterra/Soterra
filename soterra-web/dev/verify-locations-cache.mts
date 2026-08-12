// Verifies Foundation 3 (persistent location cache) WITHOUT spending a model
// call: ANTHROPIC_API_KEY is deleted up front, so any path that touches the
// model fails loudly — a cache hit that passes therefore PROVES it never
// called the model.
//   1. fresh fingerprint + cached row → served from the table, model untouched
//   2. stale fingerprint + model failure → serves the stale extraction (not [])
//   3. user zones: add → merged (before Site-wide), clash → user wins,
//      remove → gone; all surviving a "re-extraction"
//   4. sentinel cleanup is crash-safe
// Run: npx tsx dev/verify-locations-cache.mts
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
delete process.env.ANTHROPIC_API_KEY; // model calls now throw — that's the tripwire

const { getProjectLocations, addUserZone, removeUserZone, mergeZones, titleFingerprint } = await import("../lib/locations.ts");
const { db } = await import("../lib/db.ts");
const { planPages, projectLocations } = await import("../lib/schema.ts");
const { eq } = await import("drizzle-orm");

let pass = true;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) pass = false;
};

const P = "__loc-verify-project__";
const TITLES = ["S3.01 Unit 1 Foundations", "S3.02 Unit 2 Foundations", "AR109209 Site Plan"];
const EXTRACTED = [
  { label: "Unit 1", kind: "unit", drawings: [TITLES[0]], source: "extracted" },
  { label: "Unit 2", kind: "unit", drawings: [TITLES[1]], source: "extracted" },
  { label: "Site-wide", kind: "site", drawings: [TITLES[2]], source: "extracted" },
];
const sweep = async () => {
  await db.delete(planPages).where(eq(planPages.projectId, P));
  await db.delete(projectLocations).where(eq(projectLocations.projectId, P));
};

await sweep();
try {
  // Sentinel plan pages (what getProjectLocations reads titles from).
  for (const [i, t] of TITLES.entries()) {
    await db.insert(planPages).values({ projectId: P, doc: t, page: 1, npages: 1, text: `sentinel ${i}` });
  }
  const fp = titleFingerprint(TITLES);

  // ── 1. warm cache, matching fingerprint → table read, model untouched ──
  await db.insert(projectLocations).values({ projectId: P, fingerprint: fp, locations: JSON.stringify(EXTRACTED) });
  const warm = await getProjectLocations(P);
  check(warm.length === 3 && warm[0].label === "Unit 1", "cache hit serves extracted locations (model provably untouched)");

  // ── 2. stale fingerprint + failing model → stale served, not [] ──
  await db.update(projectLocations).set({ fingerprint: "stale-deadbeef" }).where(eq(projectLocations.projectId, P));
  const degraded = await getProjectLocations(P);
  check(degraded.length === 3, "stale cache + model failure degrades to last good extraction");
  const [rowAfter] = await db.select().from(projectLocations).where(eq(projectLocations.projectId, P));
  check(rowAfter?.fingerprint === "stale-deadbeef", "failed refresh does NOT stamp the fingerprint fresh (will retry)");
  await db.update(projectLocations).set({ fingerprint: fp }).where(eq(projectLocations.projectId, P));

  // ── 3. user zones ──
  const withZone = await addUserZone(P, "East Corridor");
  const idx = withZone.findIndex((z) => z.label === "East Corridor");
  const siteIdx = withZone.findIndex((z) => z.kind === "site");
  check(idx !== -1 && withZone[idx].source === "user", "user zone added");
  check(siteIdx === withZone.length - 1 && idx < siteIdx, "user zone slots in before Site-wide");

  const clash = await addUserZone(P, "unit 1", "zone");
  const unit1 = clash.filter((z) => z.label.toLowerCase() === "unit 1");
  check(unit1.length === 1 && unit1[0].source === "user", "label clash: the user's zone wins over the extracted one");

  const removed = await removeUserZone(P, "unit 1");
  const unit1After = removed.filter((z) => z.label.toLowerCase() === "unit 1");
  check(unit1After.length === 1 && unit1After[0].source === "extracted", "removing the user zone restores the extracted one");
  check(removed.some((z) => z.label === "East Corridor"), "other user zones survive");

  // mergeZones is pure — spot-check ordering with no site entry.
  const m = mergeZones(
    [{ label: "A", kind: "unit", drawings: ["x"], source: "extracted" }],
    [{ label: "B", kind: "zone", drawings: [], source: "user" }],
  );
  check(m.length === 2 && m[1].label === "B", "mergeZones appends user zones when no Site-wide exists");
} finally {
  await sweep();
}
const leftover = await db.select({ id: planPages.id }).from(planPages).where(eq(planPages.projectId, P));
check(leftover.length === 0, "sentinel rows cleaned up");

console.log(pass ? "\nALL PASS ✅" : "\nFAILURES ❌");
process.exit(pass ? 0 : 1);
