import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { checklistItems, checklistPhotos, checklists, planPins } from "./schema";
import type { Scope } from "./company";
import { CATEGORIES, CONSULTANT_TYPES, INSPECTION_CODES, codeName, inspectionType, isCategory, typeQuery } from "./categories";
import { historyForCode, searchHistory, topItems } from "./history";
import { getProjectIndex } from "./projectIndex";
import { getCodeIndex, codeLabel } from "./codeIndex";
import { getManufacturerIndex, manufacturerLabel, visibleTo } from "./manufacturerIndex";
import { excerpt, retrieve } from "./retrieve";
import { blockersFor } from "./inspectionOrder";

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
// The inspection checklist cites the drawings, the Code and the manufacturer
// manuals, so it stays on Opus — a fabricated citation there is unacceptable. A
// safety plan (SWMS) has no retrieval; it's standard HSWA / WorkSafe knowledge,
// which Sonnet writes just as well for ~a fifth of the cost. So SWMS runs cheaper.
const SWMS_MODEL = "claude-sonnet-4-6";

export type ChecklistKind = "inspection" | "ccc" | "swms";

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
          source: { type: "string", enum: ["plans", "code", "manufacturer", "history"] },
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

You are given four sources. Use every one that has something ON-SUBJECT for this inspection (see the subject rule below); ignore the parts that aren't:
1. THIS PROJECT'S DRAWINGS — pages from the site's own consented drawings and specs. Every "as per plan" item comes from here, WITH the actual value the plan gives. "Cavity battens as per plan" is useless; "Cavity battens — 20mm H3.1 treated, at 600 crs per A-302" is a check someone can do.
2. THE BUILDING CODE — pages from the MBIE Acceptable Solutions and Verification Methods. Every numeric item comes from here, with the actual figure.
3. THE MANUFACTURER'S MANUAL — pages from the maker's own installation manual (e.g. GIB). This is what the inspector actually checks a proprietary system against, and it is FREQUENTLY STRICTER than the Code minimum. Fastener type and centres, sheet layout, back-blocking, control joints, the specific system build-up — take these from here, with the exact figure, and cite the manual page. Where the manual and the Code differ, the manual governs the warranty, so lead with the manual's figure.
4. THIS COMPANY'S OWN HISTORY — things this builder has already been failed on. These matter most: they are the specific mistakes this crew makes.

THE SUBJECT IS FIXED BY THE REQUEST — READ THIS FIRST.
You are writing the checklist for ONE specific inspection, named at the end. Before you write anything, decide what that inspection is actually about. Retrieval is fuzzy: some pages you are handed matched only because they share a common word ("wall", "layer", "GIB", "board") with the request, but are really about a DIFFERENT trade or system. You MUST leave those out. Take items ONLY from pages that genuinely belong to this inspection's subject.
- A FIRE-RATED LINING / fire wall check is about: the fire-rated boards (type, thickness, e.g. GIB Fyreline), the specific GIB fire system number, fastener type and centres for that system, sheet layout and stagger, back-blocking, control joints, the fire/acoustic infill THAT SYSTEM specifies, and sealing/fire-collaring penetrations through the rated wall. It is NOT about external flashings, building underlay, cavity, cladding, head/sill weathertightness, capping or bottom plates, or wet-area (Aqualine) boards — even though those pages say "wall". Drop them.
- In particular, Building Code pages about ENERGY EFFICIENCY or INTERNAL MOISTURE (H1 or E3: thermal R-values / insulation levels like "R-value 1.5 minimum", building paper, thermal breaks on steel framing, ceiling or roof insulation, weathertightness) are a DIFFERENT inspection entirely. Never put them on a fire check, even when the page says "wall", "framing" or "insulation". The ONLY insulation that belongs on a fire or acoustic wall check is the specific fire/acoustic infill named in the manufacturer's fire or noise-control system (e.g. the glass-wool batt the GIB system calls for), cited from that manual — never a Building-Code thermal R-value.
- The same discipline applies to every subject: a waterproofing check is not a framing check; a bracing check is not a cladding check. If a page is off-subject, it does not become an item, no matter how well it's cited.
A checklist full of the wrong trade's items is a FAILURE — worse than a short one. If, after filtering to the subject, a source has nothing on-subject, take nothing from it and say less. It is completely fine to lean mostly on the manufacturer's manual, the Code and this company's history when the project's own drawings don't cover this particular system.

