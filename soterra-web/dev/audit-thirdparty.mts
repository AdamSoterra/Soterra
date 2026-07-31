/**
 * Find the pages of a manufacturer's PDFs that carry THIRD-PARTY content, so
 * they can be excluded before ingest.
 *
 *   npx tsx dev/audit-thirdparty.mts "<folder or file>" [--json]
 *
 * Why this exists. Every permission email we send makes the same promise: we
 * quote the manufacturer's OWN material, and we never reproduce third-party
 * material that happens to sit inside their documents. A BRANZ appraisal, a
 * CSIRO or Warringtonfire test report, a CodeMark certificate or a block quote
 * of an NZS clause is somebody else's copyright, and several of those bodies
 * expressly forbid republishing extracts.
 *
 * dev/ingest-manufacturer.mts keeps that promise by never inserting the listed
 * pages. This script is what produces that list: it reads every page and flags
 * the ones whose text carries third-party markers, with the matching snippet so
 * the call can be checked rather than taken on trust.
 *
 * It is deliberately NOISY — it over-flags. A page that merely cites a standard
 * by name ("tested to AS 1530.4") is fine to keep; a page that REPRODUCES the
 * appraisal or the test data is not. The snippet is there so that judgement is
 * made on evidence, and the audit stays a decision, not a regex.
 */
import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];
const asJson = process.argv.includes("--json");
/** The manufacturer whose documents these ARE — their own brand name is not a
 *  third-party signal on their own pages, and leaving it in drowns the real
 *  hits. e.g. --own=GIB when scanning the GIB manuals. */
const own = (process.argv.find((a) => a.startsWith("--own=")) ?? "").slice(6).trim().toLowerCase();
if (!target) {
  console.error('usage: npx tsx dev/audit-thirdparty.mts "<folder or file>" [--own=GIB] [--json]');
  process.exit(1);
}

const { extractText, getDocumentProxy } = await import("unpdf");

/**
 * Marker groups, worst first. `hard` = strong evidence the page REPRODUCES
 * someone else's document, which is the thing we promised never to serve.
 *
 * The distinction that makes this tool usable: CITING a third party is normal
 * and fine ("tested to AS 1530.4", "see the BRANZ appraisal", a co-branded
 * Rondo system). REPRODUCING one is not (the appraisal's text, the certificate,
 * the test data table, a block of standard clause). A first pass that flagged
 * any mention at all lit up 880 of 896 GIB pages and therefore decided nothing.
 * So the standards/appraisal markers now require reproduction evidence nearby,
 * and bare brand mentions are informational only.
 */
/**
 * Words that indicate the page LIFTS the other document rather than pointing at
 * it. Deliberately does NOT include "clause N": manufacturer specs are full of
 * ordinary references like "comply with NZBC B1/AS1 Clause 3 Timber (NZS 3604)",
 * and including it flagged 55 pages of that one boilerplate line as reproduction.
 */
const NEAR = String.raw`(?:reproduced|reproduction|extract(?:ed|s)?\s+from|taken\s+from|copyright|©|all\s+rights\s+reserved|with\s+(?:the\s+)?permission|courtesy\s+of)`;
const MARKERS: { group: string; hard: boolean; re: RegExp }[] = [
  // A reproduced appraisal: the appraisal identified AND appraisal-document language.
  { group: "BRANZ appraisal reproduced", hard: true, re: new RegExp(String.raw`\bBRANZ\s+Appraisal\b[\s\S]{0,400}?${NEAR}|${NEAR}[\s\S]{0,400}?\bBRANZ\s+Appraisal\b`, "i") },
  { group: "BRANZ mention", hard: false, re: /\bBRANZ\b/i },
  { group: "CodeMark certificate", hard: true, re: /\bCodeMark\b[\s\S]{0,200}?\bcertificate\b|\bCertificate\s+of\s+Conformity\b/i },
  { group: "Test house", hard: true, re: /\bCSIRO\b|\bWarringtonfire\b|\bWarrington\s+Fire\b|\bExova\b|\bBM\s?TRADA\b|\bEfectis\b|\bIntertek\b/i },
  { group: "Test report id", hard: true, re: /\b(?:test|assessment)\s+report\s+(?:no\.?|number|ref)\s*[:.]?\s*[A-Z0-9][-A-Z0-9/]{3,}/i },
  { group: "Standards copyright", hard: true, re: /Standards\s+New\s+Zealand|©\s*Standards|reproduced\s+with\s+permission\s+of\s+Standards/i },
  // Standard clause text lifted in, rather than a bare "complies with NZS 3604".
  { group: "Standard clause reproduced", hard: true, re: new RegExp(String.raw`\b(?:AS/NZS|NZS|AS)\s?\d{3,5}(?:[.:]\d+)*\b[\s\S]{0,200}?${NEAR}`, "i") },
  { group: "Standard cited", hard: false, re: /\b(?:AS\/NZS|NZS|AS)\s?\d{3,5}(?:[.:]\d+)*\b/ },
  { group: "Other-brand", hard: false, re: /\bGIB\b|\bJames\s+Hardie\b|\bWinstone\b|\bRondo\b|\bPink®?\s*Batts\b|\bKnauf\b|\bUSG\b|\bSiniat\b|\bPromat\b|\bHilti\b/i },
];

