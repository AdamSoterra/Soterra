// Measures Soterra's REAL per-question AI cost by extracting the actual system
// prompt and tool definitions from the ask route and running representative
// questions through the real model with the real prompt-caching setup.
//
// Reads `usage` off the responses rather than estimating, and runs each question
// twice so the second call shows the cache-read path (what steady state costs).
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { computeDf, retrieve, excerpt } = await import("../lib/retrieve.ts");
const { db } = await import("../lib/db.ts");
const { codePages } = await import("../lib/schema.ts");
const Anthropic = (await import("@anthropic-ai/sdk")).default;

const MODEL = "claude-sonnet-4-6";
// Verified pricing, USD per 1M tokens. Cache read ~0.1x input; 5-min cache write 1.25x.
const IN = 3.0, OUT = 15.0, CACHE_READ = 0.30, CACHE_WRITE_5M = 3.75;

const src = fs.readFileSync("app/api/ask/route.ts", "utf8");

// Pull the real system prompt out of the route.
const sysStart = src.indexOf("const STATIC_PROMPT = `") + "const STATIC_PROMPT = `".length;
const sysEnd = src.indexOf("`;", sysStart);
const STATIC_PROMPT = src.slice(sysStart, sysEnd);

// Pull the real tool definitions and eval them (strip the TS annotation first).
const tStart = src.indexOf("const TOOLS");
const tEnd = src.indexOf("\n];", tStart) + 3;
const toolsSrc = src.slice(tStart, tEnd).replace(/const TOOLS[^=]*=/, "return ");
// The tool literals close over module constants; supply them from the same source
// so the extracted definitions match production byte-for-byte.
const KINDS = JSON.parse(
  (src.match(/const KINDS = (\[[^\]]*\])/) ?? [])[1]?.replace(/'/g, '"') ?? '[]'
);
// eslint-disable-next-line no-new-func
const TOOLS = new Function("KINDS", toolsSrc)(KINDS) as any[];

console.log(`extracted system prompt: ${STATIC_PROMPT.length} chars`);
console.log(`extracted tools        : ${TOOLS.length} (${TOOLS.map((t) => t.name).join(", ")})\n`);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const rows = await db.select({ doc: codePages.doc, page: codePages.page, npages: codePages.npages, title: codePages.title, text: codePages.text }).from(codePages);
const pages = rows.map((r) => ({ doc: r.doc, page: r.page, npages: r.npages, title: r.title, text: r.text }));
const df = computeDf(pages);
const label = (p: any) => `${p.doc}${p.title ? " · " + p.title : ""} · page ${p.page} of ${p.npages}`;

// Exact token count of the cached prefix (tools render before system).
const prefix = await anthropic.messages.countTokens({
  model: MODEL,
  system: STATIC_PROMPT,
  tools: TOOLS as any,
  messages: [{ role: "user", content: "x" }],
});
console.log(`cached prefix (tools + system): ${prefix.input_tokens.toLocaleString()} tokens`);
console.log(`  cold write @ $${CACHE_WRITE_5M}/M : $${((prefix.input_tokens / 1e6) * CACHE_WRITE_5M).toFixed(5)}`);
console.log(`  warm read  @ $${CACHE_READ}/M : $${((prefix.input_tokens / 1e6) * CACHE_READ).toFixed(5)}\n`);

// PLAN questions are the core product and cost MORE than code questions:
// search_plans sends 8 pages (route line 511) vs search_code's 6. Measure both.
const planPagesData = JSON.parse(fs.readFileSync("data/arthur-road-index.json", "utf8"));
const planDf = computeDf(planPagesData);

// The route also prepends a dynamic context block (date, upcoming events, tasks,
// crew) that the earlier measurement ignored. Approximate a realistic one so the
// per-question number isn't understated.
const DYNAMIC_CONTEXT = `Today is Monday 21 July 2026, 7:42 am (Pacific/Auckland). Site: Kauri Tower.
Crew: Adam (site manager), Jon (foreman), Maree (PM), Dave (chippie), Sam (apprentice).
Upcoming events: Gib Delivery Sat 18 Jul 12:50pm (whole crew) · Council inspection Tue 22 Jul 9:00am (Adam) · Pour level 3 Wed 23 Jul 7:00am (whole crew) · Scaffold handover Thu 24 Jul 2:00pm (Jon) · Weathertightness review Fri 25 Jul 10:00am (Maree).
Open tasks: Confirm lintel sizes with engineer (Jon, due Tue 22 Jul) · Order H3.2 framing (Adam, due Wed 23 Jul) · Chase RFI 042 response (Maree, overdue) · Book crane for level 4 (Adam, due Fri 25 Jul).`;

