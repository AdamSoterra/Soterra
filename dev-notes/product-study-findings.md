# Soterra product study — running findings

_Working notes for the "what should we build next" study. Research in progress._

## ⭐ Finding 1: our corpus is deep on TECHNICAL, empty on COMMERCIAL

Measured against the live `code_pages` corpus (3,274 pages):

| Topic | Pages | Coverage |
|---|---|---|
| Building consent process | 471 | ████ strong |
| Inspections | 188 | ██ some |
| Code Compliance Certificate | 76 | ██ some |
| Licensed Building Practitioner / restricted work | 71 | ██ some |
| **HSWA / health & safety** | **11** | ▌ thin |
| **Producer statements PS1–PS4** | **7** | ▌ thin |
| **Construction Contracts Act / payment claims** | **1** | ▌ thin |
| **NZS 3910 standard contract** | **1** | ▌ thin |
| **Retentions (trust regime)** | **0** | ✗ NONE |

**Soterra can tell a builder the fire rating of a wall. It cannot tell him when his payment schedule is due — and the payment schedule is the thing that bankrupts builders.**

Ingestibility differs and matters:
- **Construction Contracts Act 2002** — legislation, freely available on legislation.govt.nz, Crown copyright with permissive reuse. **Ingestible.**
- **Building Act 2004** — already in the corpus (483 pages).
- **HSWA 2015 + WorkSafe guidance** — legislation + Crown guidance. **Ingestible.**
- **NZS 3910** — a *paid* Standards NZ document. **NOT ingestible.** Any contract-deadline feature must work off the customer's own uploaded contract, not a bundled copy of the standard.

## ⭐ Finding 2: director personal liability is the strongest emotional lever we're not using

HSWA s44 officer due diligence is a **personal, non-delegable duty** on directors. Serious breach: **up to 5 years imprisonment and/or a $600,000 fine for the individual officer** — not the company.

Adam asked me to think like a construction director. This is the thing that actually frightens one.

## ⭐ Finding 3: H&S software out-prices what we planned to charge

**HazardCo NZ** (the incumbent for small NZ builders): Premium **NZ$219/mo + GST** (up to 9 users), Complete **NZ$299/mo + GST** (unlimited users). Annual NZ$2,199 / NZ$2,999.

That is **above** the NZ$79/199/399 ladder we set. Compliance software commands a premium because the alternative is a fine or a prosecution. Worth re-reading our pricing against this.

Other price points: Site Safe Passport NZ$199.50/person (half-day, 2-year card); ConstructSafe NZ$85–120/person (unconfirmed).

## Finding 4: what the assistant does today (capability audit)

Four jobs, per the live system prompt: **plan reader** (with revision-supersession handling), **Building Code**, **general construction expert** (+ web search), **calendar & tasks**. Plus RFI drafting, photo/PDF reading, phone reminders, bulk ops.

Data model — 9 tables: `projects, projectMembers, events, tasks, chatThreads, chatMessages, usageCounters, planPages, codePages`.

**Structural gaps in the model:**
- **No RFI record.** The assistant drafts a good RFI and it then evaporates into a chat thread. No number, no status, no chase, no answer filed back.
- **No document store beyond plan PDFs.** Photos are read and discarded.
- **No company layer.** Everything is `projectId`-scoped, so cross-project history is impossible without new structure.
- No entities for defects, variations, or a site diary.

**But**: `events` already carries `title, startsAt, endsAt, location, kind, visibility, assignee, reminderAt`. That is already a decent container for "an obligation with a date". **The deadline-extraction idea needs almost no new schema** — which makes it unusually cheap for its value.

## Finding 5: real usage so far (n=10 messages, Adam's own)

- "In 2 hours I have a gib delivery pls book it in my calendar" → calendar
- "what are the 30 minutes GIB wall types, fire rated ones" → product/code knowledge
- "what's the latest NZ code on stair riser heights?" → code
- "check for me the tiles thickness in apartment 45 inside bathroom 2" → **plan reading, hyper-specific**
- "who is better messi or ronaldo??" → off-topic probe

Tiny sample, but the tile question is the archetype: the question that otherwise costs a phone call to the PM and a 20-minute interruption at the other end.

