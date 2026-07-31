/**
 * Download a manufacturer's public technical PDFs, then prove each one is real.
 *
 *   npx tsx dev/fetch-docs.mts <list.json> "<target folder>"
 *
 * list.json: [{ "title": "...", "url": "https://.../x.pdf" }, ...]
 *
 * Why not just curl a loop: a dead or moved link on a manufacturer's site
 * usually returns a 200 HTML page ("document not found"), not a 404. Saved with
 * a .pdf name that lands as a file the ingester then reads as zero pages, and
 * the document goes missing from the corpus silently. So every download is
 * checked for the %PDF header and opened to count pages before it counts as a
 * success, and anything that fails is reported loudly rather than left on disk.
 *
 * Prints a ready-to-paste manifest `docs` array for dev/ingest-manufacturer.mts.
 */
import fs from "node:fs";
import path from "node:path";

const listPath = process.argv[2];
const outDir = process.argv[3];
if (!listPath || !outDir) {
  console.error('usage: npx tsx dev/fetch-docs.mts <list.json> "<target folder>"');
  process.exit(1);
}

const { getDocumentProxy } = await import("unpdf");

type Item = { title: string; url: string };
const items: Item[] = JSON.parse(fs.readFileSync(listPath, "utf8"));
fs.mkdirSync(outDir, { recursive: true });

const safe = (t: string) => t.replace(/[^\w\-. ()&]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);
const ok: { title: string; file: string; url: string; pages: number; kb: number }[] = [];
const failed: { title: string; url: string; why: string }[] = [];

for (const it of items) {
  const file = `${safe(it.title)}.pdf`;
  const full = path.join(outDir, file);
  try {
    const res = await fetch(it.url, {
      redirect: "follow",
      headers: {
        // Some manufacturer CDNs refuse a bare fetch with no UA.
        "User-Agent": "Mozilla/5.0 (compatible; Soterra/1.0; +https://soterra.co.nz)",
        Accept: "application/pdf,*/*",
      },
    });
    if (!res.ok) { failed.push({ title: it.title, url: it.url, why: `HTTP ${res.status}` }); continue; }

    const buf = Buffer.from(await res.arrayBuffer());
    // A "document not found" HTML page saved as .pdf is the failure this catches.
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      failed.push({ title: it.title, url: it.url, why: `not a PDF (starts "${buf.subarray(0, 16).toString("latin1").replace(/[^\x20-\x7e]/g, ".")}")` });
      continue;
    }

    let pages = 0;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      pages = pdf.numPages;
    } catch (e) {
      failed.push({ title: it.title, url: it.url, why: `unreadable PDF — ${e instanceof Error ? e.message : e}` });
      continue;
    }

    fs.writeFileSync(full, buf);
    const kb = Math.round(buf.length / 1024);
    ok.push({ title: it.title, file, url: it.url, pages, kb });
    console.log(`  ok    ${it.title} — ${pages}pp, ${kb}kb`);
  } catch (e) {
    failed.push({ title: it.title, url: it.url, why: e instanceof Error ? e.message : String(e) });
  }
}

console.log(`\n${ok.length} downloaded, ${failed.length} failed.`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  ${f.title}\n     ${f.url}\n     ${f.why}`);
}

console.log(`\n--- manifest docs array (${ok.length} docs, ${ok.reduce((a, b) => a + b.pages, 0)} pages) ---`);
console.log(JSON.stringify(ok.map((d) => ({ file: d.file, title: d.title, url: d.url, exclude: [] })), null, 1));
