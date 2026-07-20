// NZ Building Code accuracy audit.
//
// Three-stage, so a failure is attributable rather than just "wrong":
//   A. GOLD  - does the corpus even contain the answer? (regex over code_pages)
//   B. RECALL- does retrieve() surface a gold page in the top 6?
//   C. ANSWER- does the model state the right figure, cite a real page, and not
//              invent a clause that isn't in what it was handed?
//
// Run:  npx tsx dev/audit-code.mts [--excerpt]
//   --excerpt  use the relevance-windowed excerpt() instead of slice(0,2800)
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const USE_EXCERPT = process.argv.includes("--excerpt");

const { computeDf, retrieve, excerpt } = await import("../lib/retrieve.ts");
const { db } = await import("../lib/db.ts");
const { codePages } = await import("../lib/schema.ts");
const Anthropic = (await import("@anthropic-ai/sdk")).default;

const MODEL = "claude-sonnet-4-6";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Verbatim from the ask route, so the audit exercises the real instructions.
const TOOL_DESC =
  "Search the NEW ZEALAND BUILDING CODE (the free MBIE Acceptable Solutions, Verification Methods, the Code Handbook, and MBIE guidance) and read the matching pages. Call this for any question about what the Building Code REQUIRES or how to comply — clause requirements (B1, C/AS1, E2, G12…), acceptable solutions, minimum dimensions/ratings the code sets, weathertightness, egress, etc. This is the universal code, NOT this project's plans. After it returns, answer from the page text, state that it's general Building-Code guidance (not project-specific), finish with 'Source: <the exact page label>', and remind the user to confirm against the current official document / their designer for anything safety-critical. Never invent a clause number or figure.";

const SYSTEM = `You are Soterra, a construction assistant for a New Zealand site team.

BUILDING-CODE — answer what the NZ Building Code REQUIRES by calling search_code (the free MBIE Acceptable Solutions, Verification Methods, Handbook, guidance). Use this for "what does the code require for…", clause requirements, acceptable solutions, minimum figures, weathertightness, egress, etc. Answer from the returned pages, make clear it's general Building-Code guidance (not this project's plans), finish with "Source: <page label>", and remind them to confirm against the current official document / their designer for anything safety-critical. Never invent a clause or number.`;

