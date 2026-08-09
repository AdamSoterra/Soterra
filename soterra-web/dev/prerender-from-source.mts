/**
 * Pre-render a manufacturer's pages to stored PNGs, fetching each document from
 * its SOURCE URL rather than a local file.
 *
 *   npx tsx dev/prerender-from-source.mts "GIB" [--dry] [--limit 50]
 *
 * Why: /api/doc-page renders live when a page has no stored image — it fetches
 * the manufacturer's PDF (GIB's largest is 9.6 MB) and renders the page inside
 * the request, on a cold serverless function. That works, until it doesn't:
 * cold start plus a big download plus a render is slow enough to look broken in
 * front of a customer, and it depends on the manufacturer's website being up
 * and their URL not moving. A stored PNG is served straight from Blob and can't
 * fail any of those ways.
 *
 * dev/render-store.mts does the same job for manufacturers whose PDFs we hold
 * locally. This is its remote-source twin.
 *
 * Idempotent and resumable: pages that already have an image_url are skipped,
 * so it can be re-run after an interruption. Only pages actually in the corpus
 * (served licences) are rendered.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const manufacturer = process.argv[2];
const dry = process.argv.includes("--dry");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
if (!manufacturer) {
  console.error('usage: npx tsx dev/prerender-from-source.mts "<Manufacturer>" [--dry] [--limit N]');
  process.exit(1);
}

const { db } = await import("../lib/db.ts");
const { manufacturerPages } = await import("../lib/schema.ts");
const { and, eq, inArray, isNull, isNotNull } = await import("drizzle-orm");
const { SERVED_LICENCES } = await import("../lib/manufacturerIndex.ts");
const { renderPageAsImage } = await import("unpdf");
const { put } = await import("@vercel/blob");

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not found in .env.local");

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const rows = await db
  .select({
    id: manufacturerPages.id,
    doc: manufacturerPages.doc,
    page: manufacturerPages.page,
    sourceUrl: manufacturerPages.sourceUrl,
  })
  .from(manufacturerPages)
  .where(
    and(
      eq(manufacturerPages.manufacturer, manufacturer),
      inArray(manufacturerPages.licence, [...SERVED_LICENCES]),
      isNull(manufacturerPages.imageUrl),
      isNotNull(manufacturerPages.sourceUrl),
    ),
  );

if (rows.length === 0) {
  console.log(`Nothing to do — every served ${manufacturer} page already has a stored image.`);
  process.exit(0);
}

// One fetch per document, not per page.
const byDoc = new Map<string, { sourceUrl: string; pages: typeof rows }>();
for (const r of rows) {
  const e = byDoc.get(r.doc) ?? { sourceUrl: r.sourceUrl!, pages: [] };
  e.pages.push(r);
  byDoc.set(r.doc, e);
}
console.log(`${rows.length} page(s) across ${byDoc.size} document(s) of ${manufacturer} need a stored image.`);
if (dry) {
  for (const [doc, e] of byDoc) console.log(`  ${String(e.pages.length).padStart(4)}pp  ${doc}`);
  console.log("\nDRY RUN — nothing rendered or stored.");
  process.exit(0);
}

let done = 0, failed = 0, bytes = 0;
const t0 = Date.now();
outer: for (const [doc, e] of byDoc) {
  let pdf: Uint8Array;
  try {
    const res = await fetch(e.sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pdf = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error(`  SKIP ${doc} — source fetch failed: ${(err as Error).message}`);
    failed += e.pages.length;
    continue;
  }
  console.log(`\n${doc} (${(pdf.length / 1048576).toFixed(1)} MB, ${e.pages.length} pages)`);
  for (const p of e.pages.sort((a, b) => a.page - b.page)) {
    if (done >= limit) break outer;
    try {
      // renderPageAsImage detaches its input, so hand each page a fresh copy.
      const png = await renderPageAsImage(new Uint8Array(pdf), p.page, {
        scale: 2,
        canvasImport: () => import("@napi-rs/canvas"),
      });
      const buf = Buffer.from(png as ArrayBuffer);
      const pathname = `docpage/${slug(manufacturer)}/${slug(doc)}/${p.page}.png`;
      await put(pathname, buf, {
        access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/png", token,
      });
      await db.update(manufacturerPages).set({ imageUrl: pathname }).where(eq(manufacturerPages.id, p.id));
      done++; bytes += buf.length;
      if (done % 25 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`  ${done}/${rows.length} stored (${rate.toFixed(1)}/s, ${(bytes / 1048576).toFixed(0)} MB)`);
      }
    } catch (err) {
      failed++;
      console.error(`  FAIL p${p.page} — ${(err as Error).message.slice(0, 80)}`);
    }
  }
}
console.log(
  `\ndone: ${done} stored, ${failed} failed, ${(bytes / 1048576).toFixed(0)} MB, ` +
    `${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`,
);
process.exit(failed ? 1 : 0);
