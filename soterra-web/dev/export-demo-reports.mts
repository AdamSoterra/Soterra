// Creates the desktop folder + discipline subfolders and writes a manifest of
// the 36 demo inspection reports (with resolved dates + suggested filenames) so
// the actual report PDFs can be generated from it. Read-only re: the app/DB.
//   npx tsx dev/export-demo-reports.mts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { INSPECTIONS } from "./demo-inspections-data.ts";

const ROOT = path.join(os.homedir(), "Desktop", "Soterra Demo Inspection Reports");
const NOW = Date.now();
const dateOf = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString().slice(0, 10);
const ymd = (iso: string) => iso.replace(/-/g, "");
const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const outcomeLabel = (o: string) => (o === "pass" ? "Pass" : o === "fail" ? "Fail" : "Partial Pass");

const disciplineOf = (i: (typeof INSPECTIONS)[number]) => (i.source === "council" ? "Council" : i.type);

// build folders
fs.mkdirSync(ROOT, { recursive: true });
const manifest = INSPECTIONS.map((insp, idx) => {
  const date = dateOf(insp.daysAgo);
  const discipline = disciplineOf(insp);
  fs.mkdirSync(path.join(ROOT, discipline), { recursive: true });
  const filename =
    insp.source === "council"
      ? `${slug(insp.site)}_${insp.code}_${outcomeLabel(insp.outcome).replace(/ /g, "-")}_${ymd(date)}.pdf`
      : `${ymd(date)}_${slug(insp.site)}_${insp.type}_Site-Observation-Report.pdf`;
  return {
    n: idx + 1,
    filename,
    subfolder: discipline,
    kind: insp.source, // council | consultant
    reportTitle: insp.source === "council" ? `${insp.type} inspection (${insp.code})` : `${insp.type} Site Observation Report`,
    site: insp.site,
    consentNo: insp.source === "council" ? `BCO${100000 + idx * 137}` : null,
    inspector: insp.inspector,
    inspectionCode: insp.code ?? null,
    inspectionType: insp.type,
    outcome: insp.outcome,
    outcomeLabel: outcomeLabel(insp.outcome),
    date, // YYYY-MM-DD
    items: insp.items.map((it, j) => ({
      no: j + 1,
      category: it.cat,
      title: it.title,
      detail: it.detail,
      location: it.loc ?? null,
    })),
  };
});

fs.writeFileSync(path.join(ROOT, "reports-manifest.json"), JSON.stringify(manifest, null, 2));

const byDisc = manifest.reduce<Record<string, number>>((a, m) => ((a[m.subfolder] = (a[m.subfolder] ?? 0) + 1), a), {});
console.log("Folder:", ROOT);
console.log("Reports:", manifest.length);
console.log("By subfolder:", JSON.stringify(byDisc));
console.log("Manifest: reports-manifest.json written.");