/** Drop the manufacturer's own brand from the other-brand alternation, so
 *  scanning GIB's manuals doesn't flag every page that says "GIB". */
const MARKER_SET = MARKERS.map((m) => {
  if (m.group !== "Other-brand" || !own) return m;
  const kept = m.re.source
    .split("|")
    .filter((alt) => !alt.toLowerCase().replace(/[\\b®?\s*]/g, "").includes(own.replace(/\s+/g, "")));
  return kept.length ? { ...m, re: new RegExp(kept.join("|"), "i") } : null;
}).filter((m): m is { group: string; hard: boolean; re: RegExp } => m !== null);

function snippet(text: string, re: RegExp): string {
  const m = text.match(re);
  if (!m || m.index === undefined) return "";
  const s = Math.max(0, m.index - 60);
  return text.slice(s, Math.min(text.length, m.index + m[0].length + 60)).replace(/\s+/g, " ").trim();
}

const files = fs.statSync(target).isDirectory()
  ? fs.readdirSync(target).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => path.join(target, f))
  : [target];

type Hit = { file: string; page: number; npages: number; groups: string[]; hard: boolean; snippet: string };
const hits: Hit[] = [];
const summary: { file: string; npages: number; flagged: number; hard: number; empty: number }[] = [];

for (const file of files) {
  try {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const pdf = await getDocumentProxy(bytes);
    const out = await extractText(pdf, { mergePages: false });
    const texts: string[] = Array.isArray(out.text) ? out.text : [String(out.text)];

    let flagged = 0;
    let hard = 0;
    let empty = 0;
    texts.forEach((raw, i) => {
      const text = (raw ?? "").replace(/\s+/g, " ").trim();
      // A page with almost no text layer is either a cover, a photo page, or a
      // vector-outline page that will ingest as a blank. Worth surfacing: the
      // last kind needs a hand transcription (see `overrides` in the ingester).
      if (text.length < 40) { empty++; return; }
      const groups: string[] = [];
      let isHard = false;
      let snip = "";
      for (const m of MARKER_SET) {
        if (m.re.test(text)) {
          groups.push(m.group);
          if (m.hard) isHard = true;
          if (!snip) snip = snippet(text, m.re);
        }
      }
      if (groups.length) {
        flagged++;
        if (isHard) hard++;
        hits.push({ file: path.basename(file), page: i + 1, npages: out.totalPages, groups, hard: isHard, snippet: snip });
      }
    });
    summary.push({ file: path.basename(file), npages: out.totalPages, flagged, hard, empty });
  } catch (e) {
    console.error(`FAIL  ${path.basename(file)} — ${e instanceof Error ? e.message : e}`);
  }
}

if (asJson) {
  console.log(JSON.stringify({ summary, hits }, null, 2));
} else {
  console.log(`\n=== ${files.length} file(s) scanned ===\n`);
  for (const s of summary) {
    console.log(`${s.file}\n   ${s.npages}pp · ${s.flagged} flagged (${s.hard} hard) · ${s.empty} with no text layer`);
    const mine = hits.filter((h) => h.file === s.file);
    const hardPages = mine.filter((h) => h.hard).map((h) => h.page);
    const softPages = mine.filter((h) => !h.hard).map((h) => h.page);
    if (hardPages.length) console.log(`   HARD  pages: ${hardPages.join(", ")}`);
    if (softPages.length) console.log(`   check pages: ${softPages.join(", ")}`);
    console.log("");
  }
  console.log("--- evidence (hard flags) ---");
  for (const h of hits.filter((x) => x.hard)) {
    console.log(`\n${h.file} p${h.page}  [${h.groups.join(", ")}]\n   "${h.snippet}"`);
  }
  console.log(`\nSuggested "exclude" arrays (HARD flags only — review the soft list before adding):`);
  for (const s of summary) {
    const hardPages = hits.filter((h) => h.file === s.file && h.hard).map((h) => h.page);
    console.log(`  ${JSON.stringify(s.file)}: ${JSON.stringify(hardPages)}`);
  }
}
