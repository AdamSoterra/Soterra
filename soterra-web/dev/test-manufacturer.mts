/**
 * Smoke-test the manufacturer corpus the way the assistant actually reads it:
 * same index, same retrieval, same excerpt. Run before a demo so a bad ingest
 * is caught here rather than in front of the customer.
 *
 *   npx tsx dev/test-manufacturer.mts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getManufacturerIndex, manufacturerLabel } = await import("../lib/manufacturerIndex.ts");
const { retrieve, excerpt } = await import("../lib/retrieve.ts");

const QUESTIONS = [
  "GIB Aqualine fixing centres in a wet area",
  "intertenancy barrier system for terrace homes",
  "what fire rating does a GIB Fyreline wall achieve",
  "bracing element ratings for GIB EzyBrace",
  "how far apart should screws be on a ceiling",
  "handling and storage of plasterboard sheets on site",
  "control joints in a long wall",
  "GIB Weatherline rigid air barrier fixing",
  "GBSA 90f double steel frame wall STC rating",
];

const { pages, df } = await getManufacturerIndex();
console.log(`corpus: ${pages.length} pages, ${new Set(pages.map((p) => p.doc)).size} documents\n`);

let misses = 0;
for (const q of QUESTIONS) {
  const top = retrieve(pages, df, q, 3);
  if (!top.length) {
    console.log(`MISS  ${q}\n`);
    misses++;
    continue;
  }
  const p = top[0];
  const ex = excerpt(p.text, q, 260).replace(/\s+/g, " ");
  console.log(`Q  ${q}`);
  console.log(`   ${manufacturerLabel(p)}`);
  console.log(`   ${p.sourceUrl ?? "NO LINK"}`);
  console.log(`   "${ex.slice(0, 200)}…"\n`);
}

// The promise check: material we deliberately withheld must not be retrievable
// by any phrasing, because it isn't in the table at all.
const FORBIDDEN = ["BRANZ appraisal certificate conditions of appraisal", "NZS 3604 table reproduced"];
console.log("--- withheld-material check ---");
for (const q of FORBIDDEN) {
  const top = retrieve(pages, df, q, 3);
  const leak = top.filter((p) => /conditions of appraisal|this appraisal is|copyright of branz/i.test(p.text));
  console.log(`${leak.length === 0 ? "clean" : "LEAK "}  ${q}${leak.length ? ` → ${leak.map((l) => manufacturerLabel(l)).join("; ")}` : ""}`);
}

console.log(`\n${QUESTIONS.length - misses}/${QUESTIONS.length} questions retrieved a page.`);
