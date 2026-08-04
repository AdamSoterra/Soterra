/**
 * Gold-standard retrieval eval for the manufacturer corpus.
 *
 *   npx tsx dev/eval-retrieval.mts
 *
 * Why this exists: a smoke test that prints the top hit tells you retrieval ran,
 * not that it was RIGHT. This asserts, per question, that the page which
 * actually answers it comes back inside the window the assistant is given.
 *
 * The case that motivated it: "do I need sill tape on a Centrafix window". The
 * page that answers it says so ONCE ("there is no requirement for the
 * application of sill tapes"), while the sill detail-drawing pages repeat the
 * word "sill" ten times as drawing labels. Frequency-based scoring ranked the
 * answer 36th of 48, and the assistant confidently gave the OPPOSITE answer
 * depending on how it happened to word its search. A wrong yes/no on a
 * manufacturer's spec is the worst failure this product can have, so this eval
 * guards it.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getManufacturerIndex } = await import("../lib/manufacturerIndex.ts");
// The REAL ranking the assistant is handed, not plain retrieve() — otherwise the
// eval passes or fails on something the product never actually runs.
const { searchManufacturerPages } = await import("../lib/retrieve.ts");

type Case = {
  q: string;
  /** The manufacturer whose pages must win. */
  mfr: string;
  /** If set, one of these pages of `doc` must appear within the window. */
  doc?: string;
  pages?: number[];
  /** How many results the assistant would actually see. */
  k?: number;
};

const CASES: Case[] = [
  // ── The regression this eval was written for ──────────────────────────
  // The pages that STATE the rules, verified by reading the document:
  //   p12, p13 — "Flexible flashing tape is NOT required at top corners or
  //              along the sill of window openings"
  //   p15, p16 — "There is no requirement for the application of sill tapes"
  //   p20      — "The sill is not face taped" (and what IS taped: head + jambs)
  // At least one of these must reach the assistant, or it answers a yes/no from
  // detail drawings that merely depict tape, and gets it backwards.
  { q: "Centrafix sill tape required", mfr: "APL", doc: "Centrafix", pages: [12, 13, 15, 16, 20] },
  { q: "do I need sill tape on a Centrafix window", mfr: "APL", doc: "Centrafix", pages: [12, 13, 15, 16, 20] },
  { q: "APL Centrafix sill tape and corner flashing tape", mfr: "APL", doc: "Centrafix", pages: [12, 13, 15, 16, 20] },
  { q: "is flashing tape required at the corners of a Centrafix window", mfr: "APL", doc: "Centrafix", pages: [12, 13] },
  { q: "Centrafix taping order jamb head tape", mfr: "APL", doc: "Centrafix", pages: [20] },
  { q: "APL Centrafix fixing screws centres timber framing", mfr: "APL", doc: "Centrafix", pages: [18, 19] },

  // ── Cross-manufacturer: the right brand must win ──────────────────────
  { q: "GIB Aqualine fixing centres in a wet area", mfr: "GIB" },
  { q: "what fire rating does a GIB Fyreline wall achieve", mfr: "GIB" },
  { q: "bracing element ratings for GIB EzyBrace", mfr: "GIB" },
  { q: "Rondo steel stud and track screw fixing", mfr: "Rondo" },
  { q: "Allproof Vision shower channel waterproofing flange", mfr: "Allproof" },
  { q: "BOSS Fire FyreBox cast-in transit", mfr: "BOSS Fire" },
  { q: "Resene Lumbersider recoat time", mfr: "Resene" },
  { q: "ColorSteel coastal environmental category warranty", mfr: "ColorSteel" },
  { q: "James Hardie Axon Panel fixing", mfr: "James Hardie" },
  { q: "Kingspan Thermakraft Covertek underlay", mfr: "Kingspan Thermakraft" },
];

const { pages, df } = await getManufacturerIndex();
console.log(`corpus: ${pages.length} pages, ${new Set(pages.map((p) => p.manufacturer)).size} manufacturers\n`);

let pass = 0;
let fail = 0;
for (const c of CASES) {
  const k = c.k ?? 8;
  const top = searchManufacturerPages(pages as any, df, c.q, k) as any[];
  const brands = top.map((p) => p.manufacturer);
  const brandOk = brands.slice(0, 3).includes(c.mfr);

  let pageOk = true;
  let detail = "";
  if (c.doc && c.pages) {
    const hits = top.filter((p) => p.manufacturer === c.mfr && String(p.doc).includes(c.doc!)).map((p) => p.page);
    pageOk = c.pages.some((want) => hits.includes(want));
    detail = ` want p[${c.pages.join("/")}] got p[${hits.join(",") || "-"}]`;
  } else {
    detail = ` top3=[${brands.slice(0, 3).join(", ")}]`;
  }

  const ok = brandOk && pageOk;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.q}\n      ${c.mfr}${detail}`);
}

console.log(`\n${pass} passed, ${fail} failed, ${CASES.length} total`);
process.exit(fail ? 1 : 0);