const QUESTIONS = [
  "What's the minimum barrier height for a deck on a house?",
  "What ground clearance do I need under wall cladding to unpaved ground?",
  "Draft an RFI about a clash between the midfloor penetration and the beam.",
  "What roof insulation R-value do I need for a new house in Auckland?",
];
const PLAN_QUESTIONS = [
  "What's the external wall cladding build-up on this job?",
  "What insulation R-value is specified for the roof?",
  "What's the foundation slab thickness?",
  "What are the window sizes in the bedrooms?",
];

type Run = { q: string; inTok: number; outTok: number; cacheRead: number; cacheWrite: number; cost: number };
const runs: Run[] = [];

for (const q of QUESTIONS) {
  // Two passes: first primes the cache, second is the steady-state cost.
  for (let pass = 0; pass < 2; pass++) {
    const hits = retrieve(pages, df, q, 6);
    const toolResult = JSON.stringify({ pages: hits.map((p) => ({ label: label(p), text: excerpt(p.text, q, 2800) })) });

    const msg: any = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: [{ type: "text", text: STATIC_PROMPT, cache_control: { type: "ephemeral" } }] as any,
      tools: TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t)) as any,
      messages: [
        { role: "user", content: q },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "search_code", input: { query: q } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: toolResult }] },
      ],
    });

    const u = msg.usage;
    const cost =
      (u.input_tokens / 1e6) * IN +
      (u.output_tokens / 1e6) * OUT +
      ((u.cache_read_input_tokens ?? 0) / 1e6) * CACHE_READ +
      ((u.cache_creation_input_tokens ?? 0) / 1e6) * CACHE_WRITE_5M;

    if (pass === 1) runs.push({ q, inTok: u.input_tokens, outTok: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cost });
    if (pass === 1)
      console.log(
        `$${cost.toFixed(5)}  in:${String(u.input_tokens).padStart(5)}  out:${String(u.output_tokens).padStart(4)}  cacheRead:${String(u.cache_read_input_tokens ?? 0).padStart(6)}  cacheWrite:${String(u.cache_creation_input_tokens ?? 0).padStart(6)}  "${q.slice(0, 46)}"`
      );
  }
}

// ---- PLAN questions: 8 pages + dynamic context, i.e. the real core path ----
const planRuns: Run[] = [];
console.log(`\n--- PLAN questions (8 pages, with dynamic context) ---`);
for (const q of PLAN_QUESTIONS) {
  for (let pass = 0; pass < 2; pass++) {
    const hits = retrieve(planPagesData as any[], planDf, q, 8);
    const toolResult = JSON.stringify({
      pages: hits.map((p: any) => ({ label: `${p.doc}${p.code ? " · " + p.code : ""} · page ${p.page} of ${p.npages}`, text: excerpt(p.text, q, 2800) })),
    });

    const msg: any = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: [
        { type: "text", text: STATIC_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: DYNAMIC_CONTEXT },
      ] as any,
      tools: TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t)) as any,
      messages: [
        { role: "user", content: q },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "search_plans", input: { query: q } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: toolResult }] },
      ],
    });

    const u = msg.usage;
    const cost =
      (u.input_tokens / 1e6) * IN + (u.output_tokens / 1e6) * OUT +
      ((u.cache_read_input_tokens ?? 0) / 1e6) * CACHE_READ +
      ((u.cache_creation_input_tokens ?? 0) / 1e6) * CACHE_WRITE_5M;

    if (pass === 1) {
      planRuns.push({ q, inTok: u.input_tokens, outTok: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cost });
      console.log(`$${cost.toFixed(5)}  in:${String(u.input_tokens).padStart(5)}  out:${String(u.output_tokens).padStart(4)}  cacheRead:${String(u.cache_read_input_tokens ?? 0).padStart(6)}  "${q.slice(0, 42)}"`);
    }
  }
}
const planAvg = planRuns.reduce((a, r) => a + r.cost, 0) / planRuns.length;

const avg = runs.reduce((a, r) => a + r.cost, 0) / runs.length;
const avgOut = runs.reduce((a, r) => a + r.outTok, 0) / runs.length;
const ROUNDS = 1.3; // measured average tool rounds
const blended = (avg + planAvg) / 2;
console.log(`\n───────── STEADY-STATE (warm cache), single round ─────────`);
console.log(`CODE question (6 pages)          : $${avg.toFixed(5)}`);
console.log(`PLAN question (8 pages + context): $${planAvg.toFixed(5)}   <- the core path, ${((planAvg / avg - 1) * 100).toFixed(0)}% more`);
console.log(`blended                          : $${blended.toFixed(5)}`);
console.log(`\nWith the measured ${ROUNDS} avg tool rounds:`);
console.log(`  blended per question : $${(blended * ROUNDS).toFixed(5)} USD  =  NZ$${(blended * ROUNDS * 1.66).toFixed(4)}`);
console.log(`  avg output tokens    : ${Math.round(avgOut)}`);
const real = blended * ROUNDS * 1.66;
for (const n of [110, 264, 528, 1650]) {
  console.log(`  ${String(n).padStart(5)} q/mo -> NZ$${(real * n).toFixed(2)}/mo`);
}
