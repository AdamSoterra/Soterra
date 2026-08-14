// Verifies the cached plan render against a real Kauri drawing: first call
// renders + stores (imageUrl set), second call is a cache hit, thumb renders +
// stores (thumbUrl set), and a bogus doc returns null.
// Run: npx tsx dev/verify-plan-render.mts
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { planPageImage } = await import("../lib/planRender.ts");
const { db } = await import("../lib/db.ts");
const { planPages } = await import("../lib/schema.ts");
const { and, eq, isNotNull } = await import("drizzle-orm");

const PID = "7b66634b-30ac-4722-9fbe-e375f273ecb2";
let pass = true;
const check = (ok: boolean, msg: string) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) pass = false; };

const [sheet] = await db
  .select({ doc: planPages.doc, page: planPages.page })
  .from(planPages)
  .where(and(eq(planPages.projectId, PID), isNotNull(planPages.file)))
  .limit(1);
console.log(`sheet: ${sheet.doc} p${sheet.page}\n`);

// clear any prior cache for a clean miss
await db.update(planPages).set({ imageUrl: null, thumbUrl: null }).where(and(eq(planPages.projectId, PID), eq(planPages.doc, sheet.doc), eq(planPages.page, sheet.page)));

const t0 = performance.now();
const first = await planPageImage(PID, sheet.doc, sheet.page);
const missMs = Math.round(performance.now() - t0);
check(!!first && first.byteLength > 5000, `first call renders (${first ? Math.round(first.byteLength / 1024) : 0} KB in ${missMs}ms)`);
const [afterMiss] = await db.select({ imageUrl: planPages.imageUrl }).from(planPages).where(and(eq(planPages.projectId, PID), eq(planPages.doc, sheet.doc), eq(planPages.page, sheet.page))).limit(1);
check(!!afterMiss?.imageUrl, "imageUrl stored after first render");

const t1 = performance.now();
const second = await planPageImage(PID, sheet.doc, sheet.page);
const hitMs = Math.round(performance.now() - t1);
check(!!second && second.byteLength > 5000, `second call served from cache (${hitMs}ms)`);
check(hitMs < missMs, `cache hit faster than render (${hitMs}ms < ${missMs}ms)`);

const thumb = await planPageImage(PID, sheet.doc, 1, { thumb: true });
check(!!thumb && thumb.byteLength > 1000, `thumbnail renders (${thumb ? Math.round(thumb.byteLength / 1024) : 0} KB)`);
const [afterThumb] = await db.select({ thumbUrl: planPages.thumbUrl }).from(planPages).where(and(eq(planPages.projectId, PID), eq(planPages.doc, sheet.doc), eq(planPages.page, 1))).limit(1);
check(!!afterThumb?.thumbUrl, "thumbUrl stored");
check((thumb?.byteLength ?? 0) < (first?.byteLength ?? 0), "thumbnail smaller than full page");

const missing = await planPageImage(PID, "__no-such-doc__", 1);
check(missing === null, "missing doc returns null");

console.log(pass ? "\nALL PASS ✅" : "\nFAILURES ❌");
process.exit(pass ? 0 : 1);
