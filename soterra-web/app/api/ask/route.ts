import { readFileSync } from "fs";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

// ── The project's plan/spec text index (built from the real PDFs by the
//    prototype). One row per page. For the demo this is 1 Arthur Road;
//    in production each project's index comes from its own uploads. ──
type Page = {
  doc: string; disc: string; file: string; page: number; npages: number;
  code: string; title: string; text: string;
};

let INDEX: Page[] | null = null;
function getIndex(): Page[] {
  if (!INDEX) {
    const p = join(process.cwd(), "data", "arthur-road-index.json");
    INDEX = JSON.parse(readFileSync(p, "utf-8")) as Page[];
  }
  return INDEX;
}

// ── Retrieval: TF-IDF over the extracted text. idf kills the title-block
//    boilerplate printed on every sheet; synonyms map plain English to
//    plan terminology. (Ported from prototype/ask_plans.py.) ──
const SYN: Record<string, string[]> = {
  colour: ["color", "paint", "finish", "resene", "dulux", "schedule"],
  color: ["colour", "paint", "finish", "resene", "dulux", "schedule"],
  paint: ["colour", "resene", "dulux", "finish"],
  fire: ["frr", "fire-rated", "rated", "fhr"],
  rating: ["frr", "fire", "rated"],
  beam: ["lintel", "lvl", "span", "portal", "header", "steel"],
  lintel: ["beam", "lvl", "span", "header"],
  garage: ["carport", "basement", "ground"],
  wall: ["partition", "gib", "plasterboard", "lining", "intertenancy"],
  insulation: ["r-value", "thermal", "batts", "pink"],
  window: ["glazing", "glazed", "joinery"],
  corridor: ["lobby", "circulation", "common"],
};

function expand(q: string): string[] {
  const terms = (q.toLowerCase().match(/[a-z0-9-]+/g) || []).filter((t) => t.length > 1);
  const out = new Set(terms);
  for (const t of terms) for (const s of SYN[t] || []) out.add(s);
  return [...out];
}

let DF: Map<string, number> | null = null;
function getDf(index: Page[]): Map<string, number> {
  if (!DF) {
    DF = new Map();
    for (const p of index) {
      const seen = new Set(p.text.toLowerCase().match(/[a-z0-9-]{2,}/g) || []);
      for (const t of seen) DF.set(t, (DF.get(t) || 0) + 1);
    }
  }
  return DF;
}

function retrieve(index: Page[], q: string, k = 6): Page[] {
  const terms = expand(q);
  const df = getDf(index);
  const N = index.length;
  const idf = (t: string) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  const scored = index
    .map((p) => {
      const low = p.text.toLowerCase();
      let s = 0;
      for (const t of terms) {
        const c = (low.match(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")) || []).length;
        if (c) s += (1 + Math.log(c)) * idf(t);
      }
      return { s, p };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => x.p);
}

function label(p: Page): string {
  const bits = [p.doc];
  if (p.code) bits.push(p.code);
  if (p.title) bits.push(p.title);
  return bits.join(" · ") + ` · page ${p.page} of ${p.npages}`;
}

const SYS = `You are Soterra's plan-reader for the project '1 Arthur Road'. Answer the site team's question USING ONLY the attached plan/spec page texts (each is labelled).
Rules:
- Specific and concise (1-4 sentences). Talk like a helpful site engineer.
- ALWAYS finish with a line: 'Source: <label of the page you used>'. Cite the exact sheet/page.
- A finish/material may need a CODE from a schedule (drawings) + its product from the spec — connect them.
- If the pages don't contain the answer, say what's missing. NEVER invent codes, ratings, products or numbers.`;

export async function POST(req: Request) {
  let question = "";
  try {
    ({ question } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  question = (question || "").trim();
  if (!question) return Response.json({ error: "Empty question" }, { status: 400 });

  const index = getIndex();
  const top = retrieve(index, question, 6);

  if (top.length === 0) {
    return Response.json({
      answer:
        "I couldn't find anything about that in this project's plans. Try rephrasing, or it may be on a drawing set that hasn't been uploaded.",
      sources: [],
    });
  }

  const content: Anthropic.MessageParam["content"] = [
    ...top.map((p) => ({
      type: "text" as const,
      text: `[PAGE: ${label(p)}]\n${p.text.slice(0, 2800)}`,
    })),
    { type: "text" as const, text: `Question: ${question}` },
  ];

  try {
    const anthropic = new Anthropic();
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: SYS,
      messages: [{ role: "user", content }],
    });
    const answer = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return Response.json({
      answer,
      sources: top.map((p) => ({ doc: p.doc, page: p.page, npages: p.npages, code: p.code, title: p.title })),
    });
  } catch (e) {
    console.error("ask error:", e);
    return Response.json({ error: "The assistant is busy — try again in a moment." }, { status: 503 });
  }
}
