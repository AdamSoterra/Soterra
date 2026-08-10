/**
 * Pre-render Building Code pages to stored PNGs, so a Code citation can be
 * opened like a manufacturer or determination one.
 *
 *   npx tsx dev/prerender-code.mts            # every doc up to the size cap
 *   npx tsx dev/prerender-code.mts --dry
 *   npx tsx dev/prerender-code.mts --max 130  # only docs of 130 pages or fewer
 *   npx tsx dev/prerender-code.mts --file e2-external-moisture-as1-fourth-edition.pdf
 *
 * Why: the Code is the most-cited source in the product and was the ONLY kind of
 * citation that could not be opened. The chip linked out to building.govt.nz
 * because opening the viewer would have shown a blank sheet. So the single most
 * convincing thing the product does, "tap it and see the actual page", was
 * missing exactly where it matters most.
 *
 * The Code is Crown material published free by MBIE and we already hold the
 * text, so unlike a manufacturer's manual there is no licence question here.
 *
 * Reads the PDFs from disk rather than a URL (dev/ingest-code.mts loaded them
 * from the same folder), renders each page once here where the fonts exist, and
 * stores the PNG in private Blob. Idempotent and resumable: pages that already
 * have an image_url are skipped, so an interrupted run just carries on.
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const PDF_DIR = "C:/Users/adam/Desktop/Soterra/building-code";
const dry = process.argv.includes("--dry");
const maxArg = process.argv.indexOf("--max");
const maxPages = maxArg > -1 ? Number(process.argv[maxArg + 1]) : 240;
const fileArg = process.argv.indexOf("--file");
const onlyFile = fileArg > -1 ? process.argv[fileArg + 1] : null;

const { db } = await import("../lib/db.ts");
const { codePages } = await import("../lib/schema.ts");
const { and, eq, isNull, sql } = await import("drizzle-orm");
const { renderPageAsImage } = await import("unpdf");
const { put } = await import("@vercel/blob");

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not found in .env.local");

const slug = (s: string) => s.toLowerCase().replace(/\.pdf$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);

// One row per document that still has unrendered pages.
const docs = await db
  .select({ file: codePages.file, npages: codePages.npages, todo: sql<number>`count(*)::int` })
  .from(codePages)
  .where(isNull(codePages.imageUrl))
  .groupBy(codePages.file, codePages.npages)
  .orderBy(sql`count(*) desc`);

const targets = docs
  .filter((d) => (onlyFile ? d.file === onlyFile : d.npages <= maxPages))
  .filter((d) => fs.existsSync(path.join(PDF_DIR, d.file)));

const missing = docs.filter((d) => !fs.existsSync(path.join(PDF_DIR, d.file)));
if (missing.length) {
  console.log(`⚠️  ${missing.length} document(s) have no PDF on disk and will be skipped:`);
  for (const m of missing.slice(0, 8)) console.log(`     ${m.file}`);
}
const skippedBig = docs.filter((d) => !onlyFile && d.npages > maxPages && fs.existsSync(path.join(PDF_DIR, d.file)));
if (skippedBig.length) {
  console.log(`ℹ️  ${skippedBig.length} document(s) over the ${maxPages}-page cap, left to link out:`);
  for (const m of skippedBig) console.log(`     ${String(m.npages).padStart(4)}pp  ${m.file}`);
}

const total = targets.reduce((a, b) => a + b.todo, 0);
console.log(`\n${targets.length} document(s), ${total} page(s) to render.`);
if (dry) {
  for (const d of targets) console.log(`  ${String(d.todo).padStart(4)}pp  ${d.file}`);
  console.log("\nDRY RUN — nothing rendered or stored.");
  process.exit(0);
}

let done = 0, failed = 0, bytes = 0;
const t0 = Date.now();
for (const d of targets) {
  const rows = await db
    .select({ id: codePages.id, page: codePages.page })
    .from(codePages)
    .where(and(eq(codePages.file, d.file), isNull(codePages.imageUrl)));
  let pdf: Uint8Array;
  try {
    pdf = new Uint8Array(fs.readFileSync(path.join(PDF_DIR, d.file)));
  } catch (e) {
    console.error(`  SKIP ${d.file} — ${(e as Error).message}`);
    failed += rows.length;
    continue;
  }
  console.log(`\n${d.file} (${rows.length} pages)`);
  for (const r of rows.sort((a, b) => a.page - b.page)) {
    try {
      // renderPageAsImage detaches its input, so hand each page a fresh copy.
      const png = await renderPageAsImage(new Uint8Array(pdf), r.page, {
        scale: 2,
        canvasImport: () => import("@napi-rs/canvas"),
      });
      const buf = Buffer.from(png as ArrayBuffer);
      const pathname = `codepage/${slug(d.file)}/${r.page}.png`;
      await put(pathname, buf, {
        access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/png", token,
      });
      await db.update(codePages).set({ imageUrl: pathname }).where(eq(codePages.id, r.id));
      done++; bytes += buf.length;
      if (done % 50 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`  ${done}/${total} stored (${rate.toFixed(1)}/s, ${(bytes / 1048576).toFixed(0)} MB)`);
      }
    } catch (e) {
      failed++;
      console.error(`  FAIL p${r.page} — ${(e as Error).message.slice(0, 80)}`);
    }
  }
}
console.log(
  `\ndone: ${done} stored, ${failed} failed, ${(bytes / 1048576).toFixed(0)} MB, ` +
    `${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`,
);
process.exit(failed ? 1 : 0);
