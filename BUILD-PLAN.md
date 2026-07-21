# Soterra — the agreed build

_Locked 2026-07-22. This is the spec for the next thread. Everything here is decided unless marked ❓._

> ## ▶️ START HERE (new thread)
>
> **Build everything in this plan EXCEPT §3 (MBIE determinations).** Adam will download those manually when he's home; the automated route is blocked by Imperva. Nothing else depends on them.
>
> **Adam is away and wants this built autonomously.** Order is fixed:
> **Step 0 (company layer) → 1 (history learner) → 2 (Insights page) → 3 (checklist engine) → 4 (CCC checklist).**
>
> Two things to bring to him rather than guess:
> 1. The **category mapping** (council codes → the 12 groups) — draft it from the 27 real reports in `All inspection reports/Council/`, then have him check it. He'll spot in seconds what would take an hour to get wrong.
> 2. **Company creation at signup vs first project** (❓ open item 3) — pick the sensible default (company at signup), build it, flag it.
>
> Deploy as you go: `cd soterra-web && npm run build && npx vercel deploy --prod --yes`, then verify the live URL. Commit after each piece.

---

## What we're building, in one line

> **Company-level failure history → drives an assistant-generated inspection checklist you tick off on the phone with photos → stored forever on the calendar event.**

Plus MBIE determinations as extra knowledge, and a CCC checklist using the same engine.

---

## 🔴 STEP 0 — The company layer. Nothing else starts until this is done.

**Today there is no company concept.** `projects` has no `companyId`; access is per-project membership only (`resolveProjectId` checks `projectMembers`). Pooled history has no boundary to live inside.

**If Hawkins ever sees Kalmar's failure data, that is not a bug — it ends the business.**

Required:
- `companies` table
- `projects.companyId` (not null)
- `companyId` **derived server-side from the authenticated user's verified project** — never from a client header, never from a request body
- Every history/insights query filtered by it, enforced in the data layer so it cannot be forgotten
- A test that proves company A cannot read company B's rows

Do this **first**, while there is no data to migrate. Half a day now, a nightmare later.

> Note: `resolveProjectId` already takes the project from the `x-soterra-project` header and *then verifies membership* — that pattern is fine. Derive `companyId` from the **verified project**, never from a second header.

---

## 1. History learner — port "The Brain", but far simpler

The existing code is `api/analyze-reports.py` (393 lines, header: *"Vercel Serverless Function: The Brain"*) and `api/extract-issues.py`. PDF in → structured inspection items → Supabase → fed many website pages.

**We do NOT want the million little items any more.** New scope:

- Inspection report PDF in → **failed items only** → tagged with a **category** → stored at **company level**
- One count per category. That's it.

**Categories — use the council's own, they are still the dominant inspector.** Council codes are primary (IFO foundation, ISF slab, IFG framing, ICA cavity wrap, ICL cladding, ITK waterproofing, IDT drainage, IPP plumbing, IPB pre-line, IPL post-line, IF1/IF2 final). Roll up to these groups:

`Structural` · `Weathertightness / Cladding` · `Fire` · `Electrical` · `Plumbing & Drainage` · `Mechanical` · `Interior / Linings` · `Access & Barriers` · `Site / External` · `Acoustic` · `Seismic` · `Architect`

(add more as they appear — do not force-fit)

**Insights page — the ONLY new page.** Count of failed items per category, company-wide. Adam's prediction to check against real data: *the top electrical item will be seismic clearances.*

⚠️ `Inspections/anonymize.py` already exists — the council PDFs contain real names, emails and phone numbers. **Anonymise on ingest.**

---

## 2. Checklists — attach to the calendar event, no new page

**An inspection IS a calendar event.** So:

1. Book the inspection → calendar event (already works)
2. Assistant generates the checklist → attached to that event
3. Tick through it on the phone, attach photos, add notes
4. Stays on the event forever

**Retrieval is assistant-first** (Adam, 2026-07-22): *"what failed on the last cavity wrap?"* beats scrolling a calendar. Needs a small tool so the assistant can find past inspections and their results.

**The Insights page does both jobs** — top failed items per category on top, list of past inspections underneath. Still **one new page total**; the list is just the bottom half.

Checklist item sources, in order:
- **This project's drawings** (`search_plans`) — every *"as per plan"* item
- **The Building Code** (`search_code`) — every numeric item (150mm upstand, 100mm max hole, barrier heights)
- **This company's history** (`search_history`) — what we personally keep failing

Same engine, second type: **CCC checklist**. Different item source (the CCC evidence pack: energy work certificates, producer statements, LBP records, as-built services plans, truss documentation, cladding/waterproofing installation certificates), same tick-through UI.

---

## 3. MBIE determinations — extra knowledge

1,000+ published, free PDFs, covering structural, fire, weathertightness, durability, change of use, consents, access, natural hazards.

