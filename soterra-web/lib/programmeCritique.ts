import Anthropic from "@anthropic-ai/sdk";
import type { Scope } from "./company";
import { getProjectIndex, type Page } from "./projectIndex";
import { getCodeIndex, codeLabel } from "./codeIndex";
import { excerpt, retrieve } from "./retrieve";
import { orderForPrompt } from "./inspectionOrder";

// ─── The programme critique engine ───────────────────────────────────────
//
// Third instance of the same "gather project context → one structured LLM call
// → cited structured output" shape that powers the QA-checklist generator
// (lib/checklist.ts) and the inspection extractor (lib/inspectionExtract.ts).
// The subject here is the whole construction PROGRAMME (build schedule / Gantt),
// read VISUALLY as a native document block — programmes are usually wide Gantts
// exported as images or thin-text vector, so the text indexer (lib/indexPdf.ts,
// no OCR) can't be trusted with them. We hand the PDF straight to Claude.
//
// It critiques the programme against the job on exactly four axes:
//   missing_scope        — work the plans/spec/scope require, with no task for it
//   out_of_sequence      — two tasks ordered against how the work must be built
//                          or against the council inspection order
//   unrealistic_duration — a duration that can't be right for the quantity shown
//   missing_hold_point   — a required council inspection absent where it must be
//
// Same discipline as the checklist engine: every finding must cite a plan/Code
// page label or a named inspection-order rule, or it is dropped. A fabricated
// critique point is worse than a missing one.

const MODEL = "claude-opus-4-8";

export type BuildType = "residential" | "commercial" | "unknown";

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding_type: { type: "string", enum: ["missing_scope", "out_of_sequence", "unrealistic_duration", "missing_hold_point"] },
          activity: { type: "string", description: "The programme task/line this finding points at, copied as close to verbatim as you can. Use \"—\" when the issue is an ABSENCE (a task or inspection that should exist but doesn't)." },
          title: { type: "string", description: "The problem in under 14 words, thing-first: \"No wrap-and-cavity inspection before cladding starts\"." },
          detail: { type: "string", description: "What is wrong and what it should be, WITH the programme's own figure where relevant, e.g. \"Programme allows 3 days for 240m2 of GIB Fyreline across L1-L3\". One or two sentences." },
          severity: { type: "string", enum: ["high", "medium", "low"], description: "high = build-impossible sequence or a missed council hold-point; low = cosmetic or minor." },
          source: { type: "string", enum: ["plans", "spec", "scope", "code", "sequence"], description: "\"sequence\" = the encoded Auckland inspection order / hold-point rule you were given." },
          source_ref: { type: "string", description: "The EXACT plan/spec/Code page label copied verbatim, OR the named inspection-order rule (e.g. \"Auckland Council AC1229 V13 — pre-line building cannot be approved until pre-line plumbing has been completed\"). If you cannot cite a basis, DO NOT include the finding." },
        },
        required: ["finding_type", "activity", "title", "detail", "severity", "source", "source_ref"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
} as const;

