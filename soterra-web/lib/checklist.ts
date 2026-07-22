import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { checklistItems, checklistPhotos, checklists } from "./schema";
import type { Scope } from "./company";
import { CATEGORIES, CONSULTANT_TYPES, INSPECTION_CODES, codeName, inspectionType, isCategory, typeQuery } from "./categories";
import { historyForCode, searchHistory, topItems } from "./history";
import { getProjectIndex } from "./projectIndex";
import { getCodeIndex, codeLabel } from "./codeIndex";
import { excerpt, retrieve } from "./retrieve";

// ─── The checklist engine ────────────────────────────────────────────────
//
// An inspection IS a calendar event, so a checklist hangs off one. The
// assistant writes it from three sources, in this order of authority:
//
//   1. THIS PROJECT'S DRAWINGS  — every "as per plan" item
//   2. THE BUILDING CODE        — every numeric item (150mm upstand, 100mm
//                                 max hole, barrier heights)
//   3. THIS COMPANY'S HISTORY   — what we personally keep failing
//
// Every item carries the source it came from and the exact citation. An item
// with no citation is a guess, and a guess on a pre-inspection checklist is
// worse than no item at all — so the model is told to drop anything it can't
// point at.
//
// The reason this is feature #1: across Adam's own 27 council reports, only
// 22% were a clean pass, 67% needed a return visit, and every failed item was
// a plan lookup or a code figure. The drawings were on site. Nobody checked.

const MODEL = "claude-opus-4-8";

export type ChecklistKind = "inspection" | "ccc";

// ─── The CCC evidence pack ───────────────────────────────────────────────
// Second checklist type, same engine, different item source. These are the
// documents a council wants before it will issue a Code Compliance
// Certificate — the ones that get chased for weeks at the end of a job.
const CCC_PACK: { title: string; detail: string; category: string }[] = [
  { title: "Energy work certificates — all electrical work", detail: "One per electrical contractor who did prescribed electrical work. Chase these the week the sparky finishes, not at CCC.", category: "Electrical" },
  { title: "Energy work certificate — gas fitting", detail: "Required for any gas work. Not applicable on an all-electric job — mark N/A.", category: "Mechanical" },
  { title: "Producer statements PS3 (construction) from each subtrade", detail: "One per trade whose work was covered by a PS1/PS2. Check the PS3 names the right consent number and the work actually done.", category: "Structural" },
  { title: "Producer statement PS4 (construction review) from the engineer", detail: "The design engineer's sign-off that the built work matches the design. Usually the long pole — book it early.", category: "Structural" },
  { title: "LBP records of work — every restricted building work item", detail: "Each LBP must lodge a record of work for their own RBW. Missing ROWs are a common CCC hold-up.", category: "Structural" },
  { title: "As-built drainage plan, signed by the drainlayer", detail: "Shows the drainage as actually laid, including any deviation from consent. Council checks it against the IDT inspection.", category: "Plumbing & Drainage" },
  { title: "As-built services plans (electrical, mechanical, hydraulic)", detail: "Required where services were installed to a design. Get them at practical completion while the subbie still cares.", category: "Electrical" },
  { title: "Truss and frame documentation — layout plans and fixing schedules", detail: "The manufacturer's layout as supplied, plus the fixing/bracing schedule. Must match what was actually installed.", category: "Structural" },
  { title: "Cladding installation certificate / producer statement", detail: "From the cladding installer, naming the system and confirming it was installed to the manufacturer's specification.", category: "Weathertightness / Cladding" },
  { title: "Waterproofing / membrane installation certificate + warranty", detail: "Applicator's certificate for every wet area, deck and balcony, with the warranty. Council will ask which areas it covers.", category: "Weathertightness / Cladding" },
  { title: "Passive fire installation certificate and penetration schedule", detail: "The specialist's certificate plus the schedule of penetrations, matching the labels on site.", category: "Fire" },
  { title: "Fire alarm / sprinkler commissioning certificates", detail: "Commissioning and, where applicable, the IQP sign-off. Needed before the compliance schedule can be issued.", category: "Fire" },
  { title: "Mechanical ventilation commissioning report", detail: "Air balance / commissioning results against the design figures.", category: "Mechanical" },
  { title: "Safety glazing certificates (NZS 4223 / NZS 2208)", detail: "Confirming the grades installed in doors, barriers and wet areas. Permanent markings must be visible on site too.", category: "Interior / Linings" },
  { title: "Insulation and H1 documentation — R-values as installed", detail: "What was actually installed against the consented R-values, including any variation.", category: "Interior / Linings" },
  { title: "Barrier and handrail compliance — heights and gaps as built", detail: "Confirm against F4: barrier height, 100mm sphere gap, no climbable elements. Measure, don't assume.", category: "Access & Barriers" },
  { title: "Minor variations — all recorded and accepted by council", detail: "Every on-site change agreed with the inspector needs to be on the file as a minor variation, or it's an amendment.", category: "Other" },
  { title: "Compliance schedule — specified systems list agreed with council", detail: "Only for buildings with specified systems. Get the list agreed early; it drives the BWOF.", category: "Fire" },
];