## ⭐ Finding 6: the CCC evidence pack — the best-evidenced opportunity so far

Verified against MBIE (building.govt.nz, "Get the build signed off"):

- Council has **20 working days** from application to decide on a Code Compliance Certificate.
- **⭐ The clock PAUSES while the council waits on further information.** That is the exact mechanism by which one missing document becomes an open-ended delay.
- Council **must refuse** the CCC where non-compliance exists — not discretionary.
- Apply "as soon as practical"; if nothing arrives within **2 years** the council chases.
- Duty sits with the **owner**, but in practice the builder assembles it.

The pack councils typically require:
energy work certificates (electrician, gasfitter) · producer statements (engineers) · LBP certificates for restricted building work · specified systems info · as-built services plans · roof truss installation documentation · installation certificates for cladding/waterproofing/tanking · contact details for every professional · proof fees are paid.

**The structural insight: the builder holds none of this at source.** Every document comes from a different party — the truss supplier, the sparky, the gasfitter, the cladding subbie, the engineer, each LBP. It is a *collection-and-chasing* problem against a clock that only starts when the pack is complete, with retentions and final payment sitting behind it.

That decomposes cleanly into: know what's required → know what's arrived → chase the rest → watch the clock. Document-reading + calendar + reminders. Exactly what Soterra already is.

## Finding 7: notifiable events are unusually machine-friendly

Verified (WorkSafe): a **closed 12-item** notifiable-incident list, an enumerated notifiable-injury list, "as soon as possible… by the fastest way possible", a 24/7 number (0800 030 040), a **site-preservation duty** until an inspector permits disturbance, and **5-year** record retention.

Four of the twelve triggers are construction-shaped: falls from height, structure collapse, excavation/shoring failure, plant collapse.

Caveat that matters: on a multi-PCBU site **one PCBU is nominated to notify** — an assistant must not assume its own user is the notifier.

## Finding 8: the defect test is a document-precedence problem

Verified (MBIE, "How to identify defects"). Whether something is a defect is decided in this order:
1. the contract, drawings and specifications
2. building consent documentation
3. manufacturers' specifications
4. any agreed contractor defect tolerance schedule
5. NZ Standards
6. MBIE *Guide to tolerances, materials and workmanship*

That is a ranked walk through documents — precisely what a retrieval assistant does well. Contractor liability window: **12 months** from completion (2015 consumer protection measures). Note the tolerances guide is **not mandatory** — parties can agree their own standard in writing.

## ⚠️ Research constraint (be honest about this in the study)

The session's **web-search budget (200 calls) was exhausted** partway through the fan-out, and `legislation.govt.nz` returns 403 to automated fetching. So parts of the remaining research are thinner than intended. Two areas came back empty and should be treated as **untested hypotheses, not findings**: subcontractor prequalification burden (Site Safe / SiteWise / Totika), and whether any NZ council accepts photo/remote inspection evidence — the latter decides whether a photo feature has a regulatory-grade role or only an internal-QA one.

## ⭐ Finding 9: HSWA penalties, verified from WorkSafe's own fact sheet

| Offence | Individual | Officer / individual PCBU | Body corporate |
|---|---|---|---|
| **s47 reckless conduct** | 5 yrs prison / $300k | **5 yrs prison / $600k** | **$3,000,000** |
| **s48 exposes to serious risk** | $150k | $300k | **$1,500,000** |
| **s49 failure to comply** | $50k | $100k | $500k |

Notifiable-event offences: s55 preserve site **$10k/$50k** · s56 notify **$10k/$50k** · s57 records **$5k/$25k**.

**Real NZ construction prosecutions** (WorkSafe court summaries — these are sales ammunition, not hypotheticals):
- **Joan Carpenters / Church Bay** — $450,000 fine. 5.6 m cladding sheet contacted 11 kV overhead lines; worker electrocuted and fell 3.7 m through a scaffold void. Scaffold was 1.5–1.9 m from the lines.
- **CPA 2022** — scaffolder's pole contacted 33 kV lines; **bilateral arm amputations**, lost use of legs. $550k starting point. Cause: the crew who dismantled weren't the crew who were briefed.
- **R&L Drainage** — $275,000. Trench collapse at 3 m. Also charged for **failing to lodge notice for a notifiable excavation exceeding 1.5 m**.
- **Prowash Wellington** — 6 m fall from a roof in wet weather; brain trauma. No edge protection, no wet-weather risk assessment. Fine cut to $40k for financial incapacity.
- **Scotty Doors** — fatality. A door installed in 2009 with inadequate fasteners fell 13 years later. $162,000 reparation.

