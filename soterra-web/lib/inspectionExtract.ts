import Anthropic from "@anthropic-ai/sdk";
import { anonymiseField, anonymiseText } from "./anonymise";
import { CATEGORIES, classify, codeName, inspectionType, type Category } from "./categories";

// ─── The history learner ─────────────────────────────────────────────────
//
// Inspection report PDF text in → FAILED items only, out. This is the old
// `api/analyze-reports.py` ("The Brain") cut down to the one thing that turned
// out to matter: not a million line items, but "what did we actually get
// pulled up on, and what kind of thing was it".
//
// Two passes, deliberately:
//   1. A deterministic parse of the council's own checklist table. Council
//      reports print "Inspection Summary … Comments 1. <item> ( Fail )", which
//      is exact — no model needed, and it can never be missed.
//   2. A model pass over the whole (anonymised) document, which is the only
//      way to read the free-text sections. On a "Partial Pass" the checklist
//      Comments block is empty and every real defect lives in prose under
//      "ITEMS TO BE RESOLVED" — that's most of Adam's 27 reports.
// The two are merged and de-duplicated, so the deterministic floor holds even
// if the model is having an off day.

// Opus for this path, not the Sonnet the chat assistant runs on: extraction
// happens once per uploaded report (not once per question), it is the input to
// every count on the Insights page, and a miss here is invisible — it just
// shows up as a category that looks cleaner than it is.
const MODEL = "claude-opus-4-8";

export type ExtractedItem = {
  title: string;
  detail: string | null;
  location: string | null;
  category: Category;
  categoryBy: "rule" | "model" | "code" | "fallback";
};

export type ExtractedInspection = {
  /** False when the document isn't an inspection report at all (a fee proposal,
   *  a spec). The caller refuses it rather than filing an empty inspection. */
  isInspectionReport: boolean;
  /** True when the model pass failed and only the deterministic parse ran. The
   *  row is still usable, but on a Partial Pass — where every real defect is in
   *  prose — it will look far cleaner than the job actually was. The caller
   *  MUST say so rather than quietly filing a flattering history. */
  degraded: boolean;
  degradedReason?: string;
  source: "council" | "consultant";
  inspectionCode: string | null;
  inspectionType: string | null;
  inspector: string | null;
  outcome: "pass" | "partial" | "fail" | "unknown";
  inspectedOn: string | null; // YYYY-MM-DD
  items: ExtractedItem[];
};

// ─── Deterministic pass ──────────────────────────────────────────────────

/** Council filenames carry the lot: BCO…_…_ICA_Fail_20240221.pdf
 *  NB the code can contain a digit — IF1, IF2 — so it is [A-Z][A-Z0-9]{1,3},
 *  not [A-Z]{2,4}. The all-letters form silently dropped every final
 *  inspection, which is the one that matters most. */
export function parseCouncilFilename(filename: string): { code: string | null; outcome: string | null; date: string | null } {
  const m = filename.match(/_([A-Z][A-Z0-9]{1,3})_(Pass|Fail|Partial Pass|Completed|Not Ready)_(\d{8})/i);
  if (!m) return { code: null, outcome: null, date: null };
  const d = m[3];
  return {
    code: m[1].toUpperCase(),
    outcome: m[2].toLowerCase(),
    date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
  };
}

function normaliseOutcome(raw: string | null | undefined): ExtractedInspection["outcome"] {
  const v = (raw || "").toLowerCase();
  if (v.includes("partial")) return "partial";
  if (v.includes("fail")) return "fail";
  if (v.includes("pass") || v.includes("complete")) return "pass";
  return "unknown";
}

/** The council's own summary of what failed. Exact, so we never rely on the
 *  model for the items it already printed as a numbered list. */
export function parseCouncilFails(text: string): { title: string }[] {
  const seg = text.match(/Inspection Summary\s+(?:Pass|Fail|Partial Pass|Completed)?\s*Comments\s+([\s\S]*?)(?:INSPECTION HISTORY|Additional Comments|Inspection Outcome|$)/i);
  if (!seg) return [];
  const out: { title: string }[] = [];
  const re = /\d+\.\s*(.+?)\s*\(\s*(Fail|Partial)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg[1]))) {
    const title = m[1].trim();
    if (title && title.length < 200) out.push({ title });
  }
  return out;
}