**Value:** they show how the Code was actually applied when someone argued about it — the gap between Code text and site reality. *"Know what to avoid."*

### How far back? — Adam's concern is right, rules change

**Recommendation: 2019 onwards (~7 years).** Rationale:
- Post-dates the worst of the weathertightness-era rule churn
- H1 energy efficiency changed hard in 2021–23 — older energy determinations are stale
- Recent enough that cited Acceptable Solutions are current or one edition back
- Still a few hundred documents — plenty

**Two safety rules to build in regardless of cutoff:**
1. **Always show the year in the citation** (*"Determination 2021/045"*) so currency is visible.
2. **A determination decides one specific case.** The assistant must cite it as *guidance*, never as the rule, and must defer to the current Acceptable Solution for any figure. MBIE says this themselves.

### Do we actually need to download them? — YES

Live-fetching at question time does **not** work, for two reasons:
1. It would hit **the same Imperva block** that refused curl, the browser and WebFetch.
2. Even if it didn't: slower (seconds per question), costs per question, no citation control, and retrieval quality depends on a search engine's index rather than the full text.

Downloading and indexing is the Building Code pattern, which already scores 15/15 with exact citations. Same `lib/indexPdf.ts` pipeline.

**But we do not need all 1,000.** The last **2–3 years** (a couple of hundred files) is plenty to prove value and can be extended later. Adam downloads to a folder (same as `All inspection reports/`), we process.

### 🔴 Automated download is BLOCKED — Adam will do it manually

`building.govt.nz` sits behind **Imperva/Incapsula**. Tried and refused: `curl`, the sandboxed browser (empty DOM), and WebFetch (worked once from cache, now blocked).

**I deliberately did not push past it.** Bulk-pulling hundreds of files from a WAF-protected government site, unsupervised, is not a call to make alone — the site is explicitly signalling it doesn't want automated access.

Options, best first:
1. **Ask MBIE.** They may provide a bulk set or a data feed on request. Cleanest, and legitimises the use.
2. **Paced download with Adam present**, via his real logged-in browser, at a considerate rate.
3. Manual download of a starter set (say the last 2 years) to prove the value before investing in the full corpus.

Once the PDFs are local, **ingestion is trivial** — it's the same `lib/indexPdf.ts` pipeline as `code_pages`, into a new `determination_pages` table with a `search_determinations` tool.

---

## 4. ❌ Explicitly NOT building — and why

| Dropped | Reason |
|---|---|
| **RFI previous-answer lookup** | 🔴 **Adam's call, and he's right.** An RFI goes to the *consultant*; the main contractor can't make that decision. A previous answer may sit under a different plan revision or a different engineer's requirement. Surfacing "we asked this before" is **a silent killer**. **RFI drafting help stays. History lookup does not get built — do not wire `search_history` into RFI drafting.** |
| Variation capture | Procore already does it |
| CCA / payment & retention deadlines | Different product, different buyer (QS / commercial). Good later, not now. |
| Health & safety | Well served — HazardCo, Site App Pro, SafetyCulture |
| Estimating, Gantt, accounting, BIM, timesheets, as-builts/O&M | See PRODUCT-STUDY.md §7 |

---

## Build order

| # | Piece | Effort | Blocks |
|---|---|---|---|
| **0** | **Company layer + isolation test** | ~½ day | **everything** |
| 1 | Port The Brain → failed items by category, company-scoped | ~1 day | Insights, checklists |
| 2 | Insights page (counts per category) | ~½ day | — |
| 3 | Checklist engine: schema, assistant generation, tick UI, photos | ~1½–2 days | — |
| 4 | CCC checklist (same engine, new item source) | ~½ day | 3 |
| 5 | Determinations ingest + `search_determinations` | ~½ day once files are local | download unblocked |

**~4–5 days focused.**

---

## Open items ❓

1. **Determinations download route** — ask MBIE, or paced/manual? Needs Adam.
2. **Category mapping** — council codes → the 12 groups. Draft it from the 27 real reports in `All inspection reports/Council/`, then have Adam correct it. He's the domain expert.
3. **Does a company get created at signup, or does the first project create one?** Affects onboarding. Suggest: company at signup, projects belong to it.
4. **Photos** — site photos may contain people. Retention and consent worth a decision before shipping.

---

## Carried over — CLOSED by Adam 2026-07-22

Adam's call, recorded and not to be re-raised:
- **Shared Anthropic org wallet** — fine; Montázs and Kalvio will have very small usage, essentially all spend will be Soterra. (Only residual: an empty balance stops the assistant answering, so auto-reload is worth a click. Mentioned once, dropped.)
- **Clerk secret key rotation** — Adam is comfortable, no action.

Still genuinely open, but not part of this build:
- Signed release APK + keystore for sideload distribution (the `/install` PWA works today).
- Web push, so reminders fire on iPhone and on the web (currently Android-app only).
