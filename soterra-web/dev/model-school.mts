// Models a realistic large project (school): 7 crew, high question rate, a plan
// set far bigger than Kauri Tower's 120 sheets, and a question mix that includes
// calendar/task operations as well as plan and code lookups.
//
// AI cost is built from MEASURED token components (dev/measure-cost.mts), not
// guessed. Retrieval timing is benchmarked locally against a synthetic corpus.
import fs from "node:fs";
const { computeDf, retrieve, excerpt } = await import("../lib/retrieve.ts");

const NZD = 1.66;
const IN = 3.0, OUT = 15.0, CACHE_READ = 0.30; // USD per 1M tokens, Sonnet 4.6

// ---- Measured components (from the real runs) ----
const PREFIX_TOK = 4438;      // cached prefix actually read per call
const TOK_PER_PAGE = 800;     // a 2,800-char excerpt
const OUT_TOK = 292;          // average answer
const CONTEXT_TOK = 350;      // dynamicContext: date, events, tasks, crew
const ROUNDS = 1.3;           // measured average tool rounds

const cacheRead = PREFIX_TOK * CACHE_READ / 1e6;
const outCost = (t: number) => t * OUT / 1e6;
const inCost = (t: number) => t * IN / 1e6;

// A PLAN question: 8 retrieved pages + dynamic context.
const planSingle = cacheRead + inCost(8 * TOK_PER_PAGE + CONTEXT_TOK + 30) + outCost(OUT_TOK);
const planCost = planSingle + (ROUNDS - 1) * (inCost(8 * TOK_PER_PAGE) + outCost(OUT_TOK));

// A CODE question: 6 retrieved pages.
const codeSingle = cacheRead + inCost(6 * TOK_PER_PAGE + CONTEXT_TOK + 30) + outCost(OUT_TOK);
const codeCost = codeSingle + (ROUNDS - 1) * (inCost(6 * TOK_PER_PAGE) + outCost(OUT_TOK));

// A CALENDAR/TASK operation ("book the council inspection Tuesday 9am").
// No retrieval payload at all — but it's always 2 API calls: one to emit the
// tool_use, one to confirm after the tool result comes back.
const calCall1 = cacheRead + inCost(CONTEXT_TOK + 30) + outCost(80);
const calCall2 = cacheRead + inCost(CONTEXT_TOK + 30 + 80 + 60) + outCost(100);
const calCost = calCall1 + calCall2;

console.log("=== measured cost per interaction type (USD) ===");
console.log(`  PLAN question  (8 pages + context, ${ROUNDS} rounds) : $${planCost.toFixed(5)}`);
console.log(`  CODE question  (6 pages + context, ${ROUNDS} rounds) : $${codeCost.toFixed(5)}`);
console.log(`  CALENDAR/TASK  (no retrieval, 2 calls)          : $${calCost.toFixed(5)}   <- cheapest`);
console.log();

// ---- The school scenario ----
const CREW = 7, DAYS = 22;
console.log(`=== SCHOOL PROJECT: ${CREW} crew, ${DAYS} working days ===`);
for (const perDay of [4, 5]) {
  const total = CREW * perDay * DAYS;
  console.log(`\n  ${perDay} questions/person/day = ${total} questions/month`);
  const mixes: [string, number, number, number][] = [
    ["realistic mix (50% plan / 25% code / 25% calendar)", 0.5, 0.25, 0.25],
    ["heavy plan use (75% plan / 15% code / 10% calendar)", 0.75, 0.15, 0.10],
    ["worst case (100% plan questions)", 1.0, 0, 0],
  ];
  for (const [label, p, c, k] of mixes) {
    const usd = total * (p * planCost + c * codeCost + k * calCost);
    console.log(`    ${label.padEnd(52)} US$${usd.toFixed(2).padStart(6)}  =  NZ$${(usd * NZD).toFixed(2).padStart(6)}/mo`);
  }
}

// ---- Does a bigger plan set cost more? ----
console.log(`\n=== does a bigger plan set cost more in AI? ===`);
console.log(`  NO. retrieve() always sends the top 8 pages regardless of corpus size.`);
console.log(`  120 sheets or 5,000 sheets -> the model sees 8 pages. AI cost is FLAT.`);
console.log(`  Indexing is $0 (local text extraction). Storage is trivial.`);

// ---- But what does it do to SPEED? Benchmark locally. ----
console.log(`\n=== but what does it do to SPEED? (local benchmark) ===`);
const real = JSON.parse(fs.readFileSync("data/arthur-road-index.json", "utf8"));
const synth = (n: number) => {
  const out: any[] = [];
  while (out.length < n) for (const p of real) { if (out.length >= n) break; out.push({ ...p, doc: p.doc + "-" + out.length }); }
  return out;
};
for (const n of [120, 571, 1500, 2500, 5000]) {
  const corpus = synth(n);
  const t0 = performance.now();
  const df = computeDf(corpus);
  const t1 = performance.now();
  for (let i = 0; i < 5; i++) retrieve(corpus, df, "external wall cladding build-up fire rating", 8);
  const t2 = performance.now();
  const mb = corpus.reduce((s, p) => s + p.text.length, 0) / 1048576;
  console.log(`  ${String(n).padStart(5)} pages (${mb.toFixed(1)} MB): computeDf ${(t1 - t0).toFixed(0).padStart(5)}ms + retrieve ${((t2 - t1) / 5).toFixed(0).padStart(4)}ms = ${((t1 - t0) + (t2 - t1) / 5).toFixed(0).padStart(5)}ms per question, EVERY question`);
}
console.log(`\n  (plus pulling that many MB out of Neon on every call — network time on top)`);