/** Header fields the council prints in a fixed shape. */
export function parseCouncilHeader(text: string): { code: string | null; typeName: string | null; date: string | null; outcome: string | null } {
  const codeM = text.match(/Inspection Type Code\s+(.{0,45}?)\(([A-Z][A-Z0-9]{1,3})\)/);
  const dateM = text.match(/Date of Inspection\s+(\d{2})-(\d{2})-(\d{4})/);
  const outM = text.match(/Inspection Outcome\s+(Pass|Fail|Partial Pass|Completed|Not Ready)/i);
  return {
    code: codeM ? codeM[2] : null,
    typeName: codeM ? codeM[1].trim() : null,
    date: dateM ? `${dateM[3]}-${dateM[2]}-${dateM[1]}` : null,
    outcome: outM ? outM[1] : null,
  };
}

// ─── Model pass ──────────────────────────────────────────────────────────

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    is_inspection_report: {
      type: "boolean",
      description: "False if this document is not an inspection/observation report at all (a fee proposal, a scope of work, a specification, a drawing). If false, return an empty items array.",
    },
    source: { type: "string", enum: ["council", "consultant"] },
    inspection_code: {
      type: "string",
      description:
        "For a COUNCIL report: its own inspection code — one of exactly these (Auckland Council's published list): IFO ISF ICB IFG ICA ICL ITK IDT IPP IPB IPL IF1 IF2 CPU SWP IME IRM. Never invent one. For a CONSULTANT report: the discipline it covers — FIRE, ELEC, MECH, HYD (hydraulic/plumbing), STRU (structural), ARCH (architectural), ACOU (acoustic), SEIS (seismic), or SERV when one report covers electrical + hydraulic + mechanical together. Empty string if you genuinely can't tell.",
    },
    inspection_type: { type: "string", description: "What kind of inspection this was, in the report's own words (\"Cavity wrap\", \"Fire\", \"Building services site inspection\"). Empty string if unclear." },
    inspector_org: { type: "string", description: "The ORGANISATION that inspected (\"Auckland Council\", the consultancy's name). NEVER a person's name. Empty string if unclear." },
    outcome: { type: "string", enum: ["pass", "partial", "fail", "unknown"] },
    inspected_on: { type: "string", description: "Date of the inspection as YYYY-MM-DD, or empty string if the report doesn't state one." },
    items: {
      type: "array",
      description: "One entry per OPEN, FAILED or OUTSTANDING item. Empty array if the inspection genuinely passed with nothing to fix.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "The defect in under 12 words, as an inspector would say it." },
          detail: { type: "string", description: "The report's own wording for this item. Empty string if the title already is it." },
          location: { type: "string", description: "Where on the job, if stated (\"Level 2, unit 2/4\", \"stairwell\"). Empty string if not stated." },
          category: { type: "string", enum: [...CATEGORIES] },
        },
        required: ["title", "detail", "location", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["is_inspection_report", "source", "inspection_code", "inspection_type", "inspector_org", "outcome", "inspected_on", "items"],
  additionalProperties: false,
} as const;

