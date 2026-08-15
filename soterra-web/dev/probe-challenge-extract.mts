/**
 * Stress-test lib/inspectionExtract.ts against the CHALLENGE report set —
 * the deliberately messy corpus in "Soterra Challenge Inspection Reports".
 * Reads PDFs, runs the real extraction (model calls included), and scores the
 * result against the authored ground truth. NO database reads or writes.
 *
 *   npx tsx dev/probe-challenge-extract.mts <file-or-subfolder> [more...]
 *   npx tsx dev/probe-challenge-extract.mts --sample     # 1 per subfolder
 *
 * Scoring is word-overlap based: a ground-truth item counts as FOUND when an
 * extracted item shares enough significant words with its title or its
 * verbatim match span; a trap counts as HIT the same way. Approximate on
 * purpose — the model reworded things; we care about substance.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { extractInspection, hasUsableText } = await import("../lib/inspectionExtract.ts");
const { extractText, getDocumentProxy } = await import("unpdf");

const ROOT = path.join(os.homedir(), "Desktop", "Soterra Challenge Inspection Reports");
const GT_PATH = path.join(ROOT, "_generator", "ground-truth.json");

type GtItem = { title: string; match: string; location: string; category: string; borderline: boolean };
type GtTrap = { match: string; reason: string };
type Gt = { shouldExtract: GtItem[]; mustNotExtract: GtTrap[] };
const GT: Record<string, Gt> = JSON.parse(fs.readFileSync(GT_PATH, "utf8"));

const STOP = new Set(["the", "and", "not", "for", "with", "are", "was", "has", "have", "been", "this", "that", "its", "all", "per", "one", "two", "still", "yet", "required", "install", "installed", "complete", "completed", "provide", "provided", "confirm", "check", "level", "unit", "ground", "floor", "basement"]);
const words = (s: string) =>
  new Set(
    s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w))
  );
const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.size;
};
/** The extracted items covering this ground-truth text (empty = not covered). */
const coveredBy = (gtText: string, items: { title: string; detail: string | null; location: string | null }[]) => {
  const g = words(gtText);
  return items.filter((it) => overlap(g, words(`${it.title} ${it.detail ?? ""} ${it.location ?? ""}`)) >= 0.5);
};
const covered = (gtText: string, items: { title: string; detail: string | null; location: string | null }[]) =>
  coveredBy(gtText, items).length > 0;

// ─── pick the files ───────────────────────────────────────────────────────
const args = process.argv.slice(2).filter((a) => a !== "--sample");
const sample = process.argv.includes("--sample");
let files: string[] = [];
if (sample) {
  for (const sub of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, sub);
    if (!fs.statSync(dir).isDirectory() || sub.startsWith("_")) continue;
    const pdfs = fs.readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort();
    if (pdfs.length) files.push(path.join(dir, pdfs[0]));
  }
} else {
  for (const a of args) {
    const full = path.isAbsolute(a) ? a : path.join(ROOT, a);
    if (fs.statSync(full).isDirectory()) {
      files.push(...fs.readdirSync(full).filter((f) => f.endsWith(".pdf")).map((f) => path.join(full, f)));
    } else files.push(full);
  }
}
if (!files.length) {
  console.error("usage: npx tsx dev/probe-challenge-extract.mts <file-or-subfolder> [...] | --sample");
  process.exit(1);
}

// ─── run ──────────────────────────────────────────────────────────────────
let totFound = 0, totMissed = 0, totTraps = 0, totBorderMissed = 0;
const fileResults: { file: string; found: number; of: number; traps: number; notes: string[] }[] = [];

for (const full of files) {
  const filename = path.basename(full);
  const gt = GT[filename];
  if (!gt) { console.log(`SKIP ${filename} (no ground truth)`); continue; }

  const bytes = new Uint8Array(fs.readFileSync(full));
  const pdf = await getDocumentProxy(bytes);
  const out = await extractText(pdf, { mergePages: true });
  const text = String(out.text).replace(/\s+/g, " ").trim();
  const scanned = !hasUsableText(text, out.totalPages);
  if (scanned) console.log(`⚠ ${filename}: text layer too thin (${text.length} chars over ${out.totalPages}pp) — scanned path`);

  const res = await extractInspection({ text, filename, pdf: bytes, scanned });

  const notes: string[] = [];
  let found = 0;
  const missed: GtItem[] = [];
  const claimed = new Set<(typeof res.items)[number]>();
  for (const g of gt.shouldExtract) {
    const by = coveredBy(`${g.title} ${g.match}`, res.items);
    if (by.length) { found++; by.forEach((i) => claimed.add(i)); }
    else missed.push(g);
  }
  // A trap only counts against items NOT already claimed by a real defect —
  // captions and admin lines share words with the defect they sit beside, and
  // blaming the defect item for the caption is a scoring bug, not a miss.
  const unclaimed = res.items.filter((i) => !claimed.has(i));
  const trapsHit: GtTrap[] = gt.mustNotExtract.filter((t) => covered(t.match, unclaimed));

  totFound += found;
  totMissed += missed.length;
  totBorderMissed += missed.filter((m) => m.borderline).length;
  totTraps += trapsHit.length;

  for (const m of missed) notes.push(`MISSED${m.borderline ? " (borderline)" : ""}: ${m.title}`);
  for (const t of trapsHit) {
    const by = coveredBy(t.match, unclaimed).map((i) => i.title).join(" | ");
    notes.push(`TRAP HIT (${t.reason}): ${t.match.slice(0, 70)}\n       matched item(s): ${by}`);
  }
  if (res.degraded) notes.push(`degraded: ${res.degradedReason}`);
  if (res.underRead) notes.push(`underRead flag set (expected ~${res.expectedItems})`);

  const extras = res.items.length - found;
  fileResults.push({ file: filename, found, of: gt.shouldExtract.length, traps: trapsHit.length, notes });
  console.log(`\n${filename}`);
  console.log(`  outcome ${res.outcome} · code ${res.inspectionCode ?? "-"} · ${res.items.length} items extracted`);
  console.log(`  ground truth: found ${found}/${gt.shouldExtract.length} · traps hit ${trapsHit.length}/${gt.mustNotExtract.length} · extras ${extras}`);
  for (const n of notes) console.log(`   - ${n}`);
}

console.log(`\n═══ TOTAL over ${fileResults.length} reports ═══`);
const denom = totFound + totMissed;
console.log(`found ${totFound}/${denom} (${denom ? Math.round((100 * totFound) / denom) : 0}%) · borderline missed ${totBorderMissed} · traps wrongly extracted ${totTraps}`);
const worst = fileResults.filter((f) => f.found < f.of || f.traps > 0);
if (worst.length) {
  console.log(`struggled on:`);
  for (const w of worst) console.log(`  ${w.file}: ${w.found}/${w.of}, traps ${w.traps}`);
} else {
  console.log("clean sweep — nothing missed, no traps taken.");
}
