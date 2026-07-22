/**
 * Read reports that are already sitting in Blob but never made it into the
 * history — the exact case where the upload succeeded and the extraction then
 * failed (no API credit, a timeout, a bad deploy). Saves re-uploading.
 *
 *   npx tsx dev/reprocess-blobs.mts <projectId> [--dry] [--since=6h]
 *
 * Skips anything already filed under the same document name, so it's safe to
 * re-run. Skips the plan set too — a doc is only treated as a report if it
 * isn't already indexed as plan pages for this site.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const projectId = process.argv[2];
const dry = process.argv.includes("--dry");
const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "24h";
const sinceMs = /^(\d+)h$/.test(sinceArg) ? Number(sinceArg.slice(0, -1)) * 3600_000 : 24 * 3600_000;
if (!projectId) {
  console.error("usage: npx tsx dev/reprocess-blobs.mts <projectId> [--dry] [--since=6h]");
  process.exit(1);
}

const { db } = await import("../lib/db.ts");
const { projects, inspections, planPages } = await import("../lib/schema.ts");
const { unsafeScopeForTest } = await import("../lib/company.ts");
const { extractInspection, hasUsableText } = await import("../lib/inspectionExtract.ts");
const { saveInspection, categoryCounts, historySummary } = await import("../lib/history.ts");
const { eq, and } = await import("drizzle-orm");
const { extractText, getDocumentProxy } = await import("unpdf");
const blob = await import("@vercel/blob");

const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
if (!proj) { console.error(`No project "${projectId}".`); process.exit(1); }
const scope = unsafeScopeForTest(proj.id, proj.companyId, proj.creatorId);

const listed = await blob.list({ limit: 1000, prefix: `${projectId}/` });
const cutoff = Date.now() - sinceMs;
const candidates = listed.blobs
  .filter((b) => b.pathname.toLowerCase().endsWith(".pdf") || !b.pathname.includes("/checklists/"))
  .filter((b) => !b.pathname.includes("/checklists/"))
  .filter((b) => new Date(b.uploadedAt).getTime() >= cutoff);

console.log(`site: ${proj.name}  ·  ${candidates.length} blob(s) uploaded in the last ${sinceArg}${dry ? "  (DRY RUN)" : ""}\n`);

let ok = 0, skipped = 0, items = 0;
for (const b of candidates) {
  // Blob adds a random suffix to the pathname; the display name is what the
  // user actually uploaded, and it's what the history is keyed on.
  const base = b.pathname.slice(projectId.length + 1).replace(/-[A-Za-z0-9]{8,}(\.pdf)?$/i, "").replace(/\.pdf$/i, "");
  const doc = base;

  const already = await db.select({ id: inspections.id }).from(inspections).where(and(eq(inspections.projectId, projectId), eq(inspections.doc, doc))).limit(1);
  if (already.length) { console.log(`  skip  ${doc} — already filed`); skipped++; continue; }
  const isPlan = await db.select({ id: planPages.id }).from(planPages).where(and(eq(planPages.projectId, projectId), eq(planPages.doc, doc))).limit(1);
  if (isPlan.length) { console.log(`  skip  ${doc} — this is an indexed plan sheet, not a report`); skipped++; continue; }

  try {
    const got = await blob.get(b.pathname, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) { console.log(`  FAIL  ${doc} — couldn't fetch`); skipped++; continue; }
    const bytes = new Uint8Array(await new Response(got.stream).arrayBuffer());

    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const out = await extractText(pdf, { mergePages: true });
    const text = String(out.text).replace(/\s+/g, " ").trim();

    const scanned = !hasUsableText(text, out.totalPages);
    if (scanned && (out.totalPages > 30 || bytes.byteLength > 24 * 1024 * 1024)) {
      console.log(`  skip  ${doc} — scan too big to read as images (${out.totalPages}pp)`);
      skipped++;
      continue;
    }
    if (scanned) console.log(`  scan  ${doc} — no text layer, reading the pages`);

    const extracted = await extractInspection({ text, filename: `${doc}.pdf`, pdf: scanned ? bytes : undefined, scanned });
    if (extracted.degraded) { console.log(`  FAIL  ${doc} — ${extracted.degradedReason}; NOT filed`); skipped++; continue; }
    if (!extracted.isInspectionReport) { console.log(`  skip  ${doc} — not an inspection report`); skipped++; continue; }

    const cats = [...new Set(extracted.items.map((i) => i.category))];
    console.log(`  ok    ${(extracted.inspectionCode ?? extracted.source.toUpperCase()).padEnd(5)} ${extracted.outcome.padEnd(7)} ${String(extracted.items.length).padStart(2)} item(s)  ${extracted.inspectedOn ?? "no date"}  ${cats.join(", ")}`);
    for (const it of extracted.items) console.log(`          · [${it.category}] ${it.title}`);

    if (!dry) await saveInspection(scope, { doc, file: b.pathname, extracted, createdBy: proj.creatorId });
    ok++;
    items += extracted.items.length;
  } catch (e) {
    console.log(`  FAIL  ${doc} — ${e instanceof Error ? e.message : e}`);
    skipped++;
  }
}

console.log(`\n${ok} report(s) filed, ${skipped} skipped, ${items} failed item(s) extracted.`);
if (!dry && ok) {
  console.log("\ncompany totals now:", JSON.stringify(await historySummary(scope)));
  for (const c of await categoryCounts(scope)) console.log(`  ${String(c.count).padStart(3)}  ${c.category}`);
}
