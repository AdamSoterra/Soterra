// Checks the revision parser against the REAL doc names in plan_pages, plus
// synthetic revision-bump cases. A wrong split merges two different drawings,
// so this errs toward loudly showing every grouping decision.
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { parseSheetRev, currentRevisionsOnly } = await import("../lib/sheetRev.ts");
const { db } = await import("../lib/db.ts");
const { planPages } = await import("../lib/schema.ts");

const rows = await db.selectDistinct({ doc: planPages.doc }).from(planPages);
const docs = rows.map((r) => r.doc).sort();
console.log(`=== ${docs.length} real doc names ===`);

const groups = new Map<string, { doc: string; rev: number | null; label: string | null }[]>();
for (const doc of docs) {
  const { sheetKey, rev, revLabel } = parseSheetRev(doc);
  const l = groups.get(sheetKey) ?? [];
  l.push({ doc, rev, label: revLabel });
  groups.set(sheetKey, l);
}
const parsed = docs.filter((d) => parseSheetRev(d).rev !== null).length;
console.log(`parsed a revision from : ${parsed}/${docs.length}`);
console.log(`distinct sheet keys    : ${groups.size}`);

const merged = [...groups.entries()].filter(([, v]) => v.length > 1);
console.log(`\nkeys holding >1 doc (these MUST be genuinely the same sheet): ${merged.length}`);
for (const [k, v] of merged) console.log(`  ${k}\n     ${v.map((x) => `${x.doc} [rev ${x.label ?? "-"}]`).join("\n     ")}`);

console.log(`\n=== sample parses ===`);
for (const d of docs.slice(0, 5)) {
  const p = parseSheetRev(d);
  console.log(`  ${d}\n     -> key="${p.sheetKey}" rev=${p.rev} label=${p.revLabel}`);
}

console.log(`\n=== synthetic revision-bump cases ===`);
const cases: [string, string, string][] = [
  ["S7.10-DETAILS-Rev.1", "S7.10-DETAILS-Rev.3", "numeric bump"],
  ["A-201 Floor Plan Rev A", "A-201 Floor Plan Rev C", "alpha bump"],
  ["E-100_SITE_REVISION_2", "E-100_SITE_REVISION_10", "10 must beat 2, not sort as string"],
  ["S1.01-FOUNDATION-Rev.Z", "S1.01-FOUNDATION-Rev.AA", "AA must beat Z"],
  ["A-100-PLAN", "A-100-PLAN-Rev.2", "unrevised original superseded by a revised one"],
];
let pass = 0;
for (const [oldName, newName, why] of cases) {
  const pages = [
    { doc: oldName, uploadedAt: 1000, text: "" },
    { doc: newName, uploadedAt: 2000, text: "" },
  ];
  const kept = currentRevisionsOnly(pages).map((p) => p.doc);
  const ok = kept.length === 1 && kept[0] === newName;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${why}: kept ${JSON.stringify(kept)}`);
  if (ok) pass++;
}

// A genuinely different sheet must NOT be swallowed.
const distinct = currentRevisionsOnly([
  { doc: "S7.10-MIDFLOOR-Rev.1", uploadedAt: 1000, text: "" },
  { doc: "S7.11-MIDFLOOR-Rev.1", uploadedAt: 1000, text: "" },
]);
const ok2 = distinct.length === 2;
console.log(`  ${ok2 ? "PASS" : "FAIL"}  two different sheets both survive (${distinct.length}/2)`);

// Every PAGE of the winning revision must survive — this filters revisions, not pages.
const multipage = currentRevisionsOnly([
  { doc: "Spec-03300-Rev.2", uploadedAt: 2000, text: "" },
  { doc: "Spec-03300-Rev.2", uploadedAt: 2000, text: "" },
  { doc: "Spec-03300-Rev.2", uploadedAt: 2000, text: "" },
  { doc: "Spec-03300-Rev.1", uploadedAt: 1000, text: "" },
]);
const ok3 = multipage.length === 3 && multipage.every((p) => p.doc === "Spec-03300-Rev.2");
console.log(`  ${ok3 ? "PASS" : "FAIL"}  all 3 pages of Rev.2 kept, Rev.1 dropped (${multipage.length}/3)`);

console.log(`\n${pass === cases.length && ok2 ? "ALL PASS" : "FAILURES ABOVE"}`);