// ─── Generation ──────────────────────────────────────────────────────────

const ITEM_LIST_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "What to check, as an instruction, under 14 words. Start with the thing, not a verb: \"Membrane upstand — 150mm minimum above finished level\"." },
          detail: { type: "string", description: "What good looks like, including the actual figure or the actual plan requirement. One or two sentences." },
          source: { type: "string", enum: ["plans", "code", "history"] },
          source_ref: { type: "string", description: "The EXACT page label you were given for the page this came from, copied verbatim. For a history item, the count, e.g. \"Failed 3 times before\"." },
          category: { type: "string", enum: [...CATEGORIES] },
        },
        required: ["title", "detail", "source", "source_ref", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

const GEN_SYSTEM = `You write the pre-inspection checklist a New Zealand site manager walks the job with an hour before the inspector arrives.

You are given three sources. Use ALL of them:
1. THIS PROJECT'S DRAWINGS — pages from the site's own consented drawings and specs. Every "as per plan" item comes from here, WITH the actual value the plan gives. "Cavity battens as per plan" is useless; "Cavity battens — 20mm H3.1 treated, at 600 crs per A-302" is a check someone can do.
2. THE BUILDING CODE — pages from the MBIE Acceptable Solutions and Verification Methods. Every numeric item comes from here, with the actual figure.
3. THIS COMPANY'S OWN HISTORY — things this builder has already been failed on. These matter most: they are the specific mistakes this crew makes.

RULES
- EVERY item must be traceable. Copy the page label you were given into source_ref, exactly as given. If you cannot point at a source for an item, DO NOT include it — an invented item on a checklist is worse than a missing one.
- Never invent a clause number, a dimension, a product or a page label.
- Put the figure IN the item. A checklist item without the number is just a reminder to go and look it up.
- Order by what fails an inspection: history items first, then anything weathertightness or fire, then the rest.
- 10 to 20 items. This is walked on a phone, on site, in the rain. Ruthless beats thorough.
- Write like an experienced site manager talking to another one. No filler, no "ensure that", no "it is recommended".
- If a source gives you nothing useful, use fewer items rather than padding with generic ones.`;

/** Turn an inspection code into the retrieval queries that actually find the
 *  right pages. "ICA" finds nothing in a drawing set; "cavity batten building
 *  wrap flashing membrane upstand" finds the details. */
const CODE_QUERIES: Record<string, string> = {
  IFO: "foundation strip bored pile footing reinforcing depth bearing NZS3604",
  ISF: "concrete floor slab reinforcing mesh damp proof membrane thickness cover pour",
  ICB: "concrete block masonry reinforcing bond beam grout cast in situ panel column wall pour",
  IFG: "timber steel framing stud lintel bracing top plate bottom plate fixing roof truss",
  ICA: "cavity batten building wrap rigid air barrier flashing membrane upstand saddle deck balcony",
  ICL: "cladding fixing junction clearance ground level flashing coating system",
  ITK: "waterproofing membrane tanking below ground upstand fall wet area shower deck roof",
  IDT: "drainage surface water foul water gradient pipe gully vent as-built plan",
  IPP: "plumbing underslab pre-line water supply pipe backflow hot water cylinder tempering valve",
  IPB: "pre-line insulation R-value framing notches holes fire lining passive fire moisture content joinery air seal",
  IPL: "post-line bracing sheet fixing wet area lining passive fire penetration diaphragm ceiling stopping fire rated",
  IF1: "final barrier handrail stair safety glass ventilation smoke alarm wet area hot water solid fuel appliance",
  IF2: "final commercial fire door exit sign emergency lighting sprinkler barrier glazing manifestation accessible",
  CPU: "public access egress exit route barrier handrail signage separation from building work temporary protection",
  SWP: "pool fence barrier height gap latch self closing gate climbable NZS8500 F9",
};

function queryFor(code: string | null, title: string): string {
  // Council codes have their own query table; consultant disciplines carry
  // theirs on the type itself (lib/categories.ts).
  const c = code ? CODE_QUERIES[code.toUpperCase()] ?? typeQuery(code) : null;
  return [c, title].filter(Boolean).join(" ");
}

export type GeneratedItem = { title: string; detail: string; source: string; sourceRef: string | null; category: string };
export type GenerateResult =
  | { ok: true; items: GeneratedItem[] }
  // "empty" = the sources genuinely had nothing. "failed" = the assistant
  // couldn't be reached at all. Telling a site manager "upload your drawings"
  // when the real problem is an API outage sends them off fixing the wrong
  // thing, so the two are kept apart all the way to the message on screen.
  | { ok: false; reason: "empty" | "failed"; message: string };

export async function generateChecklistItems(
  scope: Scope,
  opts: { kind: ChecklistKind; inspectionCode: string | null; title: string }
): Promise<GenerateResult> {
  // The CCC pack is a fixed evidence list, not a retrieval problem — the
  // documents a council wants don't change per site.
  if (opts.kind === "ccc") {
    return { ok: true, items: CCC_PACK.map((c) => ({ title: c.title, detail: c.detail, source: "ccc", sourceRef: "CCC evidence pack", category: c.category })) };
  }

  const q = queryFor(opts.inspectionCode, opts.title);

  // Where "what we personally keep failing" comes from. A council code matches
  // history on the code itself; a consultant discipline matches on its
  // category, because a fire engineer's report and a council post-line
  // inspection both produce Fire items and both are worth surfacing.
  const type = inspectionType(opts.inspectionCode);
  const historyQuery = !opts.inspectionCode
    ? searchHistory(scope, opts.title, { limit: 10 }).then((rows) => rows.map((r) => ({ title: r.title, category: r.category, count: 1, lastSeen: r.inspectedOn })))
    : type?.group === "consultant"
      ? topItems(scope, { category: type.category, limit: 10 })
      : historyForCode(scope, opts.inspectionCode, 10);

  const [projectIdx, codeIdx, history] = await Promise.all([
    getProjectIndex(scope.projectId),
    getCodeIndex(),
    historyQuery,
  ]);

  const planPages = retrieve(projectIdx.pages, projectIdx.df, q, 6);
  const codeHits = retrieve(codeIdx.pages, codeIdx.df, q, 6);

  const planLabel = (p: (typeof planPages)[number]) =>
    [p.doc, p.code, p.title].filter(Boolean).join(" · ") + ` · page ${p.page} of ${p.npages}`;

  const sources = [
    planPages.length
      ? `THIS PROJECT'S DRAWINGS\n${planPages.map((p) => `--- PAGE LABEL: ${planLabel(p)}\n${excerpt(p.text, q, 2200)}`).join("\n\n")}`
      : "THIS PROJECT'S DRAWINGS\n(no drawings uploaded for this site yet — do not invent any)",
    codeHits.length
      ? `THE BUILDING CODE\n${codeHits.map((p) => `--- PAGE LABEL: ${codeLabel(p)}\n${excerpt(p.text, q, 2200)}`).join("\n\n")}`
      : "THE BUILDING CODE\n(nothing matched — do not invent a clause)",
    history.length
      ? `THIS COMPANY'S OWN HISTORY — already failed on these\n${history.map((h) => `- ${h.title} [${h.category}] — failed ${h.count} time${h.count === 1 ? "" : "s"}${h.lastSeen ? `, last ${h.lastSeen}` : ""}`).join("\n")}`
      : "THIS COMPANY'S OWN HISTORY\n(no inspection history filed yet)",
  ].join("\n\n════════\n\n");

  const codeLabelName = opts.inspectionCode ? `${codeName(opts.inspectionCode) ?? opts.inspectionCode} (${opts.inspectionCode})` : opts.title;

  const anthropic = new Anthropic({ maxRetries: 2 });
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: ITEM_LIST_SCHEMA as unknown as Record<string, unknown> } },
      system: GEN_SYSTEM,
      messages: [{ role: "user", content: `Write the pre-inspection checklist for: ${codeLabelName}\n\n${sources}` }],
    });
    const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(text) as { items?: Record<string, unknown>[] };
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map((r) => ({
        title: String(r.title ?? "").trim(),
        detail: String(r.detail ?? "").trim(),
        source: ["plans", "code", "history"].includes(String(r.source)) ? String(r.source) : "manual",
        sourceRef: String(r.source_ref ?? "").trim() || null,
        category: isCategory(r.category) ? r.category : "Other",
      }))
      .filter((r) => r.title.length > 2);
    if (!items.length) {
      return {
        ok: false,
        reason: "empty",
        message: planPages.length
          ? "Nothing solid enough to check came out of the drawings, the Code or your history for that inspection. Try a different inspection type, or add the items by hand."
          : "This site has no drawings uploaded yet, so there's nothing to build the check from. Upload the plan set first — or add the items by hand.",
      };
    }
    return { ok: true, items };
  } catch (e) {
    console.error("checklist generation failed:", e);
    const msg = e instanceof Anthropic.APIError && e.status === 400 && /credit balance/i.test(String(e.message))
      ? "The assistant is out of credit — top up the Anthropic account and this will work again."
      : "The assistant couldn't be reached just now. Give it a moment and try again.";
    return { ok: false, reason: "failed", message: msg };
  }
}

