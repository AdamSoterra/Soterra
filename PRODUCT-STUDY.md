# Soterra — what to build next

_A master study, 2026-07-22. Written to answer: knowing the plans, the code and (soon) the company history, what else would make this genuinely more valuable to a construction business?_

**Read this first:** the strongest finding in this study did not come from the internet. It came from 27 council inspection reports sitting in this repo. See §1.

---

## 0. Honest status of the research

A wide parallel research sweep was run across NZ construction law, where builders lose money, the tech landscape, H&S/QA, daily workflows, handover, and AI capability. **It hit a hard session API limit and roughly half the streams died mid-flight.** `legislation.govt.nz` also blocks automated access throughout.

| Area | Evidence quality |
|---|---|
| Council inspection reality | ⭐ **First-party, verified in this repo** |
| Our own corpus/data-model gaps | ⭐ **First-party, measured** |
| NZ liability reform (proportionate liability) | ✅ Verified, official sources |
| HSWA penalties + real prosecutions | ✅ Verified, WorkSafe |
| CCC pack + the 20-day clock | ✅ Verified, MBIE |
| Council inspection rules, defect precedence | ✅ Verified, MBIE/Auckland Council |
| H&S + prequal market pricing | ✅ Verified, vendor sites |
| Retentions regime | ✅ Verified (secondary/legal commentary) |
| Competitive: Dalux, AU landscape | ✅ Verified |
| Company-memory category + why past attempts failed | ✅ Verified, peer-reviewed + vendor sources |
| AI trust, professional standards, insurance | ✅ Verified (RICS, Engineering NZ, Masterspec, Verisk) |
| **Day-in-the-life of site roles** | ❌ **Not gathered** |
| **Rework/dispute cost data** | ⚠️ Partial, mostly secondary |
| **Why construction tech fails to get adopted** | ⚠️ **Partly answered — see §4b** (knowledge-management slice only) |
| **AI capability limits in construction** | ❌ Not gathered |

Where something is an untested hypothesis, it says so. **The #1 recommendation rests on first-party data and does not depend on any of the missing streams.**

---

## 1. ⭐ THE FINDING: your own inspection reports

`All inspection reports/Council/` holds **27 Auckland Council inspection outcome statements for one consent** (a Hobsonville multi-unit project), spanning **12 Dec 2023 → 3 Sep 2024, 266 days**. Outcomes are encoded in the filenames and independently counted:

| Outcome | Count |
|---|---|
| Partial Pass | 14 |
| Pass | 6 |
| **Fail** | **4** |
| Completed | 3 |

**Only 22% were a clean pass. 67% (18 of 27) required a return visit.**
**Postline (IPL) alone consumed 10 visits.**

### Why they failed — read the actual line items

From the failed cavity-wrap inspection (21 Feb 2024), verbatim:

> 1. Flashings at junctions ( Fail )
> 2. Head/ sill/ jamb flashings/ wanz support bars ( Fail )
> 3. **Cavity battens as per plan** and installed correctly ( Fail )
> 4. Deck/balcony: saddle flashing installed correctly ( Fail )
> 5. **Deck/balcony: threshold step down as per plan** ( Fail )
> 6. **Deck/balcony: membrane support upstand 150mm minimum** ( Fail )

The inspector's own summary: **_"Noticed a lot of critical junctions not as per detail."_**

Elsewhere in the same report: *"membrane upstands on concrete needs termination bars **as per detail**"* · *"Big holes in braces over the **maximum 100mm dia /90x90 size** for gib bracing"* · *"Timber IT walls first layer GBTLA 60 needs **41mm screws at 300 centres**"*.

**Every single failed item is one of two things:**
- **"as per plan" / "as per detail"** → a drawing lookup → **`search_plans`**
- **a numeric figure** (150mm upstand, 100mm max hole, 41mm screws @ 300crs) → a code/spec figure → **`search_code`**

Auckland Council's checklist wording is literally `"<item> as per plan"` and `"as per manufacturers specifications"`, repeated dozens of times across the 27 reports. The checklist is defined by the *Auckland Council Inspection Code of Practice*.

### Three details that sharpen it

1. **"Consent documents on site: Yes."** They *had* the drawings. Access was never the problem. **Nobody checked against them before the inspector arrived.** So the product isn't document access — it's the *check*.
2. **A failure escalates.** The report ends `NEXT INSPECTION TO BE IME SITE MEETING`. That's a step change in cost, not just a repeat visit.
3. **Auckland's booking rules make each retry expensive**: must book before **1pm** for next day; cancel after midday the day before and you're **charged the full fee anyway**; max **4 open inspections** per consent; inspections over 45 min may incur extra charges.