// expect: regex the ANSWER must satisfy. gold: regex identifying pages in the
// corpus that authoritatively contain it. Deliberately loose on formatting
// (spaces, units) and strict on the actual figure.
type Q = { id: string; q: string; expect: RegExp; gold: RegExp; note: string };
const QUESTIONS: Q[] = [
  { id: "F4-barrier", q: "What's the minimum barrier height for a deck on a house?",
    expect: /\b1[\s,]?000\s?mm|\b1\.0\s?m\b|\b1\s?m\b/i, gold: /barrier/i, note: "F4 housing barrier 1000mm" },
  { id: "F9-pool", q: "How high does a fence around a residential swimming pool have to be?",
    expect: /\b1[\s,]?200\s?mm|\b1\.2\s?m\b/i, gold: /1200|1\.2\s?m/i, note: "F9 pool barrier 1200mm" },
  { id: "G12-hotwater", q: "What is the maximum hot water temperature allowed at a bath or shower in a house?",
    // NB: corpus-verified. G12/AS1 amendment 14 sets 50°C (45°C for childcare,
    // schools, rest homes) — NOT the 55°C many people remember. Ground truth
    // must come from the corpus, never from recall.
    expect: /\b50\s?°?\s?C\b/i, gold: /50\s?°?\s?C/i, note: "G12/AS1 amd14: 50C personal hygiene, 45C vulnerable" },
  { id: "E2-clearance", q: "What ground clearance do I need under wall cladding to unpaved ground?",
    expect: /\b175\s?mm\b/i, gold: /175\s?mm/i, note: "E2/AS1 175mm unpaved" },
  { id: "E2-paved", q: "What's the minimum cladding clearance above a paved surface?",
    expect: /\b100\s?mm\b/i, gold: /100\s?mm/i, note: "E2/AS1 100mm paved" },
  { id: "D1-stair", q: "What are the maximum rise and minimum going for a private stairway in a house?",
    expect: /\b190\s?mm\b/i, gold: /\b190\b/i, note: "D1/AS1 main private stairway rise 190 max" },
  { id: "D1-ramp", q: "What's the steepest gradient allowed for an accessible ramp?",
    expect: /1\s?[:в]\s?12/i, gold: /1\s?:\s?12/i, note: "D1 accessible ramp 1:12" },
  { id: "B2-durability", q: "How long does structural framing have to last under the durability requirements?",
    expect: /\b50\s?years?\b/i, gold: /50\s?years/i, note: "B2 50 year durability" },
  { id: "G4-ventilation", q: "How much openable window area do I need for natural ventilation in a bedroom?",
    expect: /\b5\s?%/i, gold: /5%|5\s?per\s?cent/i, note: "G4 5% of floor area" },
  { id: "G6-sound", q: "What sound insulation rating is required between two apartments?",
    expect: /\bSTC\b.*\b55\b|\b55\b.*\bSTC\b/i, gold: /STC/i, note: "G6 STC 55 between household units" },
  { id: "F7-alarms", q: "Where do smoke alarms have to go in a house?",
    expect: /\b3\s?m\b|\bbedroom/i, gold: /smoke alarm/i, note: "F7 within 3m of bedroom doors" },
  { id: "E1-surfacewater", q: "What storm event do I design surface water drainage for on a house?",
    expect: /\b10\s?%|\b2\s?%|AEP/i, gold: /AEP/i, note: "E1 10% AEP (2% for habitable)" },
  { id: "H1-roof", q: "What roof insulation R-value do I need for a new house in Auckland?",
    expect: /R\s?-?\s?6\.6|\bR6\.6\b/i, gold: /6\.6/i, note: "H1 6th ed roof R6.6 zone 1-2" },
  { id: "G1-sanitary", q: "How many toilets does a household unit need?",
    expect: /\b1\b|one/i, gold: /sanitary fixture/i, note: "G1 household unit fixtures" },
  { id: "C-escape", q: "What's the maximum open path travel distance for escape in a building?",
    expect: /\b\d{2}\s?m\b/i, gold: /open path/i, note: "C/AS2 open path limits" },
];

type Row = any; type _Row = {
  id: string; goldPages: number; recall: boolean; answered: boolean;
  correct: boolean; cited: boolean; fabricated: string[]; answer: string; retrieved: string[];
};

const rows = await db.select({ doc: codePages.doc, page: codePages.page, npages: codePages.npages, title: codePages.title, text: codePages.text }).from(codePages);
const pages = rows.map((r) => ({ doc: r.doc, page: r.page, npages: r.npages, title: r.title, text: r.text }));
const df = computeDf(pages);
const codeLabel = (p: (typeof pages)[number]) => `${p.doc}${p.title ? " · " + p.title : ""} · page ${p.page} of ${p.npages}`;

console.log(`corpus: ${pages.length} pages | mode: ${USE_EXCERPT ? "excerpt (relevance window)" : "slice(0,2800) [current prod]"}\n`);

const results: Row[] = [];

