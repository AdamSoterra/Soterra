import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { trialUsage } from "@/lib/schema";
import { excerpt, retrieve, searchManufacturerPages } from "@/lib/retrieve";
import { codeLabel, getCodeIndex } from "@/lib/codeIndex";
import { determinationLabel, searchDeterminations } from "@/lib/determinations";
import { resolveStandard } from "@/lib/standards";
import { demoPagesFor } from "@/lib/standardDemo";
import { canSeeStandardsDemo, getManufacturerIndex, manufacturerLabel, visibleTo } from "@/lib/manufacturerIndex";
import { listUserProjects } from "@/lib/project";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/trial-ask   { question, history?: [{ role: "user"|"assistant", text }] }
//
// The free look-around mode: a signed-in user with NO site gets the assistant
// on BASE knowledge only — Building Code, NZ Standards handling, MBIE
// determinations, manufacturer literature, general expertise. No plans, no
// history, no generators; 5 questions LIFETIME per user, then the wall.
//
// Deliberately its own route rather than a branch of /api/ask: the paid route
// is built around a verified project Scope on every code path, and the safest
// way to keep that invariant is to never run it without one. Threads stay out
// of the DB too — the client carries the short conversation itself, so a trial
// user's entire footprint is one trial_usage row (and at most one lead).

const MODEL = "claude-sonnet-4-6";
const TRIAL_LIMIT = 5;
const MAX_ROUNDS = 5;

type Card = Record<string, unknown>;

// The four BASE tools, definitions copied verbatim from /api/ask so the model
// behaves identically on the knowledge the two routes share.
const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_code",
    description:
      "Search the NEW ZEALAND BUILDING CODE (the free MBIE Acceptable Solutions, Verification Methods, the Code Handbook, and MBIE guidance) and read the matching pages. Call this for any question about what the Building Code REQUIRES or how to comply — clause requirements (B1, C/AS1, E2, G12…), acceptable solutions, minimum dimensions/ratings the code sets, weathertightness, egress, etc. This is the universal code, NOT a project's plans. After it returns, answer from the page text, state that it's general Building-Code guidance (not project-specific), finish with 'Source: <the exact page label>', and remind the user to confirm against the current official document / their designer for anything safety-critical. Never invent a clause number or figure.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "The code question in plain English (e.g. 'minimum stair riser height', 'E2 cavity requirement for direct-fixed cladding')." } },
      required: ["query"],
    },
  },
  {
    name: "standards_handoff",
    description:
      "Show the user EXACTLY where to get a figure that lives in an NZ Standard we are not licensed to reproduce. Call this at the END of an answer whenever the real number sits in an NZS (lintel and bracing sizes in NZS 3604, corrosion protection / which fixings a coastal or sea-spray zone needs in NZS 3604, minimum concrete cover to reinforcing in NZS 3604, safety-glass thresholds in NZS 4223.3, smoke alarm positions in NZS 4514, pool barriers in NZS 8500, insulation R-values in NZS 4218, seismic restraint in NZS 4219, and so on). Call it AS SOON AS you have identified the standard, BEFORE you commit to your final wording, because its result tells you how to answer: it returns no answer text and you give the plain qualitative answer plus this card. It renders a card with the standard, edition, section and a FREE download link. Do NOT describe the card or repeat the link. Pass the standard as the Code cites it ('NZS 3604:2011'), the section or table if you genuinely know it from the Code's own reference (do not guess a table number), and one plain line naming what the standard holds.",
    input_schema: {
      type: "object",
      properties: {
        standard: { type: "string", description: "The standard as cited, e.g. 'NZS 3604:2011' or 'NZS 4223.3'." },
        section: { type: "string", description: "Section/part to open if known from the Code's own reference, e.g. 'Section 8, Walls'. Omit rather than guess." },
        holds: { type: "string", description: "One line: what the standard holds that the Code does not, e.g. 'the lintel member size and grade for your span, loaded dimension and wind zone'." },
      },
      required: ["standard", "holds"],
    },
  },
  {
    name: "search_determinations",
    description:
      "Search MBIE DETERMINATIONS — MBIE's binding rulings on real disputes between a building owner and a council, 2019 onwards. This is the only public record of how the Building Code actually gets applied when someone argues about it, so call it when the question is about a DISAGREEMENT or a JUDGEMENT CALL rather than a plain requirement: 'the council failed us on X, are they right?', 'can they refuse a code compliance certificate for this?', 'has MBIE ruled on whether this counts as compliant?', 'what did MBIE decide about pool barriers / weathertightness / a dangerous building notice?', 'is the council allowed to ask for that?'. Also use it when the Code text is silent or ambiguous and the user needs to know how the boundary has been decided before. Prefer search_code for what the Code plainly REQUIRES; use this for how it was INTERPRETED. TWO RULES YOU MUST FOLLOW when you answer from it: (1) always name the determination WITH its year, e.g. 'Determination 2024/001', because a ruling can rest on an Acceptable Solution that has since changed; (2) a determination decides ONE case on ITS OWN facts, so present it as guidance on how MBIE reasoned, NEVER as the rule itself, and for any actual figure or clause requirement defer to the current Acceptable Solution (search_code). Finish with 'Source: <the exact label returned>'. Never state a finding this tool did not return.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The dispute or interpretation question in plain English (e.g. 'pool barrier close to boundary F9', 'refusal to issue code compliance certificate for weathertightness', 'dangerous building notice')." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_manufacturer",
    description:
      "Search MANUFACTURERS' OWN technical literature — the installation manuals, system manuals, specification guides, technical data sheets and site guides published by the makers of the products actually being installed. Call this for anything product-specific: how a named system must be built, fixing types and centres, sheet layout and handling, fire and acoustic system numbers, bracing systems, wet-area details. This answers 'how does the MAKER say to install it', which is a different question from what the Code requires (search_code). Prefer this over search_code whenever the question names a product or a proprietary system, because the manufacturer's requirement is often stricter than the Code minimum and it is the manufacturer's requirement that governs the warranty. IMPORTANT: this material is used under permission from the manufacturer, so you MUST finish with 'Source: <the exact page label>' and include the document link when one is returned. Never state a figure this tool did not return, and never blend two manufacturers' figures into one answer.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The product question (e.g. 'GIB Aqualine fixing centres in a wet area', 'intertenancy barrier system for terrace homes')." },
      },
      required: ["query"],
    },
  },
];