const GEN_SYSTEM = `You review a New Zealand construction PROGRAMME (build schedule / Gantt) the way an experienced main-contractor planner or project manager checks a programme before it is accepted. You are given the programme itself — read every task, its order and its duration — plus the project's own documents and the council inspection order. Your job is to CRITIQUE the programme against the job, not to rewrite it.

You are given, alongside the programme:
1. THE PROJECT'S SCOPE, SPECIFICATION AND DRAWINGS — pages from this site's own documents. Use these to find work the job clearly requires but the programme has NO task for (missing scope), and to sanity-check that the sequence matches how the building is actually detailed.
2. THE NZ BUILDING CODE — for duration and requirement sense-checks only.
3. THE AUCKLAND COUNCIL INSPECTION ORDER and its HARD DEPENDENCIES (given below, verbatim). This is your authority for out-of-order work and missing inspection hold-points. Slab cannot be approved until slab plumbing is done; pre-line building cannot be approved until pre-line plumbing is done; on COMMERCIAL jobs membranes must be approved before cladding. The council inspections themselves (footing, framing, wrap-and-cavity, pre-line, post-line, waterproofing, final) are hold-points that MUST appear in the programme between the trades they gate — flag them when they are absent or placed wrong.

FLAG ONLY FOUR THINGS, each as a typed finding:
- missing_scope: work the plans/spec/scope require that the programme has no task for.
- out_of_sequence: two tasks whose order contradicts how the work must be built, or the council inspection order (e.g. cladding before the wrap-and-cavity inspection; linings before the pre-line inspection).
- unrealistic_duration: a duration that cannot be right for the quantity/scope shown — state the programme's own figure and why.
- missing_hold_point: a required council inspection that does not appear in the programme where it must.

RULES
- EVERY finding must be traceable. Point at the exact programme task it concerns (the activity), AND cite the plan/spec page label, Code page label, or the named inspection-order rule that makes it a problem. Copy page labels exactly as given. If you cannot cite a basis, DO NOT include the finding — an invented critique point is worse than a missing one.
- Never invent a task, a duration, a clause or a page label. If the programme is unreadable in part, say so and critique only what you can read.
- This is AUCKLAND's inspection order and its residential/commercial split. Do not assert it as universal; if the job is clearly another region, hedge the hold-point findings accordingly.
- Respect the source order of precedence: a contract instruction or answered RFI outranks the drawings; the specification and drawings carry equal authority. Do not flag as "missing scope" something a later instruction removed.
- Be ruthless and specific. 8 to 20 findings is plenty; a wall of generic observations is a failure. Lead with high-severity findings (a missed hold-point or a build-impossible sequence) over cosmetic ones.
- If the project documents are thin or absent, still critique the programme's internal sequence and its inspection hold-points against the council order — but do not invent scope you cannot see.`;

export type CritiqueFinding = { findingType: string; activity: string; title: string; detail: string; severity: string; source: string; sourceRef: string | null };
export type ProgrammeResult =
  | { ok: true; findings: CritiqueFinding[] }
  // "empty" = the programme + docs genuinely produced nothing to flag. "failed"
  // = the assistant couldn't be reached. Kept apart so "we couldn't read your
  // programme" never shows during an API outage.
  | { ok: false; reason: "empty" | "failed"; message: string };

const CTX_BUDGET = 90000; // chars of project context sent alongside the programme PDF
const MAX_PDF_BYTES = 30 * 1024 * 1024; // Anthropic's document-block ceiling is ~32MB

const planLabel = (p: Page) => [p.doc, p.code, p.title].filter(Boolean).join(" · ") + ` · page ${p.page} of ${p.npages}`;

/** Join labelled pages (full text) until a char budget is spent. */
function joinPages(pages: Page[], budget: number): string {
  const out: string[] = [];
  let spent = 0;
  for (const p of pages) {
    if (spent >= budget) break;
    const room = budget - spent;
    const body = p.text.length > room ? p.text.slice(0, room) + " …[truncated]" : p.text;
    const block = `--- PAGE LABEL: ${planLabel(p)}\n${body}`;
    out.push(block);
    spent += block.length;
  }
  return out.join("\n\n");
}