for (const Q of QUESTIONS) {
  // A. GOLD
  const gold = pages.filter((p) => Q.gold.test(p.text));
  // B. RECALL
  const top = retrieve(pages, df, Q.q, 6);
  const recall = top.some((p) => Q.gold.test(p.text));

  // C. ANSWER — run the real multi-round tool loop. The model often re-searches
  // with a better query after seeing the first hits; cutting it off after one
  // round measures a pipeline that doesn't exist in production.
  const runSearch = (query: string) => {
    const hits = retrieve(pages, df, query, 6);
    if (hits.length === 0) return { hits, payload: JSON.stringify({ pages: [], note: "Nothing matched in the Building Code corpus." }) };
    return {
      hits,
      payload: JSON.stringify({
        pages: hits.map((p) => ({ label: codeLabel(p), text: USE_EXCERPT ? excerpt(p.text, query, 2800) : p.text.slice(0, 2800) })),
      }),
    };
  };

  const messages: any[] = [{ role: "user", content: Q.q }];
  let answer = "";
  const allHanded: string[] = [];
  const queriesUsed: string[] = [];
  let rounds = 0;

  for (; rounds < 10; rounds++) {
    // 10 = MAX_ROUNDS in app/api/ask/route.ts. Keep in sync or the audit
    // measures a stricter pipeline than production.
    const msg: any = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: SYSTEM,
      tools: [{ name: "search_code", description: TOOL_DESC, input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }],
      messages,
    });
    const toolUses = msg.content.filter((c: any) => c.type === "tool_use");
    answer = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    if (toolUses.length === 0) break;
    messages.push({ role: "assistant", content: msg.content });
    const results = toolUses.map((tu: any) => {
      const query = String(tu.input?.query ?? Q.q);
      queriesUsed.push(query);
      const { hits, payload } = runSearch(query);
      allHanded.push(...hits.map((p) => (USE_EXCERPT ? excerpt(p.text, query, 2800) : p.text.slice(0, 2800))));
      return { type: "tool_result", tool_use_id: tu.id, content: payload };
    });
    messages.push({ role: "user", content: results });
  }
  const correct = Q.expect.test(answer);
  const cited = /Source:/i.test(answer);
  const answered = !/couldn'?t find|not (?:in|covered)|doesn'?t (?:appear|cover)|no (?:information|mention)|unable to/i.test(answer);

  // Did a gold page surface in ANY round (the model gets to re-query)?
  const recallAny = allHanded.some((t) => Q.gold.test(t));

  // Fabrication check: any clause-looking token in the answer that appears in
  // NONE of the text the model was actually handed, across all rounds.
  const handed = allHanded.join(" ").toLowerCase();
  const claimTokens = [...new Set(answer.match(/\b[A-H]\d{0,2}\/(?:AS|VM)\d\b/g) || [])];
  const fabricated = claimTokens.filter((t) => !handed.includes(t.toLowerCase()));

  results.push({ id: Q.id, goldPages: gold.length, recall, recallAny, rounds, queriesUsed, answered, correct, cited, fabricated, answer, retrieved: top.map(codeLabel) });

  const flag = !gold.length ? "CORPUS-GAP" : correct ? "OK" : recallAny ? "WRONG" : "RETRIEVAL-MISS";
  console.log(`${flag.padEnd(14)} ${Q.id.padEnd(16)} gold:${String(gold.length).padStart(4)}  recall1:${recall ? "Y" : "n"}  recallAny:${recallAny ? "Y" : "n"}  rounds:${rounds}  correct:${correct ? "Y" : "n"}  cite:${cited ? "Y" : "n"}${fabricated.length ? "  FABRICATED:" + fabricated.join(",") : ""}`);
  if (flag !== "OK") {
    console.log(`   expected: ${Q.note}`);
    console.log(`   queries:  ${queriesUsed.join(" | ")}`);
    console.log(`   answer:   ${answer.replace(/\s+/g, " ").slice(0, 260) || "(empty)"}`);
  }
}

const n = results.length;
const pct = (x: number) => `${Math.round((100 * x) / n)}%`;
console.log(`\n───────── SUMMARY (${USE_EXCERPT ? "excerpt" : "slice"}) ─────────`);
console.log(`corpus has answer : ${results.filter((r) => r.goldPages > 0).length}/${n}  ${pct(results.filter((r) => r.goldPages > 0).length)}`);
console.log(`recall (1st query): ${results.filter((r) => r.recall).length}/${n}  ${pct(results.filter((r) => r.recall).length)}`);
console.log(`recall (any round): ${results.filter((r) => r.recallAny).length}/${n}  ${pct(results.filter((r) => r.recallAny).length)}`);
console.log(`avg tool rounds   : ${(results.reduce((a,r)=>a+r.rounds,0)/n).toFixed(1)}`);
console.log(`answer correct    : ${results.filter((r) => r.correct).length}/${n}  ${pct(results.filter((r) => r.correct).length)}`);
console.log(`cited a source    : ${results.filter((r) => r.cited).length}/${n}  ${pct(results.filter((r) => r.cited).length)}`);
console.log(`FABRICATED clause : ${results.filter((r) => r.fabricated.length).length}/${n}`);
console.log(`declined to answer: ${results.filter((r) => !r.answered).length}/${n}`);

fs.writeFileSync(`dev/audit-code-${USE_EXCERPT ? "excerpt" : "slice"}.json`, JSON.stringify(results, null, 2));
console.log(`\nfull detail -> dev/audit-code-${USE_EXCERPT ? "excerpt" : "slice"}.json`);