// ─── Storage ─────────────────────────────────────────────────────────────

export async function createChecklist(
  scope: Scope,
  input: {
    eventId?: string | null;
    kind: ChecklistKind;
    title: string;
    inspectionCode?: string | null;
    createdByName?: string | null;
    items: { title: string; detail?: string | null; source?: string; sourceRef?: string | null; category?: string | null }[];
  }
) {
  const [row] = await db
    .insert(checklists)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      eventId: input.eventId ?? null,
      kind: input.kind,
      title: input.title,
      inspectionCode: input.inspectionCode ?? null,
      createdBy: scope.userId,
      createdByName: input.createdByName ?? null,
    })
    .returning();

  if (input.items.length) {
    await db.insert(checklistItems).values(
      input.items.map((it, i) => ({
        companyId: scope.companyId,
        projectId: scope.projectId,
        checklistId: row.id,
        ord: i,
        category: it.category ?? null,
        title: it.title,
        detail: it.detail ?? null,
        source: it.source ?? "manual",
        sourceRef: it.sourceRef ?? null,
      }))
    );
  }
  return row;
}

export async function getChecklist(scope: Scope, checklistId: string) {
  const [head] = await db
    .select()
    .from(checklists)
    .where(and(eq(checklists.id, checklistId), eq(checklists.companyId, scope.companyId)))
    .limit(1);
  if (!head) return null;

  const items = await db
    .select()
    .from(checklistItems)
    .where(and(eq(checklistItems.checklistId, checklistId), eq(checklistItems.companyId, scope.companyId)))
    .orderBy(asc(checklistItems.ord), asc(checklistItems.createdAt));

  const photos = items.length
    ? await db
        .select({ id: checklistPhotos.id, itemId: checklistPhotos.itemId, url: checklistPhotos.url, caption: checklistPhotos.caption })
        .from(checklistPhotos)
        .where(and(eq(checklistPhotos.checklistId, checklistId), eq(checklistPhotos.companyId, scope.companyId)))
    : [];

  const byItem = new Map<string, typeof photos>();
  for (const p of photos) {
    const list = byItem.get(p.itemId) ?? [];
    list.push(p);
    byItem.set(p.itemId, list);
  }

  return {
    checklist: head,
    items: items.map((it) => ({ ...it, photos: byItem.get(it.id) ?? [] })),
  };
}