export async function generateProgrammeCritique(
  scope: Scope,
  opts: { pdfBytes: Uint8Array; filename: string; buildType: BuildType }
): Promise<ProgrammeResult> {
  if (opts.pdfBytes.length > MAX_PDF_BYTES) {
    return { ok: false, reason: "empty", message: "That programme file is too large to read in one pass. Export it as a PDF (a few pages) and try again." };
  }

  const [projectIdx, codeIdx] = await Promise.all([getProjectIndex(scope.projectId), getCodeIndex()]);

  // The programme is the SUBJECT (read whole, as a document block). Everything
  // else is CONTEXT it's measured against — and the programme's own pages must
  // never be in that context pool.
  const design = projectIdx.pages.filter((p) => p.docType !== "programme");
  const scopeSpec = design.filter((p) => p.docType === "scopes" || p.docType === "specs");
  const drawings = design.filter((p) => p.docType === "drawings" || p.docType === "reports" || p.docType === "other");

  // A build touches every trade, so a broad cross-trade query gives representative
  // coverage of a large drawing set rather than one corner of it.
  const broad = "foundation footing slab reinforcing framing roof truss cladding wrap cavity flashing waterproofing membrane lining insulation services drainage plumbing electrical mechanical fire finishes";

  // Scope + spec first (the authority for "missing scope"), full text to budget;
  // then representative drawing/report detail to fill what's left.
  const scopeSpecText = joinPages(scopeSpec, Math.floor(CTX_BUDGET * 0.55));
  const drawingHits = retrieve(drawings, projectIdx.df, broad, 12);
  const drawingText = drawingHits.map((p) => `--- PAGE LABEL: ${planLabel(p as Page)}\n${excerpt(p.text, broad, 1800)}`).join("\n\n");
  const codeHits = retrieve(codeIdx.pages, codeIdx.df, broad, 4);
  const codeText = codeHits.map((p) => `--- PAGE LABEL: ${codeLabel(p)}\n${excerpt(p.text, broad, 1500)}`).join("\n\n");

  // A compact index of every design sheet, so the model sees the FULL extent of
  // the job (to spot missing scope) even where a sheet's text wasn't retrieved.
  const sheetList = [...new Set(design.map((p) => [p.doc, p.code, p.title].filter(Boolean).join(" · ")))].slice(0, 200).join("\n");

  const hasContext = scopeSpec.length > 0 || drawings.length > 0;

  const context = [
    `BUILD TYPE: ${opts.buildType}${opts.buildType === "unknown" ? " (infer from the documents; if you can't tell, hedge any residential/commercial-specific hold-point findings)" : ""}`,
    orderForPrompt(),
    sheetList ? `EVERY DESIGN SHEET ON THIS JOB (labels only — the full extent of the work to check the programme covers):\n${sheetList}` : "",
    scopeSpecText ? `PROJECT SCOPE & SPECIFICATION (cite these page labels verbatim):\n${scopeSpecText}` : "PROJECT SCOPE & SPECIFICATION\n(no scope or specification uploaded for this site — do not invent scope you cannot see)",
    drawingText ? `PROJECT DRAWINGS / REPORTS (cite these page labels verbatim):\n${drawingText}` : "",
    codeText ? `NZ BUILDING CODE (for duration / requirement sense-checks):\n${codeText}` : "",
  ].filter(Boolean).join("\n\n════════\n\n");

  const anthropic = new Anthropic({ maxRetries: 2 });
  try {
    // STREAMED, like lib/inspectionExtract.ts: the SDK refuses a non-streaming
    // request whose worst-case duration could pass 10 minutes (derived from
    // max_tokens), and a truncated register must be caught, not parsed.
    const resp = await anthropic.messages
      .stream({
        model: MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: FINDINGS_SCHEMA as unknown as Record<string, unknown> } },
        system: GEN_SYSTEM,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(opts.pdfBytes).toString("base64") } },
            { type: "text", text: `Critique this construction programme against the job.\nFilename: ${opts.filename}\n\n${context}` },
          ],
        }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .finalMessage();
    if (resp.stop_reason === "max_tokens") throw new Error("response hit the token ceiling");

    const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(text) as { findings?: Record<string, unknown>[] };
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const findings: CritiqueFinding[] = (Array.isArray(parsed.findings) ? parsed.findings : [])
      .map((r) => ({
        findingType: ["missing_scope", "out_of_sequence", "unrealistic_duration", "missing_hold_point"].includes(String(r.finding_type)) ? String(r.finding_type) : "missing_scope",
        activity: String(r.activity ?? "").trim(),
        title: String(r.title ?? "").trim(),
        detail: String(r.detail ?? "").trim(),
        severity: ["high", "medium", "low"].includes(String(r.severity)) ? String(r.severity) : "medium",
        source: ["plans", "spec", "scope", "code", "sequence"].includes(String(r.source)) ? String(r.source) : "sequence",
        sourceRef: String(r.source_ref ?? "").trim() || null,
      }))
      // Drop anything the model couldn't cite — same discipline as the checklist
      // engine. An uncited critique point is a guess.
      .filter((f) => f.title.length > 2 && f.sourceRef)
      .sort((a, b) => (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1));

    if (!findings.length) {
      return {
        ok: false,
        reason: "empty",
        message: hasContext
          ? "Nothing solid enough to flag came out of the programme against this job's documents. Either the programme is sound on these axes, or it couldn't be read clearly — check it exported as a readable PDF."
          : "This site has no scope, specs or drawings uploaded, so there's little to check the programme against beyond the inspection order. Upload the project documents for a fuller critique.",
      };
    }
    return { ok: true, findings };
  } catch (e) {
    console.error("programme critique failed:", e);
    const msg = e instanceof Anthropic.APIError && e.status === 400 && /credit balance/i.test(String(e.message))
      ? "The assistant is out of credit — top up the Anthropic account and this will work again."
      : "The assistant couldn't be reached just now. Give it a moment and try again.";
    return { ok: false, reason: "failed", message: msg };
  }
}