const SYSTEM = `You are Soterra, an AI assistant for New Zealand construction, in FREE LOOK-AROUND mode: the user is trying you out and has no site set up, so you have NO project drawings, NO specs and NO inspection history — only your base sources and general expertise. You get at most ${TRIAL_LIMIT} questions with this user, so make every answer count.

YOUR SOURCES, in order of use:
1. search_manufacturer — whenever a product or proprietary system is named; the maker's requirement governs the warranty.
2. search_code — what the NZ Building Code requires.
3. standards_handoff — when the real figure lives inside an NZ Standard; give the qualitative answer and let the card point them to the source.
4. search_determinations — how MBIE has ruled when people disagreed.
5. General NZ construction knowledge for practical trade questions — say when you're speaking from general knowledge rather than a source.

CITATIONS: when you answer from a tool result, end with one line per source: 'Source: <the exact label the tool returned>' — copy labels verbatim, never invent one. Never state a clause number or figure a tool did not return.

HONESTY RULES: NZ context always (NZBC, NZS, LBP, council inspections, CCC). Be direct and practical, a builder is asking from a site. For anything safety-critical, tell them to confirm with their designer or engineer. If you don't know, say so.

THE PITCH, used sparingly and honestly: when a question is really about THEIR job — their spans, their details, their spec, their inspection history — answer as far as your base sources allow, then note in ONE short sentence that with their site set up, Soterra reads their own drawings and answers this against them. Never more than one such sentence per answer, never salesy, and skip it entirely when the base answer fully covers the question.`;

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

