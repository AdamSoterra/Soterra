/**
 * Load a folder of inspection report PDFs into a site's company history —
 * the same pipeline /api/inspections runs, minus the browser and the upload.
 *
 *   npx tsx dev/ingest-reports.mts "<folder>" <projectId> [--dry]
 *
 * --dry reads and extracts but writes nothing, so you can check what it found
 * before it lands in the history. Re-running the same folder REPLACES those
 * reports (unique on project + document name) rather than double-counting.
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const dir = process.argv[2];
const projectId = process.argv[3];
const dry = process.argv.includes("--dry");
if (!dir || !projectId) {
  console.error('usage: npx tsx dev/ingest-reports.mts "<folder>" <projectId> [--dry]');
  process.exit(1);
}

const { db } = await import("../lib/db.ts");
const { projects } = await import("../lib/schema.ts");
const { unsafeScopeForTest } = await import("../lib/company.ts");
const { extractInspection, hasUsableText } = await import("../lib/inspectionExtract.ts");
const { saveInspection, categoryCounts, historySummary } = await import("../lib/history.ts");
const { eq } = await import("drizzle-orm");
const { extractText, getDocumentProxy } = await import("unpdf");

const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
if (!proj) { console.error(`No project "${projectId}".`); process.exit(1); }
// The scope is built from the project ROW, exactly as resolveScope does after
// verifying membership — this script IS the server, so there is no header to
// distrust. unsafeScopeForTest is the only way to mint one outside a request.
const scope = unsafeScopeForTest(proj.id, proj.companyId, proj.creatorId);
console.log(`site: ${proj.name}  ·  company: ${proj.companyId}${dry ? "  (DRY RUN)" : ""}\n`);

const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
let ok = 0, skipped = 0, items = 0;

for (const f of files) {
  const doc = f.replace(/\.pdf$/i, "");
  try {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    const pdf = await getDocumentProxy(bytes);
    const out = await extractText(pdf, { mergePages: true });
    const text = String(out.text).replace(/\s+/g, " ").trim();

    // No text layer → hand the PDF to the model and let it read the pages.
    const scanned = !hasUsableText(text, out.totalPages);
    if (scanned) {
      if (out.totalPages > 30 || bytes.byteLength > 24 * 1024 * 1024) {
        console.log(`  skip  ${doc} — scan too big to read as images (${out.totalPages}pp, ${Math.round(bytes.byteLength / 1024 / 1024)}MB)`);
        skipped++;
        continue;
      }
      console.log(`  scan  ${doc} — no text layer (${text.length} chars over ${out.totalPages} pages), reading the pages`);
    }

    const extracted = await extractInspection({ text, filename: f, pdf: scanned ? bytes : undefined, scanned });
    if (extracted.degraded) {
      console.log(`  FAIL  ${doc} — ${extracted.degradedReason}; only the deterministic parse ran, so this was NOT filed`);
      skipped++;
      continue;
    }
    if (!extracted.isInspectionReport) {
      console.log(`  skip  ${doc} — not an inspection report`);
      skipped++;
      continue;
    }

    const cats = [...new Set(extracted.items.map((i) => i.category))];
    console.log(`  ok    ${extracted.inspectionCode ?? extracted.source.toUpperCase()} ${extracted.outcome.padEnd(7)} ${String(extracted.items.length).padStart(2)} item(s)  ${extracted.inspectedOn ?? "no date"}  ${cats.join(", ")}`);
    for (const it of extracted.items) console.log(`          · [${it.category}] ${it.title}`);

    if (!dry) await saveInspection(scope, { doc, extracted, createdBy: proj.creatorId });
    ok++;
    items += extracted.items.length;
  } catch (e) {
    console.log(`  FAIL  ${doc} — ${e instanceof Error ? e.message : e}`);
    skipped++;
  }
}

console.log(`\n${ok} report(s) read, ${skipped} skipped, ${items} failed item(s) extracted.`);
if (!dry) {
  console.log("\ncompany totals now:", JSON.stringify(await historySummary(scope)));
  console.log("by category:");
  for (const c of await categoryCounts(scope)) console.log(`  ${String(c.count).padStart(3)}  ${c.category}`);
}