**Sector scale:** construction is **~15% of NZ work-related fatalities and serious injuries** (WorkSafe Construction Sector Plan 2024–26). Top harms: falls from height, struck by falling object, struck by vehicle, hazardous substances (silica, welding fume, wood dust, asbestos). WorkSafe ran **6,500+ construction assessments in 2024/25** — about a third of its frontline activity.

⭐ **The R&L Drainage case points at a concrete feature.** They were fined partly for not *notifying* an excavation over 1.5 m. That's an obligation with a numeric trigger. An assistant that says *"you're digging 3 m — that needs a WorkSafe notification before you start"* is catching a real, prosecuted failure.

## ⭐ Finding 10: the H&S/prequal market prices ABOVE us, and recurs annually

**H&S software (NZ, per month):** HazardCo **$119–299** (10,000 businesses NZ+AU) · Site App Pro **$149–518** (ships "Site App AI") · Safe365 **$39–399** · SafetyCulture **$24/seat** (AI bundled in *every* tier, including free) · Assura & Donesafe POA.

**Prequalification — recurring, per contractor, and duplicated per scheme:**
- Site Safe membership **$233/yr** (5,700+ member businesses claimed)
- **SiteWise**: Level 3 subcontractor **$250+GST/yr**, Level 2 main contractor **$795+GST/yr**, **+$100 per extra assessment attempt**
- Qualify365: **$149** (sole trader) → **$1,399** (large), renewed every 1–2 years
- Site Safety Card **$199.50/person**, 2-year validity
- IMPAC PREQUAL: unpublished, contact-only

**SiteWise grading: Gold 90%+ · Green 75–89% (what most tier-1 principals demand) · Amber 50–74% · Red <50%.** A subbie must hit Green annually or lose access to tier-1 work — and a failed attempt costs $100.

**Totika** exists as "NZ's first and only nationally recognised cross-industry prequalification scheme" — an umbrella so you prequalify *once* instead of per client. The fact that an industry body built a federation to solve the duplication proves the duplication pain is real.

⭐ Two commercial implications:
1. **AI alone is not differentiating in H&S** — SafetyCulture bundles it free. NZ-specific compliance knowledge is the differentiator, not the model.
2. **We are priced below the market.** Compliance tooling commands NZ$119–299/mo because the alternative is a fine. Our NZ$79 entry may be leaving money on the table.

## ⭐ Finding 11: a dated, industry-wide reason to care — April 2027

The **Health and Safety at Work Amendment Bill passed its third reading on 1 July 2026** and takes effect **1 April 2027**, aimed at reducing duplication and being "more proportionate for small business."

Every NZ builder will need to know what changed and what it means for them, on a known date. That is a go-to-market hook with a countdown attached — exactly the kind of thing a cited, NZ-specific assistant should own.

## 🔴⭐ Finding 12: NZ IS ABOLISHING JOINT-AND-SEVERAL LIABILITY. This changes what Soterra IS.

**The single most strategically important thing in this whole study.**

The **Building Amendment Bill** passed its first reading **2 July 2026** and is at select committee now. Intended effect: **2028**, with a one-year lead-in. It shifts building-defect liability from **joint and several** to **proportionate**.

Bundled into the same Bill:
- **Mandatory home warranties** — 1-year defect period + **10-year structural warranty**, ~**0.5% of build cost**, for new builds ≤3 storeys and renovations over $100k
- **Mandatory professional indemnity insurance** for architects, designers, engineers
- **LBP disciplinary penalties up**: fines $10k → $20k, suspension 12 → 24 months
- PIM processing 20 → 10 working days; 10-day fast-track consent for solar/sustainable residential

### Why this reframes the product

Under **joint and several**, when a building fails the council has the deep pockets, pays, and everyone else shelters behind it. Under **proportionate liability, every party pays only their own share — which means every party must be able to PROVE what they did and didn't do.**

