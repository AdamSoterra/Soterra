/**
 * Delete rendered manufacturer page images left in Blob after a demo removal.
 *
 *   npx tsx dev/prune-orphan-docpages.mts          # dry run, deletes nothing
 *   npx tsx dev/prune-orphan-docpages.mts --delete
 *
 * Why this exists: `demo-corpus.mts remove` deletes the database rows but never
 * touched the rendered PNGs, so a manufacturer we told "your material is now
 * deleted" still had hundreds of page images sitting in Blob. The rows going is
 * what makes the content unreachable; this is what makes the sentence true.
 *
 * ⭐ THE SAFETY RULE: a manufacturer is deleted ONLY if it has ZERO rows left in
 * manufacturer_pages. The delete set is DERIVED from the database, never
 * hardcoded — so a supplier who has granted permission, or one still on a live
 * demo tier, cannot be caught by it even by mistake. Anything still held keeps
 * every image. The script prints both lists and refuses to run if it cannot
 * read the database.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { db } = await import("../lib/db.ts");
const { manufacturerPages } = await import("../lib/schema.ts");
const { list, del } = await import("@vercel/blob");

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN missing");

// Same slug the renderer used to build the paths (dev/render-store.mts).
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// ── 1. Who do we still hold? Straight from the database. ──────────────────
const rows = await db
  .select({ manufacturer: manufacturerPages.manufacturer, licence: manufacturerPages.licence })
  .from(manufacturerPages)
  .groupBy(manufacturerPages.manufacturer, manufacturerPages.licence);

if (rows.length === 0) {
  // An empty read is far more likely to be a broken connection than a genuinely
  // empty corpus, and acting on it would delete EVERYTHING. Refuse.
  throw new Error("manufacturer_pages returned no rows — refusing to treat that as 'nothing is held'.");
}

const heldSlugs = new Map<string, string[]>();
for (const r of rows) {
  const k = slug(r.manufacturer);
  heldSlugs.set(k, [...(heldSlugs.get(k) ?? []), `${r.manufacturer} (${r.licence})`]);
}
console.log(`held in the database: ${heldSlugs.size} manufacturers`);
for (const [k, v] of [...heldSlugs].sort()) console.log(`  KEEP  ${k.padEnd(28)} ${[...new Set(v)].join(", ")}`);

// ── 2. What is actually in Blob under docpage/? ───────────────────────────
const byMfr = new Map<string, { urls: string[]; bytes: number }>();
let cursor: string | undefined;
do {
  const page = await list({ token, cursor, limit: 1000, mode: "expanded", prefix: "docpage/" });
  for (const b of page.blobs) {
    const mfr = b.pathname.split("/")[1];
    if (!mfr) continue;
    const cur = byMfr.get(mfr) ?? { urls: [], bytes: 0 };
    cur.urls.push(b.url);
    cur.bytes += b.size ?? 0;
    byMfr.set(mfr, cur);
  }
  cursor = page.cursor;
} while (cursor);

// ── 3. Orphans = in Blob, no rows in the database. ────────────────────────
const orphans = [...byMfr].filter(([mfr]) => !heldSlugs.has(mfr)).sort();
console.log(`\nin Blob under docpage/: ${byMfr.size} manufacturers`);
for (const [mfr, v] of [...byMfr].sort()) {
  const held = heldSlugs.has(mfr);
  console.log(`  ${held ? "KEEP " : "PRUNE"} ${mfr.padEnd(28)} ${String(v.urls.length).padStart(4)} images  ${(v.bytes / 1048576).toFixed(1).padStart(6)} MB`);
}

if (orphans.length === 0) {
  console.log("\nNothing to prune — every image in Blob belongs to a manufacturer we still hold.");
  process.exit(0);
}

const total = orphans.reduce((n, [, v]) => n + v.urls.length, 0);
const mb = orphans.reduce((n, [, v]) => n + v.bytes, 0) / 1048576;
console.log(`\norphaned: ${total} images across ${orphans.length} manufacturers, ${mb.toFixed(1)} MB`);
console.log(`  ${orphans.map(([m]) => m).join(", ")}`);

if (!process.argv.includes("--delete")) {
  console.log("\nDRY RUN — nothing deleted. Re-run with --delete to remove the orphans above.");
  process.exit(0);
}

// ── 4. Delete, in batches, orphans only. ──────────────────────────────────
for (const [mfr, v] of orphans) {
  for (let i = 0; i < v.urls.length; i += 100) {
    await del(v.urls.slice(i, i + 100), { token });
  }
  console.log(`deleted ${v.urls.length} images for ${mfr}`);
}

// ── 5. Prove it. ──────────────────────────────────────────────────────────
let left = 0;
cursor = undefined;
do {
  const page = await list({ token, cursor, limit: 1000, mode: "expanded", prefix: "docpage/" });
  for (const b of page.blobs) if (orphans.some(([m]) => b.pathname.startsWith(`docpage/${m}/`))) left++;
  cursor = page.cursor;
} while (cursor);
console.log(`\nremaining images for pruned manufacturers: ${left} (want 0)`);
process.exit(left === 0 ? 0 : 1);
