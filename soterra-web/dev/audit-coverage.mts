// Model-free measure of the truncation bug.
//
// For realistic queries, retrieve the top pages and ask: of all the places the
// query terms actually appear in the FULL page, what fraction survive into the
// 2800-char text we hand the model? slice() keeps the head; excerpt() centres on
// the match. If the model never sees the matching text, it cannot answer from it.
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { computeDf, retrieve, excerpt, expand } = await import("../lib/retrieve.ts");
const { db } = await import("../lib/db.ts");
const { codePages } = await import("../lib/schema.ts");

const PLAN_QUERIES = [
  "external wall cladding build-up", "fire rating of the intertenancy wall", "insulation R-value for the roof",
  "window schedule sizes", "paint colour for the interior walls", "finished floor level",
  "foundation slab thickness", "roof pitch", "door schedule hardware", "bathroom waterproofing",
  "kitchen bench height", "balustrade handrail height", "concrete strength", "timber framing sizes",
  "glazing specification", "soffit detail", "cavity batten spacing", "reinforcing mesh",
];
const CODE_QUERIES = [
  "barrier height deck", "hot water temperature", "cladding ground clearance", "stair rise going",
  "ramp gradient accessible", "durability 50 years", "ventilation openable area", "sound insulation apartments",
  "smoke alarm placement", "surface water drainage", "roof insulation R-value", "escape route travel distance",
];

// Positions where any query term matches in the full text.
function hitPositions(text: string, q: string): number[] {
  const out: number[] = [];
  const low = text.toLowerCase();
  for (const t of expand(q)) {
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(low))) out.push(m.index);
  }
  return out;
}

// What fraction of those hits land inside the delivered excerpt?
function coverage(text: string, q: string, delivered: string): number {
  const hits = hitPositions(text, q);
  if (hits.length === 0) return 1;
  const clean = delivered.replace(/^…/, "").replace(/ …\[truncated\]$/, "");
  const at = text.indexOf(clean.slice(0, 200));
  if (at === -1) return 0;
  const lo = at, hi = at + clean.length;
  return hits.filter((h) => h >= lo && h < hi).length / hits.length;
}

async function run(name: string, pages: { text: string; doc: string; page: number }[], queries: string[]) {
  const df = computeDf(pages);
  let sliceSum = 0, excSum = 0, n = 0, truncated = 0;
  let worst: { q: string; doc: string; s: number; e: number; len: number } | null = null;

  for (const q of queries) {
    for (const p of retrieve(pages, df, q, 6)) {
      const s = coverage(p.text, q, p.text.slice(0, 2800));
      const e = coverage(p.text, q, excerpt(p.text, q, 2800));
      sliceSum += s; excSum += e; n++;
      if (p.text.length > 2800) truncated++;
      if (p.text.length > 2800 && (!worst || s - e < worst.s - worst.e)) worst = { q, doc: `${p.doc} p${p.page}`, s, e, len: p.text.length };
    }
  }
  const pct = (x: number) => `${(100 * x / n).toFixed(1)}%`;
  console.log(`\n=== ${name} — ${n} retrieved page-results (${truncated} over 2800 chars) ===`);
  console.log(`  term coverage, slice(0,2800) : ${pct(sliceSum)}`);
  console.log(`  term coverage, excerpt()     : ${pct(excSum)}`);
  console.log(`  absolute gain                : ${((100 * (excSum - sliceSum)) / n).toFixed(1)} points`);
  if (worst) console.log(`  biggest single win: "${worst.q}" on ${worst.doc} (${worst.len} chars) ${(100*worst.s).toFixed(0)}% -> ${(100*worst.e).toFixed(0)}%`);
}

const planPagesData = JSON.parse(fs.readFileSync("data/arthur-road-index.json", "utf8"));
await run("PLANS (1 Arthur Road, 571pp)", planPagesData, PLAN_QUERIES);

const rows = await db.select({ doc: codePages.doc, page: codePages.page, text: codePages.text }).from(codePages);
await run("BUILDING CODE (3274pp)", rows, CODE_QUERIES);
