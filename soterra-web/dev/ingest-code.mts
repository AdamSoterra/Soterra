/**
 * Load PDFs into the SHARED knowledge corpus (`code_pages`) that the
 * assistant's `search_code` reads. Universal knowledge only — the Building
 * Code, MBIE guidance, council process booklets, determinations. Never a
 * customer's own documents: those are per-site `plan_pages` or per-company
 * inspection history, and this table is visible to everyone.
 *
 *   npx tsx dev/ingest-code.mts "<folder or file>" [--title="Nice name"] [--dry]
 *
 * Re-running replaces a document's pages rather than duplicating them, so a
 * newer edition can be dropped straight over the top of the old one.
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const target = process.argv[2];
const dry = process.argv.includes("--dry");
const titleArg = process.argv.find((a) => a.startsWith("--title="))?.slice(8);
if (!target) {
  console.error('usage: npx tsx dev/ingest-code.mts "<folder or file>" [--title="Nice name"] [--dry]');
  process.exit(1);
}

const { db } = await import("../lib/db.ts");
const { codePages } = await import("../lib/schema.ts");
const { eq } = await import("drizzle-orm");
const { extractText, getDocumentProxy } = await import("unpdf");

const stat = fs.statSync(target);
const files = stat.isDirectory()
  ? fs.readdirSync(target).filter((f) => f.toLowerCase().endsWith(".pdf")).sort().map((f) => path.join(target, f))
  : [target];

// "ac1229-building-consent-booklet.pdf" → "Ac1229 Building Consent Booklet".
// A readable title matters more here than anywhere else in the app: it's what
// the assistant prints after "Source:", so it's what the user sees.
const titleFrom = (file: string) =>
  path.basename(file).replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

let docs = 0, pages = 0;
for (const file of files) {
  const doc = (files.length === 1 && titleArg) || titleFrom(file);
  try {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const pdf = await getDocumentProxy(bytes);
    const out = await extractText(pdf, { mergePages: false });
    const texts: string[] = Array.isArray(out.text) ? out.text : [String(out.text)];

    const rows = texts
      .map((t, i) => ({ doc, file: path.basename(file), page: i + 1, npages: out.totalPages, title: null, text: (t || "").replace(/\s+/g, " ").trim() }))
      .filter((r) => r.text.length >= 40); // drop covers and photo-only pages

    if (!rows.length) {
      console.log(`  skip  ${doc} — no readable text (a scan? needs OCR)`);
      continue;
    }

    console.log(`  ${dry ? "would" : "ok   "}  ${doc} — ${rows.length} of ${out.totalPages} pages`);
    if (!dry) {
      await db.delete(codePages).where(eq(codePages.doc, doc));
      for (let i = 0; i < rows.length; i += 100) await db.insert(codePages).values(rows.slice(i, i + 100));
    }
    docs++;
    pages += rows.length;
  } catch (e) {
    console.log(`  FAIL  ${doc} — ${e instanceof Error ? e.message : e}`);
  }
}

console.log(`\n${docs} document(s), ${pages} page(s)${dry ? " (dry run — nothing written)" : " indexed"}.`);
if (!dry && docs) {
  const [{ n }] = await db.select({ n: (await import("drizzle-orm")).sql<number>`count(*)::int` }).from(codePages);
  console.log(`code_pages now holds ${n} pages.`);
}