> ⚠️ These PDFs contain real names, emails and phone numbers of council and site staff. **Anonymise before this goes near a demo, a pitch deck, or any training data.**

---

## 2. What Soterra is today (capability audit)

Four jobs, per the live system prompt: **plan reader** (with revision-supersession), **NZ Building Code**, **general construction expert** (+web search), **calendar & tasks**. Plus RFI drafting, photo/PDF reading, phone reminders, bulk operations.

**Data model — 9 tables:** `projects, projectMembers, events, tasks, chatThreads, chatMessages, usageCounters, planPages, codePages`.

Structural gaps:
- **No RFI record.** The assistant drafts a good RFI, then it evaporates into a chat thread — no number, no status, no chase, no answer filed back.
- **No document store beyond plan PDFs.** Photos are read and discarded.
- **No company layer.** Everything is `projectId`-scoped, so cross-project history is impossible without new structure.
- No entities for defects, variations, or a site diary.

**But** `events` already carries `title, startsAt, endsAt, location, kind, visibility, assignee, reminderAt` — already a good container for "an obligation with a date". Several recommendations below need **almost no new schema**.

### Corpus coverage — deep on technical, empty on commercial

Measured against the live 3,274-page `code_pages`:

| Topic | Pages |
|---|---|
| Building consent process | 471 |
| Inspections | 188 |
| Code Compliance Certificate | 76 |
| LBP / restricted building work | 71 |
| Health & safety (HSWA) | **11** |
| Producer statements PS1–PS4 | **7** |
| Construction Contracts Act / payment claims | **1** |
| **Retentions** | **0** |

**Soterra can tell a builder the fire rating of a wall. It cannot tell him when his payment schedule is due — and the payment schedule is what bankrupts builders.**

Ingestibility: **CCA 2002 and HSWA are free legislation → ingestible.** **NZS 3910 is a paid Standards NZ document → NOT ingestible**; any contract feature must read the customer's own uploaded contract.

---

## 3. The director's-eye view: what actually threatens the business

| Worry | Can a document-reader + calendar touch it? |
|---|---|
| **Will I get paid?** (payment claims, retentions, final account) | ✅ Strongly — deadline tracking |
| **Will I get sued?** (defects, weathertightness, 10-yr longstop) | ✅ Strongly — evidence trail |
| **Will someone get hurt?** (and my personal liability) | ⚠️ Partly — records, notifications |
| **Will we finish on time?** (LDs, EOT claims) | ⚠️ Partly — contemporaneous records |
| **Are we making money on this job?** (variations) | ✅ Yes — capture at the moment |
| Do I have the right people? | ❌ No |

**Director personal liability is the sharpest emotional lever and we're not using it.** HSWA s44 officer due diligence is a **personal, non-delegable** duty. Verified penalties:

| Offence | Individual | Officer / individual PCBU | Body corporate |
|---|---|---|---|
| s47 reckless conduct | 5 yrs prison / $300k | **5 yrs prison / $600k** | **$3,000,000** |
| s48 exposes to serious risk | $150k | $300k | **$1,500,000** |
| s49 failure to comply | $50k | $100k | $500k |

Real NZ construction prosecutions: **$450,000** (cladding sheet into 11kV lines, worker electrocuted and fell 3.7m) · scaffolder into 33kV lines, **bilateral arm amputations** · **$275,000** trench collapse at 3m, *also charged for failing to notify an excavation over 1.5m* · 6m roof fall, no edge protection · a fatality from a door installed 13 years earlier.

Construction is **~15% of all NZ work-related fatalities and serious injuries**. WorkSafe ran **6,500+ construction assessments in 2024/25** — about a third of its frontline activity.

---

## 4. 🔴 The structural tailwind: NZ is abolishing joint-and-several liability

**The Building Amendment Bill passed first reading 2 July 2026** and is at select committee. Intended effect **2028**, one-year lead-in. It replaces **joint and several** with **proportionate liability**. Bundled in: **mandatory home warranties** (1-yr defects + 10-yr structural, ~0.5% of build cost), **mandatory PI insurance** for designers/engineers, **LBP penalties doubled** ($10k→$20k, 12→24 months).

**Why this changes what Soterra is:**

Under joint and several, when a building fails the council has the deep pockets, pays, and everyone shelters behind it. Under proportionate liability, **every party pays only their own share — so every party must be able to prove what they did and didn't do.**

**Contemporaneous evidence stops being good practice and becomes a financial asset.**