/** Every checklist on a site, newest first, with a done/total count. */
export async function listChecklists(scope: Scope, opts: { eventId?: string | null } = {}) {
  const where = opts.eventId
    ? and(eq(checklists.companyId, scope.companyId), eq(checklists.eventId, opts.eventId))
    : and(eq(checklists.companyId, scope.companyId), eq(checklists.projectId, scope.projectId));

  const rows = await db.select().from(checklists).where(where).orderBy(asc(checklists.createdAt));
  if (!rows.length) return [];

  const counts = await db
    .select({ checklistId: checklistItems.checklistId, status: checklistItems.status })
    .from(checklistItems)
    .where(inArray(checklistItems.checklistId, rows.map((r) => r.id)));

  const tally = new Map<string, { total: number; done: number; issues: number }>();
  for (const c of counts) {
    const t = tally.get(c.checklistId) ?? { total: 0, done: 0, issues: 0 };
    t.total++;
    if (c.status !== "pending") t.done++;
    if (c.status === "issue") t.issues++;
    tally.set(c.checklistId, t);
  }

  return rows.map((r) => ({ ...r, ...(tally.get(r.id) ?? { total: 0, done: 0, issues: 0 }) }));
}

const ITEM_STATUS = ["pending", "ok", "issue", "na"] as const;
export type ItemStatus = (typeof ITEM_STATUS)[number];
export const isItemStatus = (v: unknown): v is ItemStatus => ITEM_STATUS.includes(v as ItemStatus);