const SYSTEM = `You read New Zealand construction inspection reports and pull out ONLY what still needs fixing. You are building a builder's own failure history, so a missed defect is far worse than a duplicated one.

TWO KINDS OF REPORT
1. COUNCIL / BCA CHECKLISTS (Auckland Council style, codes like IFO, ISF, IFG, ICA, ICL, ITK, IDT, IPP, IPB, IPL, IF1, IF2, IME). Structured Pass/Fail/N/A checklist, then free text. THE MOST IMPORTANT PART IS THE FREE TEXT: on a "Partial Pass" the checklist summary is usually empty and every real defect sits under "ITEMS TO BE RESOLVED", "INSPECTION SCOPE", "Additional Comments" or "Cavity wrap items to resolve" as a numbered or bulleted prose list. Extract those.
2. CONSULTANT REPORTS (engineer / architect / fire / services site observation reports, NCRs, advice notices). Prose or tables of observations. Extract every observation that requires action.

CONSULTANT REPORTS HAVE NO SHARED VOCABULARY. Different consultancies mark the same thing differently, and the templates in this corpus use: Open / Closed columns; "Urgent Attention" / "Defect Requires Remedy" / "Progress Record"; an "Action: <party>" column; or nothing at all. Most have NO overall pass/fail — set outcome "unknown" rather than guessing one.

WHAT COUNTS AS AN ITEM
- Anything marked Fail, Open, non-compliant, defective, outstanding, incomplete, "to be resolved", "to complete", "still to do", "to come", "query", "customer to confirm", "engineer to confirm", or assigned to a responsible party for action.
- Each distinct defect is its own item, even when the report lists five under one heading.
DO NOT extract:
- Items marked done, completed, closed, rectified, or struck through. Some reports close an item inline: "…to look at Z flashing - completed. CLOSED". That is closed — skip it.
- Passes, N/A lines, or checklist rows with no defect.
- ACCEPTANCES AND CONCESSIONS. Fire and services reports mix these into the same numbered list as defects: "destructive testing was carried out and it looked okay", "it will be acceptable from a fire perspective to follow the same detail". Those are approvals, not defects.
- PHOTO CAPTIONS. Some reports carry a long block of captions under headings like "Selected Photos & Comments" — "Apartment 135 waterproofing", "Level 3 stairwell appears dry". They describe a photo, not a defect. Skip the whole block.
- Boilerplate: letterheads, distribution lists, price-code / origin-code legends, "Created <date> <email>" stamps, page footers.
- Pure admin ("consent documents on site", "as-built plan available", "test and method", "next inspection to be…", "approved plans onsite").
- The scope description itself, unless it names a defect.

DUPLICATES: some exports list every item twice — once in a table of contents grouped by status, then again in full. Report each item ONCE. Where a single row carries a dated update history ("08/11/2021 … 21/12/21 Update: Awaiting results"), that is still one item: use the LATEST state, and skip it entirely if the latest state is closed.

LOCATION: if the item itself doesn't say where, inherit it from the nearest preceding section heading ("Basement", "Level 4 Corridor", "Level 4 - Apartment type A"). Leave it empty rather than guessing.

CATEGORY: pick the one that matches what physically went wrong, not which inspection it was found on. A passive-fire stopping fail found on a post-line inspection is Fire, not Interior / Linings.

PRIVACY: never put a person's name, email address or phone number into any field. Organisations are fine. If the only identifier is a person, write an empty string.

FIDELITY: use the report's own words. Never invent a defect, a clause, a figure or a location that isn't there. If nothing needs fixing, return an empty items array — that is a valid and useful answer.`;

/** Cut a very long report down to what the extractor actually needs. Reports
 *  run to 23 pages, but the defect content is always in the checklist summary
 *  and the free-text sections — the header boilerplate repeats per page. */
function trimForModel(text: string, limit = 60000): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, Math.floor(limit * 0.45));
  const tail = text.slice(text.length - Math.floor(limit * 0.55));
  return `${head}\n…[middle of report omitted]…\n${tail}`;
}

/**
 * Is there enough readable text to work from? Some real reports — seismic site
 * sheets, a facade engineer's mark-ups — are photographs of a page with an
 * annotation layer, and `unpdf` returns a couple of hundred characters of
 * nothing. Below this bar we send the PDF itself to the model instead of the
 * extracted text: Claude reads the pages directly, which is the OCR.
 */
export function hasUsableText(text: string, pages: number): boolean {
  return text.length >= 400 && text.length / Math.max(pages, 1) >= 250;
}