RULES
- EVERY item must be traceable. Copy the page label you were given into source_ref, exactly as given. If you cannot point at a source for an item, DO NOT include it — an invented item on a checklist is worse than a missing one.
- Never invent a clause number, a dimension, a product or a page label.
- Put the figure IN the item. A checklist item without the number is just a reminder to go and look it up.
- Order by what fails an inspection: history items first, then anything weathertightness or fire, then the rest.
- 10 to 20 items. This is walked on a phone, on site, in the rain. Ruthless beats thorough.
- Write like an experienced site manager talking to another one. No filler, no "ensure that", no "it is recommended".
- If a source gives you nothing useful, use fewer items rather than padding with generic ones.`;

// A free-text checklist title retrieves badly on its own. "GIB fire-rated wall,
// first layer" tokenises to a hyphenated "fire-rated" that never matches "fire
// rated" in the corpus, so the fire signal vanishes and the search falls back to
// the one common word "wall" — which on a weathertightness-heavy drawing set
// ranks flashings, underlay and cladding, the wrong trade entirely. Normalise
// the hyphens so the compound's parts match, and for a few common subjects add
// the vocabulary the manuals and the Code actually use, so the right pages rank.
const SUBJECT_HINTS: { re: RegExp; add: string }[] = [
  { re: /\bfire|fyreline|frr|fhr\b/i, add: "fire rated FRR fire resistance fyreline passive fire fire collar penetration fire seal fire lining system GBTL fastener screw centres control joint back-blocking board layer stud" },
  { re: /\bwaterproof|tank|membrane|wet\s?area|shower|bathroom\b/i, add: "waterproofing membrane tanking wet area upstand fall bond breaker Aqualine primer" },
  { re: /\bbrac/i, add: "bracing bracing unit BU EzyBrace GBS hold-down fixing lining sheet nailing" },
  { re: /\bcavity|wrap|underlay|weathertight|cladding|flashing\b/i, add: "cavity batten building wrap underlay flashing drainage plane clearance junction saddle" },
  { re: /\bframe|framing|stud|lintel|plate|truss\b/i, add: "framing stud lintel top plate bottom plate nog dwang fixing bracing" },
];

/** Enrich a free-text checklist title into a retrieval query: split hyphenated
 *  compounds so their parts match the corpus, and append the subject vocabulary
 *  so a fire check finds the fire pages, not the pages that merely say "wall". */
function enrichTitleQuery(title: string): string {
  const base = title.replace(/-/g, " ");
  const hints = SUBJECT_HINTS.filter((h) => h.re.test(title)).map((h) => h.add);
  return [base, ...hints].join(" ");
}

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
  // theirs on the type itself (lib/categories.ts). The title is always enriched
  // so a free-text "fire-rated wall" ask retrieves the fire pages, not the pages
  // that merely share the word "wall".
  const c = code ? CODE_QUERIES[code.toUpperCase()] ?? typeQuery(code) : null;
  return [c, enrichTitleQuery(title)].filter(Boolean).join(" ");
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
  opts: {
    kind: ChecklistKind;
    inspectionCode: string | null;
    title: string;
    /** Feature 4: scope the check to one QA location. drawings = that
     *  location's sheet titles (from lib/locations.ts); empty = prompt-only
     *  scoping (a free-typed zone has no sheets of its own). */
    location?: { label: string; drawings: string[] } | null;
  }
): Promise<GenerateResult> {
  // A safety plan (SWMS / JSA) is grounded in HSWA + WorkSafe good practice, not
  // in this site's drawings, so it takes its own path — no plan/Code/manual
  // retrieval, just the task.
  if (opts.kind === "swms") return generateSwmsItems(opts.title);

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
  // The free-text path used to hardcode count: 1 on every row, so the prompt —
  // which tells the model these items "matter most" — was fed a fabricated
  // frequency ("failed 1 time") for things that may have run open across six
  // inspections. searchHistory returns one row per appearance, so fold the
  // rows by title and count for real: same shape topItems returns, honestly
  // derived rather than invented.
  const historyQuery = !opts.inspectionCode
    ? searchHistory(scope, opts.title, { limit: 30 }).then((rows) => {
        const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 5).join(" ");
        const byTitle = new Map<string, { title: string; category: string; count: number; firstSeen: string | null; lastSeen: string | null }>();
        for (const r of rows) {
          const k = key(r.title);
          const cur = byTitle.get(k);
          if (cur) {
            cur.count += 1;
            if (r.inspectedOn && (!cur.lastSeen || r.inspectedOn > cur.lastSeen)) cur.lastSeen = r.inspectedOn;
            if (r.inspectedOn && (!cur.firstSeen || r.inspectedOn < cur.firstSeen)) cur.firstSeen = r.inspectedOn;
          } else {
            byTitle.set(k, { title: r.title, category: r.category, count: 1, firstSeen: r.inspectedOn, lastSeen: r.inspectedOn });
          }
        }
        return [...byTitle.values()].sort((a, b) => b.count - a.count).slice(0, 10);
      })
    : type?.group === "consultant"
      ? topItems(scope, { category: type.category, limit: 10 })
      : historyForCode(scope, opts.inspectionCode, 10);

  const [projectIdx, codeIdx, mfrIdx, history] = await Promise.all([
    getProjectIndex(scope.projectId),
    getCodeIndex(),
    getManufacturerIndex(),
    historyQuery,
  ]);

  // Location scoping: when the check is scoped to a location that owns sheets,
  // retrieve from THOSE sheets, so "Unit 1 fire check" items come from Unit 1's
  // drawings, not Unit 2's. If the filter leaves nothing (stale location cache
  // after a re-upload), fall back to the whole set rather than starve the check.
  const locDocs = new Set(opts.location?.drawings ?? []);
  const scopedPages = locDocs.size ? projectIdx.pages.filter((pg) => locDocs.has(pg.doc)) : projectIdx.pages;
  const planPool = scopedPages.length ? scopedPages : projectIdx.pages;
  const planPages = retrieve(planPool, projectIdx.df, q, 6);
  const codeHits = retrieve(codeIdx.pages, codeIdx.df, q, 6);
  // ⚠️ visibleTo, exactly as the assistant's own search does. Without it a
  // checklist could quote a demo-tier manufacturer to an account that must
  // never see one: those brands have NOT granted permission, several are
  // competitors of each other, and one of them has staff with accounts here.
  // The gate has to hold on every path that reads this index, not just on
  // search_manufacturer.
  const mfrHits = retrieve(visibleTo(mfrIdx.pages, scope.userId), mfrIdx.df, q, 6);

  const planLabel = (p: (typeof planPages)[number]) =>
    [p.doc, p.code, p.title].filter(Boolean).join(" · ") + ` · page ${p.page} of ${p.npages}`;

  const sources = [
    planPages.length
      ? `THIS PROJECT'S DRAWINGS\n${planPages.map((p) => `--- PAGE LABEL: ${planLabel(p)}\n${excerpt(p.text, q, 2200)}`).join("\n\n")}`
      : "THIS PROJECT'S DRAWINGS\n(no drawings uploaded for this site yet — do not invent any)",
    codeHits.length
      ? `THE BUILDING CODE\n${codeHits.map((p) => `--- PAGE LABEL: ${codeLabel(p)}\n${excerpt(p.text, q, 2200)}`).join("\n\n")}`
      : "THE BUILDING CODE\n(nothing matched — do not invent a clause)",
    mfrHits.length
      ? `THE MANUFACTURER'S MANUAL\n${mfrHits.map((p) => `--- PAGE LABEL: ${manufacturerLabel(p)}\n${excerpt(p.text, q, 2200)}`).join("\n\n")}`
      : "THE MANUFACTURER'S MANUAL\n(nothing matched — do not invent a manufacturer figure)",
    history.length
      ? // "came up on N inspections", not "failed N times": one open item rides
        // the council's carried-forward register across every later report, so
        // appearances are inspections it stayed open through, not fresh
        // failures. The first→last span says how LONG it stayed open, which is
        // the number that actually costs money at CCC time.
        `THIS COMPANY'S OWN HISTORY — pulled up on these before\n${history
          .map((h) => {
            const span = h.firstSeen && h.lastSeen && h.firstSeen !== h.lastSeen ? `, open ${h.firstSeen} → ${h.lastSeen}` : h.lastSeen ? `, last ${h.lastSeen}` : "";
            return `- ${h.title} [${h.category}] — came up on ${h.count} inspection${h.count === 1 ? "" : "s"}${span}`;
          })
          .join("\n")}`
      : "THIS COMPANY'S OWN HISTORY\n(no inspection history filed yet)",
  ].join("\n\n════════\n\n");

  // Lead with the user's own words. When a code is passed too, it's added as
  // context — never INSTEAD of the title, or a narrow request ("fire-rated wall
  // first layer") tagged with a broad code (IPB) loses its subject and the model
  // writes the whole pre-line inspection instead of the fire wall.
  const codeLabelName = opts.inspectionCode
    ? `${opts.title} (being checked at the ${codeName(opts.inspectionCode) ?? opts.inspectionCode} / ${opts.inspectionCode} inspection — but keep the checklist focused on "${opts.title}", not the whole inspection)`
    : opts.title;

  const anthropic = new Anthropic({ maxRetries: 2 });
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: ITEM_LIST_SCHEMA as unknown as Record<string, unknown> } },
      system: GEN_SYSTEM,
      messages: [{
        role: "user",
        content: `Write the pre-inspection checklist for: ${codeLabelName}${
          opts.location ? `\nSCOPE: this check covers ${opts.location.label} ONLY — write items for that location, and skip anything that clearly belongs elsewhere on the job.` : ""
        }\n\n${sources}`,
      }],
    });
    const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(text) as { items?: Record<string, unknown>[] };
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map((r) => ({
        title: String(r.title ?? "").trim(),
        detail: String(r.detail ?? "").trim(),
        source: ["plans", "code", "manufacturer", "history"].includes(String(r.source)) ? String(r.source) : "manual",
        sourceRef: String(r.source_ref ?? "").trim() || null,
        category: isCategory(r.category) ? r.category : "Other",
      }))
      .filter((r) => r.title.length > 2);
    // The council's own hard dependencies go FIRST, ahead of anything the
    // model found. "Pre-line building cannot be approved until pre-line
    // plumbing has been completed" isn't a detail to check on the wall — it
    // decides whether the inspection can happen at all, and getting it wrong
    // is a wasted fee plus a re-book.
    const blockers = blockersFor(opts.inspectionCode).map((b) => ({
      // A commercial-only rule gets labelled, not asserted. The council draws
      // membranes-before-cladding on the commercial chart only, and the same
      // booking code (ICL) covers both — so saying it flatly on a house would
      // be putting words in the council's mouth.
      title: `${b.needs} must have passed first${b.scope === "commercial" ? " (commercial jobs)" : ""}`,
      detail: b.note,
      source: "code",
      sourceRef: "Auckland Council · Building consents booklet AC1229 V13 · typical order of notifiable inspections",
      category: "Other" as const,
    }));
    if (blockers.length) items.unshift(...blockers);

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