async function executeTool(name: string, input: Record<string, unknown>, userId: string): Promise<{ content: string; cards: Card[] }> {
  try {
    switch (name) {
      case "search_code": {
        const q = s(input.query) ?? "";
        if (!q) return { content: JSON.stringify({ error: "query required" }), cards: [] };
        const { pages, df } = await getCodeIndex();
        if (pages.length === 0) return { content: JSON.stringify({ pages: [], note: "The Building Code index isn't loaded yet." }), cards: [] };
        const top = retrieve(pages, df, q, 6);
        if (top.length === 0) return { content: JSON.stringify({ pages: [], note: "Nothing matched in the Building Code corpus." }), cards: [] };
        return { content: JSON.stringify({ pages: top.map((p) => ({ label: codeLabel(p), text: excerpt(p.text, q, 2800) })) }), cards: [] };
      }
      case "standards_handoff": {
        const name_ = s(input.standard) ?? "";
        const holds = s(input.holds) ?? "";
        const section = s(input.section) ?? null;
        const std = resolveStandard(name_);
        if (!std) {
          return {
            content: JSON.stringify({
              ok: false,
              note: `We hold no verified record of "${name_}", so no card was shown. Name the standard in your text and say it is cited by the Code, but do NOT state an edition, a link, or any figure from it.`,
            }),
            cards: [],
          };
        }
        // Trial users are never in the demo-corpus allowlist, but the gate is
        // the account list, not the mode — keep the check identical to /api/ask.
        const demo = canSeeStandardsDemo(userId) ? demoPagesFor(std.ref, `${holds} ${section ?? ""} ${name_}`) : null;
        return {
          content: JSON.stringify(
            demo?.answer
              ? {
                  ok: true,
                  answer: demo.answer,
                  instruction: `State the answer above in full, with its figures, then cite it as "Source: ${std.ref}". Lead straight with the answer exactly as you would from any other source. Do not present it as generally available and do not repeat the link or edition; the card already shows the page.`,
                }
              : {
                  ok: true,
                  shown: `A card points the user to ${std.ref} (${std.title}), free to download. Give the plain qualitative answer only; do NOT state a precise figure from inside the standard, and do not repeat the link or edition.`,
                }
          ),
          cards: [{
            id: std.ref,
            itemType: "standard",
            action: "created",
            title: std.ref,
            when: std.title,
            sub: std.clauses.join(", "),
            kind: null,
            visibility: "team",
            std: { ref: std.ref, title: std.title, section, holds, url: std.url, ...(demo ? { demo } : {}) },
          }],
        };
      }
      case "search_determinations": {
        const q = s(input.query) ?? "";
        if (!q) return { content: JSON.stringify({ error: "query required" }), cards: [] };
        const hits = await searchDeterminations(q, { limit: 6 });
        if (hits.length === 0) return { content: JSON.stringify({ determinations: [], note: "No determination matched. Say so rather than guessing at how MBIE would rule." }), cards: [] };
        return {
          content: JSON.stringify({
            note: "Each result is ONE ruling on ONE dispute. Cite it with its year (e.g. 'Determination 2024/001') and present it as how MBIE reasoned, not as the rule. For any figure or clause requirement, defer to the current Acceptable Solution via search_code.",
            determinations: hits.map((d) => ({ label: determinationLabel(d), ref: d.ref, year: d.year, subject: d.subject, text: excerpt(d.text, q, 2800) })),
          }),
          cards: [],
        };
      }
      case "search_manufacturer": {
        const q = s(input.query) ?? "";
        if (!q) return { content: JSON.stringify({ error: "query required" }), cards: [] };
        const { pages: allPages, df } = await getManufacturerIndex();
        const pages = visibleTo(allPages, userId);
        if (pages.length === 0) return { content: JSON.stringify({ pages: [], note: "No manufacturer literature is loaded yet." }), cards: [] };
        const top = searchManufacturerPages(pages, df, q, 8, allPages.length);
        if (top.length === 0) return { content: JSON.stringify({ pages: [], note: "Nothing matched in the manufacturer literature we hold." }), cards: [] };
        return {
          content: JSON.stringify({
            note: "This is the manufacturer's own published literature, used with permission. Answer ONLY from these pages — if the specific figure, spec, limit, system or yes/no compliance claim being asked for is NOT on a page here, say plainly it is not in the manual we hold; do NOT supply it from general knowledge, and do NOT stitch a system spec from a partial excerpt. Quote only what you need. End your answer with exactly one line: 'Source: <the exact label>' — copy the label verbatim, including the manufacturer, document name and 'page N of M'. Do NOT paste the document URL; the app adds the in-app page view and the verify link from that label.",
            pages: top.map((p) => ({ label: manufacturerLabel(p), link: p.sourceUrl, text: excerpt(p.text, q, 2800) })),
          }),
          cards: [],
        };
      }
      default:
        return { content: JSON.stringify({ error: `unknown tool ${name}` }), cards: [] };
    }
  } catch (e) {
    console.error(`trial tool ${name} failed:`, e);
    return { content: JSON.stringify({ error: "tool failed - answer from what you have and say what you couldn't check" }), cards: [] };
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  // The trial is only for users with no site. Anyone with a membership has the
  // real assistant; don't let the same account run a parallel free meter.
  const memberships = await listUserProjects(userId);
  if (memberships.length > 0) return Response.json({ error: "You already have a site - ask from the app." }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const question = String(body.question ?? "").trim().slice(0, 4000);
  if (!question) return Response.json({ error: "Ask a question" }, { status: 400 });
  const rawHistory = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const history = rawHistory
    .map((h) => ({
      role: (h as Record<string, unknown>)?.role === "assistant" ? ("assistant" as const) : ("user" as const),
      text: String((h as Record<string, unknown>)?.text ?? "").slice(0, 6000),
    }))
    .filter((h) => h.text.trim());

  // Count the question up front, race-safely; a model failure refunds it below.
  const [usage] = await db
    .insert(trialUsage)
    .values({ userId, count: 1, updatedAt: new Date() })
    .onConflictDoUpdate({ target: trialUsage.userId, set: { count: sql`${trialUsage.count} + 1`, updatedAt: new Date() } })
    .returning({ count: trialUsage.count });
  if (usage.count > TRIAL_LIMIT) {
    // Don't let the wall itself inflate the counter forever. LEAST, not a
    // literal: a literal write could race a concurrent refund and re-eat a
    // question that was just given back.
    await db.update(trialUsage).set({ count: sql`LEAST(${trialUsage.count}, ${TRIAL_LIMIT + 1})` }).where(sql`${trialUsage.userId} = ${userId}`);
    return Response.json({ walled: true, used: TRIAL_LIMIT, limit: TRIAL_LIMIT });
  }

  const refund = async () => {
    try {
      await db.update(trialUsage).set({ count: sql`GREATEST(${trialUsage.count} - 1, 0)` }).where(sql`${trialUsage.userId} = ${userId}`);
    } catch { /* the refund is best-effort */ }
  };

  const anthropic = new Anthropic({ maxRetries: 2 });
  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.text })),
    { role: "user" as const, content: question },
  ];

  const cards: Card[] = [];
  let answer = "";
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM,
        tools: TOOLS,
        messages,
      });
      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      if (toolUses.length === 0 || resp.stop_reason !== "tool_use") {
        answer = text;
        break;
      }
      messages.push({ role: "assistant", content: resp.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const out = await executeTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, userId);
        cards.push(...out.cards);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out.content });
      }
      messages.push({ role: "user", content: results });
      if (round === MAX_ROUNDS - 1) answer = text || "I ran out of room to finish that one - ask it again a little more specifically.";
    }
  } catch (e) {
    console.error("trial-ask model call failed:", e);
    await refund();
    return Response.json({ error: "The assistant couldn't be reached just now - that question wasn't counted. Try again in a minute." }, { status: 502 });
  }

  if (!answer.trim()) {
    await refund();
    return Response.json({ error: "The assistant came back empty - that question wasn't counted. Try again." }, { status: 502 });
  }

  return Response.json({ answer, cards, used: usage.count, limit: TRIAL_LIMIT });
}