export async function extractInspection(opts: {
  text: string;
  filename: string;
  /** The PDF itself. Supplied so a scan can be read as pages when the text
   *  layer is empty. Optional — the text path never needs it. */
  pdf?: Uint8Array;
  /** Set when the text layer was too thin to use; the PDF is read instead. */
  scanned?: boolean;
}): Promise<ExtractedInspection> {
  // Anonymise BEFORE the text goes anywhere — including into the prompt.
  // NB on the scanned path there is barely any text to scrub, and the PDF
  // pages themselves are not redacted — see the note in the ingest route.
  const clean = anonymiseText(opts.text);

  const fromName = parseCouncilFilename(opts.filename);
  const header = parseCouncilHeader(clean);
  const deterministic = parseCouncilFails(clean);

  const anthropic = new Anthropic({ maxRetries: 3 });
  let modelOut: Record<string, unknown> = {};
  let degraded = false;
  let degradedReason: string | undefined;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: ITEM_SCHEMA as unknown as Record<string, unknown> } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          // Scanned report → hand over the PDF and let the model read the
          // pages. Text report → hand over the extracted text, which is
          // cheaper and more faithful.
          content: opts.scanned && opts.pdf
            ? ([
                {
                  type: "document",
                  source: { type: "base64", media_type: "application/pdf", data: Buffer.from(opts.pdf).toString("base64") },
                },
                {
                  type: "text",
                  text: `Filename: ${opts.filename}
${fromName.code ? `The filename says this is a ${fromName.code} inspection with outcome "${fromName.outcome}" on ${fromName.date}.` : ""}

This report has no usable text layer — it is scanned or photo-based. READ THE PAGES ABOVE, including handwriting, stamps, mark-ups and annotations drawn onto photographs. Numbered balloons or callouts pointing at a photo are items. If a page is genuinely unreadable, leave those items out rather than guessing at them.`,
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ] as any)
            : `Filename: ${opts.filename}
${fromName.code ? `The filename says this is a ${fromName.code} inspection with outcome "${fromName.outcome}" on ${fromName.date}.` : ""}

REPORT TEXT
${trimForModel(clean)}`,
        },
      ],
    });
    const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    modelOut = JSON.parse(text);
  } catch (e) {
    console.error("inspection extraction failed:", e);
    // Fall through: the deterministic pass below still produces a usable row —
    // but flag it, because on a Partial Pass that row is misleadingly clean.
    degraded = true;
    degradedReason =
      e instanceof Anthropic.APIError && e.status === 400 && /credit balance/i.test(String(e.message))
        ? "the assistant is out of credit"
        : "the assistant couldn't be reached";
  }

  // The council's own header and filename beat the model when they exist —
  // they're printed, not inferred. The model only fills the gap, which on a
  // consultant report (no code anywhere) is the discipline.
  const inspectionCode = (header.code || fromName.code || str(modelOut.inspection_code) || null)?.toUpperCase() ?? null;
  const known = inspectionType(inspectionCode);

  // Merge: deterministic checklist fails first (they're exact), then anything
  // the model found that isn't already covered.
  const items: ExtractedItem[] = [];
  const seen = new Set<string>();
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);

  for (const d of deterministic) {
    const title = anonymiseField(d.title);
    if (!title || seen.has(key(title))) continue;
    seen.add(key(title));
    const c = classify({ title, inspectionCode });
    items.push({ title, detail: null, location: null, category: c.category, categoryBy: c.by });
  }

  const rawItems = Array.isArray(modelOut.items) ? (modelOut.items as Record<string, unknown>[]) : [];
  for (const r of rawItems) {
    const title = anonymiseField(str(r.title));
    if (!title || seen.has(key(title))) continue;
    seen.add(key(title));
    const detail = anonymiseField(str(r.detail));
    const location = anonymiseField(str(r.location));
    const c = classify({ title, detail, suggested: str(r.category), inspectionCode });
    items.push({ title, detail: detail === title ? null : detail, location, category: c.category, categoryBy: c.by });
  }

  return {
    // Only the model can tell a fee proposal from a site report. Default true
    // when the model call failed, so a transient API error doesn't get reported
    // to the user as "that isn't an inspection report".
    isInspectionReport: modelOut.is_inspection_report !== false,
    degraded,
    degradedReason,
    source: known?.group === "council" ? "council" : known?.group === "consultant" ? "consultant" : str(modelOut.source) === "council" ? "council" : "consultant",
    inspectionCode,
    inspectionType: str(modelOut.inspection_type) || codeName(inspectionCode) || known?.name || header.typeName || null,
    // Organisations only — anonymiseField turns a bare "Firstname Lastname" into
    // [PERSON], which is the signal that the model gave us the inspector, not
    // the inspecting body. Drop it rather than store a placeholder.
    inspector: dropIfPerson(anonymiseField(str(modelOut.inspector_org))),
    outcome: normaliseOutcome(str(modelOut.outcome) || header.outcome || fromName.outcome),
    inspectedOn: isoDate(str(modelOut.inspected_on)) || header.date || fromName.date || null,
    items,
  };
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}
function isoDate(v: string | null): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function dropIfPerson(v: string | null): string | null {
  return v && v.includes("[PERSON]") ? null : v;
}