export async function updateChecklistItem(
  scope: Scope,
  itemId: string,
  fields: { status?: ItemStatus; note?: string | null; checkedByName?: string | null }
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = {};
  if (fields.status) {
    set.status = fields.status;
    set.checkedAt = fields.status === "pending" ? null : new Date();
    set.checkedBy = fields.status === "pending" ? null : scope.userId;
    set.checkedByName = fields.status === "pending" ? null : fields.checkedByName ?? null;
  }
  if (fields.note !== undefined) set.note = fields.note;
  if (!Object.keys(set).length) return null;

  const [row] = await db
    .update(checklistItems)
    .set(set)
    .where(and(eq(checklistItems.id, itemId), eq(checklistItems.companyId, scope.companyId)))
    .returning();
  if (row) await db.update(checklists).set({ updatedAt: new Date() }).where(eq(checklists.id, row.checklistId));
  return row ?? null;
}

export async function addChecklistItem(
  scope: Scope,
  checklistId: string,
  input: { title: string; detail?: string | null; category?: string | null }
) {
  const [head] = await db
    .select({ id: checklists.id })
    .from(checklists)
    .where(and(eq(checklists.id, checklistId), eq(checklists.companyId, scope.companyId)))
    .limit(1);
  if (!head) return null;
  const existing = await db.select({ ord: checklistItems.ord }).from(checklistItems).where(eq(checklistItems.checklistId, checklistId));
  const ord = existing.reduce((m, r) => Math.max(m, r.ord), -1) + 1;
  const [row] = await db
    .insert(checklistItems)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      checklistId,
      ord,
      title: input.title,
      detail: input.detail ?? null,
      category: input.category ?? null,
      source: "manual",
    })
    .returning();
  return row;
}

export async function setChecklistStatus(scope: Scope, checklistId: string, status: "open" | "done") {
  const [row] = await db
    .update(checklists)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(checklists.id, checklistId), eq(checklists.companyId, scope.companyId)))
    .returning();
  return row ?? null;
}

export async function deleteChecklist(scope: Scope, checklistId: string) {
  const [row] = await db
    .delete(checklists)
    .where(and(eq(checklists.id, checklistId), eq(checklists.companyId, scope.companyId)))
    .returning({ id: checklists.id });
  if (!row) return false;
  await db.delete(checklistItems).where(and(eq(checklistItems.checklistId, checklistId), eq(checklistItems.companyId, scope.companyId)));
  await db.delete(checklistPhotos).where(and(eq(checklistPhotos.checklistId, checklistId), eq(checklistPhotos.companyId, scope.companyId)));
  return true;
}

export async function addChecklistPhoto(scope: Scope, itemId: string, url: string, caption: string | null) {
  const [item] = await db
    .select({ id: checklistItems.id, checklistId: checklistItems.checklistId })
    .from(checklistItems)
    .where(and(eq(checklistItems.id, itemId), eq(checklistItems.companyId, scope.companyId)))
    .limit(1);
  if (!item) return null;
  const [row] = await db
    .insert(checklistPhotos)
    .values({ companyId: scope.companyId, projectId: scope.projectId, checklistId: item.checklistId, itemId, url, caption, takenBy: scope.userId })
    .returning();
  return row;
}

/** Confirm a blob pathname belongs to a photo on THIS company's checklist
 *  before streaming it back — private blobs have no URL-level protection. */
export async function photoIsOurs(scope: Scope, pathname: string): Promise<boolean> {
  const [row] = await db
    .select({ id: checklistPhotos.id })
    .from(checklistPhotos)
    .where(and(eq(checklistPhotos.url, pathname), eq(checklistPhotos.companyId, scope.companyId)))
    .limit(1);
  return !!row;
}

/** What you can build a check for, grouped the way the inspections actually
 *  arrive: the council's statutory ones, then the consultants' disciplines.
 *  IME and IRM are dropped — both are minuted meetings, so there's nothing to
 *  walk the job with. */
export const CHECKLIST_TYPES = {
  council: Object.entries(INSPECTION_CODES)
    .filter(([code]) => !["IME", "IRM"].includes(code))
    .map(([code, v]) => ({ code, name: v.name })),
  consultant: CONSULTANT_TYPES.map((t) => ({ code: t.code, name: t.name })),
};