Soterra is already an evidence machine: cited answers, dated decisions, revision-supersession, a record of what was asked and what was answered. *"I can show what the drawing said the day I built it, what I asked, and what I was told"* becomes worth money.

**Positioning shift this unlocks: from "ask your plans" (convenience) → "prove what you built and why" (liability defence).** Same product, far higher stakes, far higher willingness to pay.

⚠️ **Message honestly: a Bill at select committee, not law. Say "proposed reform, expected 2028."** Also checked: **no active proposal** to change the s393 10-year longstop.

---

## 4b. ⭐ The history layer: the category is open, and the old failure has a fixable cause

Adam's instinct to add company history is right, and better supported than expected.

### Nobody is actually doing it for contractors

Every funded construction AI vendor does retrieval over **one live project**, not across a firm's completed jobs:
- **Trunk Tools** ($40M Series B, Insight Partners, Jul 2025) launched **Cortex** on 17 June 2026, marketed as *"the brain of construction"* and explicitly pitched at *"institutional knowledge that walks out the door with experienced workers."* **But the shipped scope is active projects** — it ingests from Procore, Autodesk, SharePoint, Box, Dropbox. Three sources checked; none claim completed-project retrieval. **They are marketing corporate memory without shipping it** — which tells you the demand narrative is validated and the build isn't done.
- **Document Crunch** ($21.5M Series B) launched a *"project-level"* risk platform, June 2026. Note the name.
- **Procore's** five AI agents (Deep Search, Submittal Reviewer, RFI, Daily Log, Contract Review) were still **private beta as of 21 June 2026** — "none of these agents are live for general customers yet."
- Buildots, Bild, Aphex, Versatile: progress vision, takeoff, scheduling, sensors. Not memory.

**The only shipping cross-project memory product is Synthesis** (Knowledge Architecture, 130+ firms) — but it serves **A/E design firms** and leans on Deltek/Unanet ERP records. Contractor-shaped memory is genuinely open.

Horizontal enterprise-search vendors (Glean, Hebbia, Dashworks) have **no construction case studies**. Construction is not a served vertical.

### The 30-year failure — and why the diagnosis is encouraging

Lessons-learned systems have failed in construction since **Latham (1994)** and **Egan (1998)**. The evidence on *why*:

**Debs & Hubbard (2023)**, *Construction Economics and Building* — 12 interviews + 39 questionnaires, US contractors:
- **87%** of firms "rarely or never" share evaluation reports with designers/architects
- Only **26%** make lessons-learned results available to all employees; **23%** report no availability at all
- The two dominant capture channels are **email and meetings** — *"difficult to retrieve in the long term"*; information sits *"locked in archives"*
- Cultural barrier: fear of *"airing your dirty laundry"*
- Structural barrier: teams disperse immediately, so consolidation never happens

**Carrillo, Ruikar & Fuller (2013)**, *IJPM* — the canonical citation. The binding constraint was never capture. It was delivering the lesson *"at the most appropriate time, in the most appropriate format"* — i.e. **retrieval at point of need**.

**This matters commercially: the diagnosed cause is precisely what RAG fixes.** The old systems taxed you to *write a lesson into a form*, then failed because nobody could find it again. Retrieval over what already exists removes the capture tax, and semantic search removes the "you had to know the keyword" failure.

⚠️ **Don't overclaim.** There is **no published study of RAG over a construction firm's historical archive**. And RAG makes messy data *searchable*; it does not make absent data *exist* — scanned drawings without OCR, superseded revisions with no version signal, and missing cost structure are still fatal. **This is the strongest available argument that this time is different. It is not proof.**

**Which reinforces recommendation #3:** the RFI loop generates clean, structured, dated history as a by-product — sidestepping both the capture tax and the archive-quality problem.

## 4c. ⭐ Trust is falling, and the professional bodies have written our spec for us

**The single most important number for positioning: Autodesk's State of Design & Make shows trust in AI among construction respondents fell from 80% to 68% year on year — down 14 points.** RICS (n=2,200+, Sep 2025): **45% of organisations report no AI use at all; just 1% have scaled it.**

**The trust curve inverted in 2025.** Selling "AI" is now a headwind. Selling *verifiable, cited, auditable answers* is the tailwind.

Three bodies have effectively written Soterra's requirements spec:

- **RICS — mandatory standard**, published 17 Nov 2025, **effective 9 March 2026**: *"The surveyor remains accountable for every piece of professional advice, regardless of the tools used."* Requires a **named qualified professional** accountable for output reliability, AI use disclosed in **Terms of Engagement**, and records sufficient to demonstrate compliance. Explicitly warns against **automation bias** — *"it must be true because the computer says it's true."*
- **Engineering New Zealand** (July 2025): **never rely solely on AI for code compliance or safety assessments**; client consent before using AI on project data; and **a documentation trail showing which standard version and method was used.**
- **Masterspec** (NZ's dominant spec platform), 23 April 2026, coined **"AI slop"**: *"content that looks professionally written but lacks reliable provenance, contains incorrect references, or reflects assumptions that do not align with New Zealand requirements."* Its proposed control set is **verification and traceability** — identify the source, confirm review by a qualified practitioner, demonstrate currency against NZ standards.

**That is a description of what Soterra's audit already does.** Citation with version provenance has moved from nice-to-have to professional requirement.

**Insurance is moving too, ahead of any evidence.** Verisk/ISO published generative-AI exclusion endorsements (CG 40 47, CG 40 48, CG 35 08) effective **1 January 2026**. Yet **no AI design claim has been reported anywhere** — Mills & Reeve (Apr 2025): *"there have been no reported judgments so far in relation to the use of AI in a professional indemnity context."* The exclusions are **anticipatory, written before any claims experience**, which is usually when they're broadest.

➡️ **Product implication: build the audit trail in from day one and it's a moat; retrofit it and it's a liability.** Soterra already cites. What's missing is *version provenance* — recording which revision of the drawing and which edition of the code an answer came from. That's a small change with outsized commercial value.

## 5. Competitive position

**Nobody does cited Q&A across drawings + specs + building code.** Verified across the AU/NZ landscape (Archistar, Assignar, Buildxact, Felix, EstimateOne, RIB CostX, Calcs.com, Matrak, Ynomia, ProcurePro, Uptick, Presien, Buildertrend, Procore ANZ) — the closest partial matches are Matrak's AI takeoff (materials from drawings) and ProcurePro's BidLevel (structures supplier quotes). **None do general cited Q&A over a full drawing + spec + code set.**

**Dalux** (Europe's largest, 1.7m users, 750 staff) is the sharpest comparison. Its AI Assistant reached GA June 2026 — and its own help centre says: *"the AI Assistant is designed to help you understand **one document at a time**. It does not search across folders, projects, or multiple documents."* PDF-only citations, and self-declared weak on **image-heavy PDFs and complex multi-column layouts** — i.e. exactly what a drawing set and a spec book are. **No ANZ office, reseller, or case study.** Its real weapon is a free unlimited-user BIM viewer + free snagging, which sets a price floor on basic drawing access wherever it lands.

**Two moats, in order:**
1. **The NZ regulatory layer.** The council checklist is defined by the *Auckland Council Inspection Code of Practice*. Only **1,239 NZ firms turn over $10M+** — the market is far too small for a US or European vendor to build NZ-specific compliance. That is a durable structural moat, not a feature lead.
2. **The audit.** 15/15 correct, 15/15 cited, 0 fabrications. In a liability-sensitive industry that is a *sellable* asset, and it's the hard-ROI answer to the 2026 AI-renewal cull.

**Pricing signal:** NZ H&S/compliance software charges **NZ$119–299/mo** (HazardCo, Site App Pro, Safe365). Prequalification is a *recurring annual* tax on every subbie: SiteWise **$250–795+GST/yr** (+$100 per failed attempt), Qualify365 **$149–1,399**, Site Safe membership **$233/yr**, Site Safety Card **$199.50/person**. **We are priced below this market.** Note SafetyCulture bundles AI into every tier including free — **AI alone is not differentiating; NZ compliance knowledge is.**

---

## 6. The recommendations

### 🥇 #1 — Pre-inspection check
**The only recommendation backed by first-party data, and it uses what already exists.**

Before an inspection, the assistant runs that inspection type's checklist. Every *"as per plan"* item → `search_plans`. Every numeric item → `search_code`. It reports what it can verify, what it can't, and what looks wrong — with citations.

- **Evidence:** 22% clean-pass rate on a real consent; 100% of failed items were drawing lookups or code figures; the drawings were *on site* and still nobody checked.
- **Build cost:** low. Both tools exist. Needs a checklist per inspection type (from the Auckland Council Inspection Code of Practice) and a report view.
- **Why no incumbent has it:** requires project drawings *and* a jurisdiction's code corpus retrieved together. Procore and Autodesk store documents and route workflow; they don't comprehend drawings. And the checklist is a NZ council artefact with no commercial relevance to a US vendor.
- **The pitch:** *"Nobody fails postline ten times."*

### 🥈 #2 — Obligations: read a document, put the dates in the calendar
Soterra holds two things almost nobody pairs — a **document reader** and a **calendar with phone reminders**. The bridge is the product:

> Read a document → extract every dated obligation → put it in the calendar → remind the right person.

Apply to: the **consent** (conditions, inspection sequence, 12-month start, 2-year CCC limit), the **contract** (payment claim/schedule dates, notice periods), **RFIs** (response-required-by → chase), the programme.

- **Evidence:** consent RFIs suspend the statutory clock (64.6% of consents get one, 11 working days median). Auckland requires booking before 1pm or you lose the day. Missing a payment schedule under the CCA is famously fatal.
- **Build cost:** low-to-moderate — `events` is already the right shape. **Needs the CCA 2002 ingested** (free legislation; 1 page today).
- **The pitch:** *"never miss a deadline that costs you money."*

### 🥉 #3 — Close the RFI loop (and it bootstraps the history layer)
Give RFIs a record: number, status, sent/answered, response-due date in the calendar, chase when overdue, and file the answer back against the drawing.

**This is also the answer to the cold-start problem in the "company history" idea.** A knowledge base with nothing in it is worthless, and no builder will retro-upload five years of records. **The RFI loop generates the history as a by-product of daily use.** After one job you can answer *"has anyone asked this before?"* — which is Adam's Layer-2 vision, bootstrapped rather than requested.

- **Build cost:** moderate — one new table + UI.

### Then (ranked, weaker evidence)
4. **Variation capture** — turn a verbal/WhatsApp instruction into a written variation citing the contract clause and affected drawing, at the moment it happens. NZ sources consistently name verbal variations as a top dispute cause. *Caveat: the WhatsApp capture mechanism is an assumption — unverified.*
5. **CCC evidence pack** — the council's 20-working-day clock **pauses on any missing document**, and the pack is multi-party (truss supplier, sparky, gasfitter, cladding subbie, engineer, every LBP). The builder holds none of it at source. Retentions and final payment sit behind it. Know what's required → what's arrived → chase the rest → watch the clock.
6. **Defect capture from a photo** — the MBIE defect test is a *document-precedence walk* (contract → consent → manufacturer specs → tolerance schedule → NZ Standards → MBIE tolerances guide), which is exactly what retrieval does well. 12-month liability window is a calendar object.
7. **Site diary** — mostly derivable from data already held (events that happened, tasks done, photos, weather). It's the contemporaneous record that wins EOT claims. *Crowded category; low evidence.*
8. **H&S notification triggers** — e.g. *"you're digging 3m — that needs a WorkSafe notification"*. Notifiable events are unusually machine-friendly: a closed 12-item list, 5-year retention, 24/7 number. **Caveat: on multi-PCBU sites one party is nominated to notify — never assume it's our user.**

---

## 7. What NOT to build

- **Estimating / takeoff** — crowded (Togal, Handoff, Buildxact, CostX), accuracy-critical, different buyer.
- **Full project management / Gantt** — Procore and Buildertrend own it; enormous surface.
- **Accounting / invoicing** — Xero owns NZ.
- **BIM / 3D** — wrong technology, wrong buyer, and Dalux gives a superb viewer away free.
- **Timesheets** — commodity; Tradify, Fergus, Simpro.
- **As-builts / O&M manuals** — already contested (OmTrak, Operance), and the value accrues to the *owner*, not the builder who'd be paying us.
- **Anything safety-critical answered without a citation.** The audit is the asset; never ship a feature that can't cite.

---

## 8. Open questions — answer before betting big

1. ⚠️ **Why does construction software fail to get adopted?** **Partly answered for the knowledge-management slice** (§4b: the failure was retrieval, not capture — which RAG fixes). Still unanswered for *site tools generally*: does the workflow resist software? Re-run this first — a gap is worthless if nobody will use the fix.
2. **Does a pre-inspection check change the outcome?** Test with one builder on one consent before building it out.
3. **Do any NZ councils accept photo/remote inspection?** MBIE explicitly sanctions it (*"remotely using digital technology"*) — but which councils operationalise it decides whether photos have a regulatory role or only internal QA.
4. **Verify the CCA payment-claim/schedule mechanics from primary source** before designing deadline tracking. `legislation.govt.nz` blocked every automated attempt.
5. **Does Procore's AI actually ship in NZ, and behind which tier?** Load-bearing for competitive positioning.
6. **Day-in-the-life research** — never gathered. We are inferring where the pain is.

---

## 9. The one-line answer

> **Soterra already knows the plans and the code. The next thing to build is the moment those two get checked against reality — the inspection.**
>
> The data says two thirds of inspections need a second visit, and every failure is a question Soterra can already answer.