// ─── Safety plan (SWMS / JSA) ────────────────────────────────────────────
//
// Same interactive checklist, different source of authority. A Safe Work Method
// Statement / Job Safety Analysis is grounded in the Health and Safety at Work
// Act 2015 and WorkSafe NZ good practice, not in the site's drawings — so it has
// no retrieval, just the task. Each item is a significant hazard with its
// controls in hierarchy-of-controls order. It is deliberately framed as a DRAFT:
// under HSWA the PCBU must finalise it WITH the workers doing the job.

const SWMS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "The hazard, in the context of the task, under 14 words. Start with the risk: \"Fall from the first-floor slab edge during formwork\"." },
          detail: { type: "string", description: "The practical controls, in HIERARCHY-OF-CONTROLS order (eliminate first, PPE last). Put the real control in, not \"be careful\". One to three sentences." },
          source: { type: "string", enum: ["hsw", "code"], description: "\"hsw\" for a HSWA duty or WorkSafe good-practice control; \"code\" only when a specific NZ standard genuinely governs it." },
          source_ref: { type: "string", description: "The named source, e.g. \"WorkSafe: Working at height\" or \"HSWA 2015 — hierarchy of controls\". NEVER invent a regulation clause number or an exposure/distance figure you are not sure of; name the guidance instead." },
          category: { type: "string", description: "The hazard area, e.g. \"Working at height\", \"Electrical\", \"Excavation\", \"Mobile plant\", \"Manual handling\", \"Dust / silica\", \"Hazardous substances\", \"Public / site access\", \"Fire / hot work\"." },
        },
        required: ["title", "detail", "source", "source_ref", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

const SWMS_SYSTEM = `You write a site-specific Safe Work Method Statement (SWMS / JSA) for ONE New Zealand construction task, the way an experienced site safety lead drafts it before the job starts.

Ground everything in the Health and Safety at Work Act 2015 (HSWA) and WorkSafe New Zealand good-practice guidance. Aotearoa New Zealand only — never Australian or UK rules.

METHOD
- Identify the SIGNIFICANT hazards for THIS specific task — the ones that actually hurt people on this kind of work. Do not pad with generic office-safety items.
- For each hazard, give practical controls in the HIERARCHY OF CONTROLS order: eliminate the hazard first, then substitute, then isolate / engineer it out, then administrative controls (method, sequencing, training, exclusion zones, permits, spotters), and PPE LAST as the backstop — never PPE as the only control.
- Lead with the highest-harm hazards: falls from height, electricity, excavation collapse, mobile plant and site traffic, structural or trench collapse — then the rest.
- Where a well-established NZ standard or WorkSafe good-practice guide genuinely governs a control, name it (working at height, excavation, scaffolding, confined spaces, silica/dust, hazardous substances, hot work, temporary works, mobile plant). Do NOT invent a regulation clause number, an exposure limit or a distance you are not sure of — name the guidance instead.

RULES
- 8 to 16 items. This gets briefed to the crew at the start of the shift, not read like a manual. Ruthless beats exhaustive.
- Put the actual control in the item. "Work safely" and "be careful" are not controls.
- Write like a site safety lead talking to the crew. No filler, no "ensure that", no "it is recommended".
- This is a DRAFT starting point. Under HSWA the PCBU must complete and agree it WITH the workers doing the job, adding the site-specific detail. Never imply it is final or that it replaces that conversation.`;

async function generateSwmsItems(task: string): Promise<GenerateResult> {
  const anthropic = new Anthropic({ maxRetries: 2 });
  try {
    const resp = await anthropic.messages.create({
      model: SWMS_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SWMS_SCHEMA as unknown as Record<string, unknown> } },
      system: SWMS_SYSTEM,
      messages: [{ role: "user", content: `Write the Safe Work Method Statement for this task: ${task}` }],
    });
    const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(text) as { items?: Record<string, unknown>[] };
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map((r) => ({
        title: String(r.title ?? "").trim(),
        detail: String(r.detail ?? "").trim(),
        source: r.source === "code" ? "code" : "hsw",
        sourceRef: String(r.source_ref ?? "").trim() || null,
        // Safety hazard areas are their own vocabulary, not the inspection
        // CATEGORIES, so keep whatever the model named (used only for the dot).
        category: String(r.category ?? "").trim() || "Other",
      }))
      .filter((r) => r.title.length > 2);
    if (!items.length) {
      return { ok: false, reason: "empty", message: "I couldn't draft a safety plan for that one. Try describing the job in a bit more detail — the work, where it is, and any plant or height involved." };
    }
    return { ok: true, items };
  } catch (e) {
    console.error("swms generation failed:", e);
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
    location?: string | null;
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
      location: input.location ?? null,
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

  // Drawing pins on these items (Feature 4) — one query, so the UI can show
  // pinned state without a round-trip per item.
  const pins = items.length
    ? await db
        .select({ id: planPins.id, recordId: planPins.recordId, doc: planPins.doc, page: planPins.page, x: planPins.x, y: planPins.y, label: planPins.label })
        .from(planPins)
        .where(and(eq(planPins.projectId, head.projectId), eq(planPins.recordType, "checklist_item"), inArray(planPins.recordId, items.map((i) => i.id))))
    : [];
  const pinsByItem = new Map<string, typeof pins>();
  for (const p of pins) {
    const list = pinsByItem.get(p.recordId) ?? [];
    list.push(p);
    pinsByItem.set(p.recordId, list);
  }

  return {
    checklist: head,
    items: items.map((it) => ({ ...it, photos: byItem.get(it.id) ?? [], pins: pinsByItem.get(it.id) ?? [] })),
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