**Contemporaneous evidence stops being good practice and becomes a financial asset.**

Soterra is already an evidence machine: cited answers, dated decisions, superseded-revision handling, photos, a record of what was asked and what was answered. *"I can show exactly what the drawing said the day I built it, what I asked, and what I was told"* becomes worth real money to a builder in a way it simply wasn't before.

That is a **structural tailwind with a date on it**, announced now, that makes Soterra's existing core capability more valuable — plus mandatory warranties give warranty providers a reason to demand quality evidence too.

Positioning shift this enables: from *"ask your plans"* (convenience) to **"prove what you built and why"** (liability defence). Same product, far higher stakes, far higher willingness to pay.

⚠️ **Message it honestly.** This is a **Bill at select committee, not law**, with a stated 2028 effective date even if it passes promptly. Say "proposed reform, expected 2028" — never "new law". Watch for third reading through 2026–27.

Also checked and **not** found: any active proposal to change the **s393 Building Act 10-year longstop**. Only a 2009 leaky-homes-era mention. Report as searched-for-and-absent.

## ⭐ Finding 13: council inspections are already calendar-shaped, and we'd fix a top failure cause

**A typical Auckland house needs ~10–12 inspections**, each with a real council code: foundation (IFO), slab (ISF), framing (IFG), cavity/wrap (ICA), cladding (ICL), waterproofing (ITK), drainage (IDT), plumbing (IPP), pre-line (IPB), post-line (IPL), final (IF1). MBIE's generic 7-stage sequence: pre-pour → tanking → pre-clad → post-clad → pre-line → drainage → final.

**Auckland Council booking rules — every one of these is a calendar obligation:**
- **Must book before 1pm** for a next-day inspection
- **Cancel after midday the day before and you're charged the full fee anyway**
- Council targets 80% of inspections within 3 working days
- **Maximum 4 inspections open per consent** at any time
- Final inspection on a 10+ year old building needs **3 days' notice**
- Inspections running over 45 minutes may incur extra charges

🔴 **The three stated reasons an inspection FAILS (Auckland Council):**
1. the work doesn't meet the consent
2. **required parties are absent**
3. **approved documentation isn't available on site**

**Reason 3 is a Soterra feature already.** The approved documents *are* on the phone, on site, current-revision, searchable. That is a direct, concrete, provable value claim — not a soft one.

⭐ **Remote inspection is nationally sanctioned.** MBIE: *"Inspections may be conducted on-site by council inspectors or remotely using digital technology."* That answers the earlier open question — a photo/video-capable assistant has a potential regulatory-grade role, not just internal QA. (Which councils actually operationalise it is unconfirmed.)

**Guarantee economics** (context for the mandatory-warranty reform at ~0.5% of build cost — it's in line with what already exists):
- **Master Build 10-Year**: structural 10 yrs, workmanship 2 yrs; deposit cover to $50k; non-completion to $500k; overall cap $1M. Premium **<1% of build cost, $910–$6,325 + GST**.
- **NZCB Halo**: structural 10 yrs, workmanship 2 yrs, temp accommodation to $30k, transferable. Premium **<0.42% of build cost**.

### → Feature that falls straight out of this: the inspection scheduler
Read the consent → know which of the 10–12 inspections apply → place them against the programme → remind at 11am the day before (*"book by 1pm or you lose tomorrow"*) → run a pre-inspection check so you don't fail on absent parties or missing documents. Uses the document reader, the calendar and the reminder engine exactly as they already are.

## Emerging thesis (to be tested against the remaining research)

Soterra holds two things almost nobody pairs: **a document reader** and **a calendar with phone reminders**. The bridge between them is the product:

> **Read a document → extract every dated obligation → put it in the calendar → remind the right person.**

Apply to: the contract (notice periods, payment claim dates), the building consent (conditions, inspection sequence, lapse date), RFIs (response-required-by → chase), the programme (milestones), subcontractor agreements.

Positioning: *the assistant that never lets you miss a deadline that costs you money.*

Second thesis: **the RFI loop is half-built**, and closing it also solves the cold-start problem for the "company history" idea Adam wants — because it generates the history as a by-product of daily use, instead of requiring a firm to upload years of records first.
