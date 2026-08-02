/**
 * Load MBIE determinations into `determination_pages`, the corpus behind the
 * assistant's `search_determinations` tool.
 *
 *   npx tsx dev/ingest-determinations.mts [folder] [--from=2019] [--to=2026] [--dry]
 *
 * Determinations are published by MBIE under CC BY 4.0. They are the record of
 * how the Building Code was actually applied when someone argued about it, so
 * they answer the question the Code text cannot: what happens at the boundary.
 *
 * DEFAULT RANGE IS 2019+ ON PURPOSE (BUILD-PLAN.md §3). Older determinations
 * cite Acceptable Solutions that have since been superseded (H1 changed hard
 * over 2021-23), and a confidently-quoted stale figure is worse than no answer.
 * The full set back to 2005 is on disk if the range is ever widened.
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--")) ?? "C:/Users/adam/Desktop/Soterra/Determinations";
const dry = args.includes("--dry");
const FROM = Number(args.find((a) => a.startsWith("--from="))?.slice(7) ?? 2019);
const TO = Number(args.find((a) => a.startsWith("--to="))?.slice(5) ?? 2100);

const { db } = await import("../lib/db.ts");
const { determinationPages } = await import("../lib/schema.ts");
const { eq } = await import("drizzle-orm");
const { extractText, getDocumentProxy } = await import("unpdf");

const files = fs
  .readdirSync(folder)
  .filter((f) => /^(\d{4})-(\d{3})\.pdf$/i.test(f))
  .filter((f) => {
    const y = Number(f.slice(0, 4));
    return y >= FROM && y <= TO;
  })
  .sort();

console.log(`${files.length} determination(s) in range ${FROM}-${TO === 2100 ? "latest" : TO}\n`);

/** "Determination 2024/001 Regarding <subject> Summary|Contents" → the subject.
 *  Real files vary more than that: some omit the reference from page 1, some
 *  separate it with a Unicode hyphen ("2023‐012"), some run it together
 *  ("Determination2024/009"), and some drop the word "Regarding" entirely. */
// Where the subject ends. Not every determination prints "Summary" — several
// run the subject straight into the street address, so the body's opening
// phrase is the only boundary there is.
const STOPS = [/\bSummary\b/i, /\bContents\b/i, /\bThis determination\b/i, /\bConcerns\s+whether\b/i, /\bDate:/i, /\b1\.\s/];

function subjectFrom(firstPage: string, ref: string): string | null {
  const flat = firstPage.replace(/\s+/g, " ").trim();
  const [y, n] = ref.split("/");

  // Find where the subject starts. Tolerates "Determinations" (plural), a
  // missing space, any dash-like separator, and a footnote digit stuck to the
  // reference ("2024/0251").
  let start = -1;
  const m = flat.match(new RegExp(`Determinations?\\s*${y}\\s*[\\/\\u2010-\\u2015-]\\s*${n}\\d?`, "i"));
  if (m?.index != null) start = m.index + m[0].length;
  else {
    const r = flat.match(/\bRegarding\b/i);
    if (r?.index != null) start = r.index;
  }
  if (start < 0) return null;

  let s = flat.slice(start).trim().replace(/^Regarding\s+/i, "");
  let cut = s.length;
  for (const st of STOPS) {
    const hit = s.match(st);
    if (hit?.index != null && hit.index > 5 && hit.index < cut) cut = hit.index;
  }
  s = s.slice(0, cut).trim().replace(/[.,;:]+$/, "");
  return s.length >= 6 ? s.slice(0, 300) : null;
}

let docs = 0;
let indexed = 0;
const problems: string[] = [];

for (const f of files) {
  const full = path.join(folder, f);
  const year = Number(f.slice(0, 4));
  const ref = `${f.slice(0, 4)}/${f.slice(5, 8)}`;

  try {
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(full)));
    const out = await extractText(pdf, { mergePages: false });
    const texts: string[] = Array.isArray(out.text) ? out.text : [String(out.text)];
    const subject = subjectFrom(texts[0] ?? "", ref);
    if (!subject) problems.push(`NO SUBJECT  ${ref} (indexed anyway)`);

    const rows = texts
      .map((t, i) => ({
        ref,
        year,
        subject,
        file: f,
        page: i + 1,
        npages: out.totalPages,
        text: (t ?? "").replace(/\s+/g, " ").trim(),
      }))
      .filter((r) => r.text.length >= 40); // contents/blank pages carry nothing

    if (!rows.length) {
      problems.push(`NO TEXT  ${ref} — a scan?`);
      continue;
    }

    if (!dry) {
      await db.delete(determinationPages).where(eq(determinationPages.ref, ref));
      for (let i = 0; i < rows.length; i += 100) await db.insert(determinationPages).values(rows.slice(i, i + 100));
    }
    docs++;
    indexed += rows.length;
    if (docs % 25 === 0 || docs === files.length) console.log(`  ${docs}/${files.length} … ${indexed} pages`);
  } catch (e) {
    problems.push(`FAIL  ${ref} — ${e instanceof Error ? e.message : e}`);
  }
}

console.log(`\n${docs} determination(s), ${indexed} page(s)${dry ? " (dry run, nothing written)" : " indexed"}.`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
}
process.exit(0);
