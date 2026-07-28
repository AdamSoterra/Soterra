/**
 * Load a manufacturer's technical literature into the shared `manufacturer_pages`
 * corpus that the assistant's `search_manufacturer` reads.
 *
 *   npx tsx dev/ingest-manufacturer.mts <manifest.json> [--dry]
 *
 * This is NOT the same job as dev/ingest-code.mts, even though the mechanics
 * rhyme. Manufacturer literature is used under a permission we asked for in
 * writing, and the email made four promises. Three are kept at answer time
 * (short extract, document and page cited, link to the current document). The
 * fourth — "we'd never reproduce any third-party material that appears within
 * your documents" — is kept HERE, by never indexing those pages at all.
 *
 * That distinction matters. A prompt instruction not to quote a BRANZ appraisal
 * is a request the model can be argued out of. A page that was never inserted
 * cannot be retrieved by anyone, however the question is phrased.
 *
 * Manifest shape:
 *   {
 *     "manufacturer": "GIB",
 *     "licence": "pending",
 *     "docs": [
 *       { "file": "GIB Site Guide 2024 (Complete Manual).pdf",
 *         "title": "GIB Site Guide 2024",
 *         "url": "https://www.gib.co.nz/...",
 *         "exclude": [12, 13] }        // 1-indexed pages to drop
 *     ]
 *   }
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
  console.error("usage: npx tsx dev/ingest-manufacturer.mts <manifest.json> [--dry]");
  process.exit(1);
}

type Doc = { file: string; title: string; url?: string; exclude?: number[]; dir?: string };
type Manifest = { manufacturer: string; licence?: string; dir?: string; docs: Doc[] };

const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const licence = manifest.licence ?? "pending";

const { db } = await import("../lib/db.ts");
const { manufacturerPages } = await import("../lib/schema.ts");
const { and, eq, sql } = await import("drizzle-orm");
const { extractText, getDocumentProxy } = await import("unpdf");

let docs = 0;
let indexed = 0;
let dropped = 0;
const problems: string[] = [];

for (const d of manifest.docs) {
  const full = path.isAbsolute(d.file) ? d.file : path.join(d.dir ?? manifest.dir ?? ".", d.file);
  const excluded = new Set(d.exclude ?? []);

  if (!fs.existsSync(full)) {
    problems.push(`MISSING FILE  ${d.title} → ${full}`);
    continue;
  }

  try {
    const bytes = new Uint8Array(fs.readFileSync(full));
    const pdf = await getDocumentProxy(bytes);
    const out = await extractText(pdf, { mergePages: false });
    const texts: string[] = Array.isArray(out.text) ? out.text : [String(out.text)];

    // A page number in `exclude` that doesn't exist means the audit and the file
    // have drifted apart — loudly, because silently ingesting a page we believed
    // we'd excluded is exactly the failure this script exists to prevent.
    for (const p of excluded) {
      if (p < 1 || p > out.totalPages) problems.push(`BAD EXCLUSION  ${d.title}: page ${p} of ${out.totalPages}`);
    }

    const rows = texts
      .map((t, i) => ({
        manufacturer: manifest.manufacturer,
        doc: d.title,
        file: path.basename(full),
        page: i + 1,
        npages: out.totalPages,
        title: null as string | null,
        text: (t || "").replace(/\s+/g, " ").trim(),
        sourceUrl: d.url ?? null,
        licence,
      }))
      .filter((r) => {
        if (excluded.has(r.page)) {
          dropped++;
          return false;
        }
        return r.text.length >= 40; // covers and photo-only pages carry nothing to retrieve
      });

    if (!rows.length) {
      problems.push(`NO TEXT  ${d.title} — a scan? needs OCR`);
      continue;
    }

    const excludedNote = excluded.size ? `, ${excluded.size} excluded as third-party` : "";
    console.log(`  ${dry ? "would" : "ok   "}  ${d.title} — ${rows.length} of ${out.totalPages} pages${excludedNote}`);

    if (!dry) {
      // Replace this document rather than duplicating it, so a newer edition
      // drops straight over the old one.
      await db
        .delete(manufacturerPages)
        .where(and(eq(manufacturerPages.manufacturer, manifest.manufacturer), eq(manufacturerPages.doc, d.title)));
      for (let i = 0; i < rows.length; i += 100) await db.insert(manufacturerPages).values(rows.slice(i, i + 100));
    }
    docs++;
    indexed += rows.length;
  } catch (e) {
    problems.push(`FAIL  ${d.title} — ${e instanceof Error ? e.message : e}`);
  }
}

console.log(
  `\n${docs} document(s), ${indexed} page(s)${dry ? " (dry run — nothing written)" : " indexed"}, ${dropped} page(s) withheld as third-party.`,
);

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ${p}`);
}

if (!dry && docs) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(manufacturerPages);
  console.log(`\nmanufacturer_pages now holds ${n} pages.`);
}
