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

const QUESTIONS = [
  "What's the minimum barrier height for a deck on a house?",
  "What ground clearance do I need under wall cladding to unpaved ground?",
  "Draft an RFI about a clash between the midfloor penetration and the beam.",
  "What roof insulation R-value do I need for a new house in Auckland?",
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

const avg = runs.reduce((a, r) => a + r.cost, 0) / runs.length;
const avgOut = runs.reduce((a, r) => a + r.outTok, 0) / runs.length;
console.log(`\n───────── STEADY-STATE (warm cache) ─────────`);
console.log(`avg cost per question : $${avg.toFixed(5)}  (NZD ~$${(avg * 1.66).toFixed(5)})`);
console.log(`avg output tokens     : ${Math.round(avgOut)}`);
console.log(`\nper 1,000 questions   : $${(avg * 1000).toFixed(2)} USD  /  ~$${(avg * 1000 * 1.66).toFixed(2)} NZD`);
for (const n of [200, 500, 1000, 3000]) {
  console.log(`  ${String(n).padStart(5)} q/mo -> $${(avg * n).toFixed(2)} USD/mo  (~$${(avg * n * 1.66).toFixed(2)} NZD/mo)`);
}
