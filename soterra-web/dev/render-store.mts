/**
 * Pre-render a manufacturer's pages to stored PNGs, for documents whose PDFs
 * reference fonts they don't embed (Arial / Verdana / Times New Roman). Those
 * render fine here on Windows (the fonts exist) but blank on Vercel's Linux
 * serverless runtime, where /api/doc-page renders live. For those documents we
 * render each served page once, here, and store the image in PRIVATE Blob;
 * doc-page then streams the stored PNG through the same licence gate instead of
 * rendering.
 *
 *   npx tsx dev/render-store.mts <manifest.json> [--dry]
 *
 * Idempotent: re-running re-renders and overwrites image_url. Only pages that
 * are actually in the corpus (i.e. survived the ingest excludes) are rendered.
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const manifestPath = process.argv[2];
const dry = process.argv.includes("--dry");
if (!manifestPath) {
  console.error("usage: npx tsx dev/render-store.mts <manifest.json> [--dry]");
  process.exit(1);
}

type Doc = { file: string; title: string; dir?: string };
type Manifest = { manufacturer: string; dir?: string; docs: Doc[] };
const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const { db } = await import("../lib/db.ts");
const { manufacturerPages } = await import("../lib/schema.ts");
const { and, eq } = await import("drizzle-orm");
const { renderPageAsImage } = await import("unpdf");
const { put } = await import("@vercel/blob");

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not found in .env.local");

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

let rendered = 0;
let stored = 0;
const problems: string[] = [];

for (const d of manifest.docs) {
  const full = path.isAbsolute(d.file) ? d.file : path.join(d.dir ?? manifest.dir ?? ".", d.file);
  if (!fs.existsSync(full)) {
    problems.push(`MISSING FILE  ${d.title} → ${full}`);
    continue;
  }

  // Only the pages that actually made it into the corpus (excludes already gone).
  const pages = await db
    .select({ page: manufacturerPages.page })
    .from(manufacturerPages)
    .where(and(eq(manufacturerPages.manufacturer, manifest.manufacturer), eq(manufacturerPages.doc, d.title)));
  if (!pages.length) {
    problems.push(`NOT INGESTED  ${d.title} — no rows in manufacturer_pages`);
    continue;
  }

  // renderPageAsImage transfers (detaches) the buffer it's given, so each page
  // needs its own fresh copy — reusing one Uint8Array blanks every page after
  // the first with "Cannot transfer object of unsupported type".
  const fileBuf = fs.readFileSync(full);
  for (const { page } of pages.sort((a, b) => a.page - b.page)) {
    try {
      const png = await renderPageAsImage(new Uint8Array(fileBuf), page, { scale: 2, canvasImport: () => import("@napi-rs/canvas") });
      const buf = Buffer.from(png as ArrayBuffer);
      rendered++;
      if (dry) {
        console.log(`  would store  ${d.title} p${page} — ${(buf.length / 1024).toFixed(0)} KB`);
        continue;
      }
      const { pathname } = await put(`docpage/${slug(manifest.manufacturer)}/${slug(d.title)}/${page}.png`, buf, {
        access: "private",
        addRandomSuffix: true,
        contentType: "image/png",
        token,
      });
      await db
        .update(manufacturerPages)
        .set({ imageUrl: pathname })
        .where(
          and(
            eq(manufacturerPages.manufacturer, manifest.manufacturer),
            eq(manufacturerPages.doc, d.title),
            eq(manufacturerPages.page, page),
          ),
        );
      stored++;
      console.log(`  stored  ${d.title} p${page} — ${(buf.length / 1024).toFixed(0)} KB → ${pathname}`);
    } catch (e) {
      problems.push(`FAIL  ${d.title} p${page} — ${e instanceof Error ? e.message : e}`);
    }
  }
}

console.log(`\n${rendered} page(s) rendered, ${dry ? "0 stored (dry run)" : `${stored} stored`}.`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ${p}`);
}
process.exit(problems.length ? 1 : 0);
