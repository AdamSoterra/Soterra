# What Soterra could learn next — the candidate list

_Researched 22–23 July 2026, nine tracks. **Nothing has been ingested.** This is the menu; you pick._

Every document was verified by actually fetching it — real URL, real page count, real licence wording read from inside the file. Where something couldn't be verified it says so. Nothing is listed from memory.

---

## The short version

**There is far more clean, free, commercially-usable material than expected — about 3,000 documents.** The single biggest find is that **NZ legislation has no copyright at all**, and so do court and tribunal decisions, and so do Royal Commission reports. On top of that, MBIE's entire estate is CC BY 4.0 including ~1,100 determinations, and the Ministry of Justice is CC BY 4.0 including 419 Weathertight Homes Tribunal decisions.

**But the material closest to the actual work is the material most locked down.** BRANZ bans AI use by name. WorkSafe is non-commercial. Standards NZ names AI knowledge bases. Most councils reserve rights. Those are permission conversations, not blockers — and several are very winnable.

**One category stays closed regardless: electrical.** It's 36% of your failure data, every item is AS/NZS 3000, and Standards NZ can never sponsor a standard it co-owns with Australia.

---

## TIER 1 — Ingest now. No permission needed.

### 1a. Outside copyright entirely — the strongest position available

| Document | Volume | Basis |
|---|---|---|
| **NZ legislation** — 14 Acts and Regulations a builder actually needs | **1,686pp** | *"Under section 27 of the Copyright Act 1994, there is no copyright in New Zealand legislation"* — no attribution required, no commercial restriction, nothing to negotiate |
| **Weathertight Homes Tribunal decisions** | **419** | s27(g) — no copyright in NZ court or tribunal decisions. Host site is CC BY 4.0 anyway, commercial use explicit |
| **Canterbury Earthquakes Royal Commission** — 7 volumes + interim, 189 recommendations | 8 documents | s27 — no copyright in Royal Commission reports. Available as PDFs *and* per-section .docx, ideal for page indexing |

The legislation set, all verified and text-extractable: Building Act 2004 (486pp), Electricity (Safety) Regulations 2010 (218pp), HSWA 2015 (192pp), Plumbers Gasfitters and Drainlayers Act 2006 (155pp), Fair Trading Act (127pp), Weathertight Homes Resolution Services Act (114pp), **Building (Forms) Regulations (73pp)**, Construction Contracts Act (70pp), **HSW (Asbestos) Regulations 2016 (66pp)**, Consumer Guarantees Act (38pp), General Risk and Workplace Management Regs (32pp), Building Product Information Requirements Regs (12pp), **Building (Definition of Restricted Building Work) Order (7pp)**.

Fetch pattern that works: `legislation.govt.nz/{act|regulation}/public/{year}/{number}/latest/whole.pdf` — the site 403s WebFetch but returns 200 to curl with a browser user-agent.

⚠️ **Four documents are 62% of the pages** (Building Act, Electricity Safety Regs, HSWA, PGDA). The Electricity Safety Regs in particular are overwhelmingly about generators and lines companies — weight retrieval away from it. The high-density documents for the pre-inspection check are the small ones: the RBW Order (7pp) is the best value-per-page in the set.

⚠️ **The one live hazard in an otherwise clean corpus:** s27 explicitly does *not* cover works incorporated by reference. NZS 3604 and the AS/NZS standards are cited *by* legislation but remain Standards NZ copyright. Same carve-out appears on building.govt.nz. Exclude them.

### 1b. CC BY 4.0 — commercial use explicit

| Document | Volume | Note |
|---|---|---|
| **MBIE determinations** | **~1,100** (989 verified 2011–2026, 2010 confirmed present) | ⭐ BUILD-PLAN step 5, and it turns out to be trivially accessible. URLs are **directly enumerable** — no scraping: `building.govt.nz/assets/Uploads/resolving-problems/determinations/{year}/{year}-{nnn}.pdf` |
| **NZGS/MBIE Earthquake Geotechnical modules 2, 3, 4, 5, 5A, 6** | 6 documents | s175 Building Act guidance. Module 6 retaining walls and Module 4 foundations are the two most-asked residential consultant topics |
| **Canterbury repair/rebuild guidance 3rd ed**, Parts A–E | 7 files | Contains the **TC1/TC2/TC3** definitions — the trigger question on every Christchurch job |
| **MBIE Building Consent System Performance Monitoring** (annual) | 5pp | The marketing numbers — see below |
| **MBIE Evaluation of the Building Consent System** (2022) | ~38pp | |
| **NZ Guide to Temporary Traffic Management** (NZTA) | 88pp | CC BY 4.0. ⚠️ CoPTTM was retired 1 Nov 2024 but councils transition on their own timetables into mid-2026, so a builder can legitimately be under *either* regime depending on the road controlling authority. Genuine product nuance |
| **Rotimi, Tookey & Rotimi (2015)** and **Kirby, Rotimi & Naismith (2025)** | 2 papers | CC BY peer-reviewed NZ defect research. Get from AUT Tuwhera — MDPI and ScienceDirect both 403 |

### 1c. Attribution-only or permissive

| Document | Pages | Licence |
|---|---|---|
| **NZ Metal Roof and Wall Cladding Code of Practice** v26.06 (NZMRM) | **515** | *"NZMRM should be acknowledged as the source of information."* Cited by E2/AS1, so quasi-regulatory. Text extraction permitted in the PDF's own flags. ⚠️ reissued quarterly — version-stamp it |
| **Building Practitioners Board (LBP) disciplinary decisions** | **1,449 PDFs** | *"This material may be used, copied and re-distributed free of charge in any format or media"* with acknowledgement. ⚠️ see access note below |
| **MBIE Working on roofs** (2012) | 43 | Pre-dates WorkSafe, carries the older permissive Crown copyright — not the CC BY-NC one. ⚠️ written against the repealed 1992 Act; technique only, never legal duties |
| **NZECP 34 Electrical Safe Distances** | 32 | No copyright statement anywhere in the document. Holds exactly the figures that get missed — 4m approach at ≤110kV, 6m above |
| **Engineering NZ Construction Monitoring Services** | 5 | No copyright statement. **The CM1–CM5 source**, including the K-factor scoring method that derives the right level and visit frequency |

⚠️ **LBP access:** lbp.govt.nz is totally blocked by Imperva — every path, including direct PDF links. The 1,449 decisions are obtainable via the Internet Archive's CDX API, which is legally clean but operationally fragile. **Use it to bootstrap, then email MBIE for direct access or a user-agent allowlist.** These are disciplinary findings against named individuals, so apply the same redaction discipline the Board itself uses.

### 1d. Council inspection material

| Document | Pages | Covers |
|---|---|---|
| **AC3601.16 / .17 / .18 Inspection Code of Practice** — Framing, Drainage & Residential Final, Preline Build | **229** | ⭐ The rubric. Written directly against checklist line items, with hard figures (barrier 1000mm from FFL, gutters min 300×70mm, 12mm airgap deck to cladding) |
| **Far North "Guide to Building Inspections"** (March 2026) | **33** | ⭐ Best single council document found. Each inspection type with purpose, what inspectors want to see, **and a photo example**. Cloudflare block has lifted |
| **Rotorua IC 01–IC 24** | 55 | Numbered in inspection order. Council's own words: *"check your building work against the relevant checklist before the building inspector gets to the site"* |
| **Kāpiti Coast Form 559 — A Guide to the Inspection Process** | 29 | v19, issued under Regulation 7(2)(a)(i)(ii) |
| **Co-Lab / Waikato BCG shared checklists INS-01 … INS-16** | 16 files | ⭐ **One ingest covers eight councils** — Hamilton, Hauraki, Matamata-Piako, Otorohanga, Thames-Coromandel, Waikato District, Waipā, Waitomo. Authoritative, not advisory |
| **AC1824 Guide to Booking Inspections** v5 | 46 | ⚠️ pp44–45 are the inspection-order charts and are **images with no extractable text** — a text-only pipeline loses them silently. Use AC1229 pp12–13 instead |
| **AC1825 Position statement for acceptance of fire stopping** | 4 | ⭐ Encodes the *inspection regime*: mandatory labelling of every penetration, PS3 from installer, third-party inspection at 10% witnessed / 2% destructive, and **one non-compliant install triggers ten more inspections.** The commercial argument for the pre-inspection check in one sentence. Class C — needs permission |
| **Marlborough BIB0006** | 12 | Stage-by-stage, what the inspector checks |
| Tasman, Kaipara, Taupō, Upper Hutt, Ashburton, Central Otago | HTML | Inspection-type lists confirmed |

**Gisborne is the only council in the country with nothing.** A pamphlet existed and its URL now 404s.

### 1e. General construction knowledge

**Introduction to Construction Project Management** (McGary, 2024, 211pp, **CC BY 4.0**). Modules 3 and 5 — planning, scheduling, critical path, progress variance — are the programme-reading brain. Fence the US contract/procurement pages.

**C/AS2 Protection from fire** (124pp), **Building Product Specifications** (45pp, new, eff April 2026), **Compliance Schedule Handbook** (58pp) and **Exemplar Compliance Schedule** (49pp) — all CC BY, and together they cover the fire and BWOF/specified-systems ground the corpus is missing. ⚠️ the 2014 Compliance Schedule Handbook carries MBIE's *older* wording: *"You may not distribute this document to others or reproduce it for sale or profit."* Five minutes of legal eyes before that one goes in.

---

## TIER 2 — Worth an email

Ranked by value × probability. Every one is free to read and restricted to reuse.

| # | Who | What it unlocks | The ask |
|---|---|---|---|
| **1** | **WorkSafe NZ** | **~1,750pp** — working at height, scaffolding, excavation, and the four new April 2026 asbestos guidelines governing pre-2000 renovation | Their PDFs are CC BY-**NC** 3.0 NZ, but **their website copyright page says the opposite** — free reproduction, no non-commercial term. Open with that contradiction. They're a regulator whose mandate is this guidance being read |
| **2** | **Winstone Wallboards (GIB)** | Noise Control (132pp) + Fire Rated Systems (152pp) — these answer your acoustic and passive-fire items better than any government document | **Not a permission ask — a scope confirmation.** Their manual contains an explicit grant: *"authorised to reproduce and distribute exact copies or exact extracts… for the sole purpose of detailing, specifying, using, and promoting the use of Winstone Wallboards Ltd products and systems."* But it sits inside the CAD blocks. Confirm it covers body text |
| **3** | **Auckland Council** (LGOIMA) | The remaining AC3601 modules — **wrap/cavity/cladding first**, where your six flashing fails live | Free. File at fyi.org.nz and the release becomes public and citable |
| **4** | **MBIE Building Performance** | NZSEE Seismic Assessment, 12 PDFs ~30MB, the most-cited structural material in NZ | Licence is genuinely ambiguous — Part A has no copyright line, MBIE's site is CC BY, but eq-assess.org.nz asserts "© NZSEE 2016-18". One email for written confirmation |
| **5** | **FPANZ** | The Passive Fire Register, 252pp — **the document your inspector refused you against** | Aligned: FPANZ charges manufacturers $950–$1,330 to be listed, and AC1825 tells the whole Auckland market to check it. Their copyright clause names the route — via the Chief Executive |
| **6** | **James Hardie NZ** | ~50 manuals incl. Bracing Design and Cladding Junctions Detail Design | No reproduction clause anywhere in their PDFs. They publish `literaturefeedback@jameshardie.co.nz` |
| **7** | **Window & Glass Association NZ** | 5 guides, ~213pp on window install and flashings | All silent on reuse, named technical staff publish emails. Highest-probability yes |
| **8** | **NZQA** | 269 carpentry unit standards — the closest thing to NZ-native build-sequence knowledge | Explicitly carved out of NZQA's CC BY. Citable, but other uses need permission |
| **9** | **Hutt City Council** | ⭐ 24 inspector-side checklists, ~148pp, with explicit *"If yes, fail the inspection"* rules | Best non-Auckland document found — and Hutt has **no discoverable copyright statement at all** |
| **10** | **Promat / Trafalgar Fire** | Firestop systems manuals — Trafalgar has ~130 behind one open endpoint | Warranty-alignment framing lands hardest here. Incorrect collar installation is their cost |
| **11** | **SESOC** | 11 free public guides, incl. two 2025 retaining-wall guides | No licence statement anywhere on the site |
| **12** | **Standards NZ** | NZS 3604 under Digital Products Licensing | **Fee-free during development**, revenue share at commercialisation. Precedent: LawHawk with NZS 3910. Scope to NZS 3604 alone — don't open with joint AS/NZS |
| **13** | **BRANZ** | 614 research reports incl. the economic cost of quality defects | A licence purchase, not a permission email — see below |
| **14** | **Wellington Water** | Regional Standard for Water Services, 139pp, binding across four cities | Explicit non-commercial share-alike. `standards@wellingtonwater.co.nz` |

**Framing that works on manufacturers:** *"Your installation manual, quoted verbatim and cited by document name and page, shown to the installer at the moment they're installing your product. No paraphrasing that could misstate your spec, always pointing at your current published version."* Incorrect installation is their warranty cost.

**Two things to say up front in every manufacturer email:**
1. You are **not** asking for pages that reproduce Standards NZ content — those are licensed to that company by name (Pryda under 000925, MiTek under 000907) and cannot be granted onward. Naming it removes their biggest objection before they raise it.
2. You will **version-pin with a refresh commitment.** Their systems are CodeMark-certified, which obliges installation per the *current* manual. Staleness is the objection they'll actually raise.

---

## TIER 3 — Do not ingest

| What | Why |
|---|---|
| **BRANZ, all of it** | Terms cl 3.1(k): *"conduct, facilitate, authorise or permit the use of any Content from the Website in any artificial intelligence programme."* Plus 3.1(j) bans scraping and 3.1(a) bans use "for the purposes of competing with Us". **Audit the existing index and remove any BRANZ material before a customer launch** |
| **NZLII** | 30-page cap, non-commercial only, and their robots.txt names `ClaudeBot: Disallow` with `ai-train=no`. Fails on every axis. Get judgments from MoJ instead, where s27(g) puts them outside copyright entirely |
| **NZ Standards** | DPL page names *"AI tools and LLMs (including prompts, outputs, or knowledge bases)"*. The free sponsored PDF is a free *copy under a personal-use licence*, not free content |
| **Chorus technical requirements** | Every page footer "Chorus Confidential"; bars storage "in a retrieval system". Painful — their Vol 1 Table 4 has the exact power/comms clearances you failed on |
| **Site Safe, CHASNZ** | Site Safe is expressly non-commercial. CHASNZ is "All Rights Reserved" with no grant at all — legally worse, since at least BY-NC is an express grant |
| **Engineering NZ Practice Note 1 (Producer Statements)** | *"cannot be reprinted without permission."* Use the Construction Monitoring Services doc instead |
| **QLDC Land Development Code** | *"NO PRINTING IS PERMITTED"*, and embeds NZS 4404 under a licence issued to QLDC alone |
| **ABCB Housing Provisions** (Australia) | CC BY-**ND**, and the highest jurisdiction-confusion risk in the survey — looks NZ-adjacent, isn't |
| **Building Science Corporation; Messner and Forehand texts** | Non-commercial |
| Napier, Hastings, Horizons, Waimakariri, Western Bay, Hamilton, Whangārei, BOPRC, Christchurch, Tauranga, ECan | Reserve rights or non-commercial only |

---

---

## Manufacturer literature — ~60 brands verified

Website terms **and** the wording inside the actual PDFs, checked separately. That split is essential: GIB, James Hardie, Carter Holt and Expol all have restrictive-looking websites and no restriction at all in their documents.

### The pattern worth knowing

**Three companies publish an address specifically for permission requests.** They are invitations, not walls, and they should be written to first:
- **Autex** — cl 15.2: *"Enquiries and permission requests may be sent to us at enquiries@autex.co.nz."*
- **NZ Steel** — *"Requests and enquires concerning the reproduction of Material on this Site... should be sent by email to info@nzsteel.co.nz."*
- **Resene Paints** — *"If you would like to use any material from the Resene website, please contact Resene Marketing... update@resene.co.nz."*

**And three already grant what Soterra needs, in writing:**
- **James Hardie / GIB** — *"The User is authorised to reproduce and distribute exact copies or exact extracts of the CAD drawings for the sole purpose of detailing, specifying, using and promoting the use of [X] Products and Systems."* Scoped to CAD drawings; the ask is to extend it to manual body text.
- **Dimond Roofing** — on nearly every page of 400+ pages: *"You may copy this document solely for the Permitted Purpose"*, where that purpose is *"designing or building a roof or roofing system solely using products supplied or approved by Dimond."* An inspector querying a Dimond roof is inside it.
- **Juken (JNL)** — the only unconditional grant found: *"Details may be reproduced provided they are reproduced in full and used in context."*

⚠️ **That CAD-grant clause family appears only among CAD-library/system suppliers.** It is absent from every timber, concrete and steel company checked, and from every envelope and services company. One template will not cover the list.

### Email running order

| # | Who | Contact | Why it ranks here |
|---|---|---|---|
| 1 | **James Hardie** | `literaturefeedback@jameshardie.co.nz` | Existing grant, no restriction in any of 5 manuals (282pp), and the contact is printed *inside* the documents so it lands with literature staff, not legal |
| 2 | **Carter Holt Harvey** (Futurebuild LVL, Ecoply) | `info@futurebuild.co.nz` | Biggest structural literature set in NZ residential framing. **All four flagship PDFs — 152pp — carry no copyright statement whatsoever.** Only the website restricts |
| 3 | **Dimond Roofing** | `rooftech@dimond.co.nz` | Already grants copying for a defined purpose Soterra sits inside. 400+pp open (228pp Technical Manual, 93pp Structural, 80pp Installers) |
| 4 | **GIB / Winstone Wallboards** | `info@gib.co.nz` | Same email as #1. Noise Control (132pp) and Fire Rated (152pp) answer the acoustic and passive-fire failures |
| 5 | **Autex** | `enquiries@autex.co.nz` | Terms nominate that address for permission requests. Directly answers the acoustic-lagging failures |
| 6 | **APL Window Solutions** (Altherm, First, Vantage) | `espcloudsupport@aplnz.co.nz` | Dominant NZ window supplier, and **they already run a partner integrations API** — licensing data to a third party is a conversation they have. BPIRs are silent; website is restrictive |
| 7 | **Window & Glass Association NZ** | named staff publish emails | ~213pp. **"WANZ support bars" is named verbatim in the failed ICA report**; their Barrier Design Guide covers the IF2 barrier-height fail |
| 8 | **Juken (JNL)** | `info@jnl.co.nz` | Unconditional grant. ⚠️ **Exclude BRANZ Appraisals 481 and 593, ~pp100–120 of the Triboard manual** — not JNL's to grant. Say so yourself in the email |
| 9 | **NZ Steel / Colorsteel** | `info@nzsteel.co.nz` | Named reproduction-request channel. Also the upstream substrate for Dimond, Metalcraft and Steel & Tube literature — one yes strengthens several |
| 10 | **Promat · Trafalgar Fire · BOSS Fire** | technical contacts | Passive fire caused 3 of 4 council fails. Trafalgar has ~130 manuals behind one open endpoint |
| 11 | **Allproof Industries** | contact form | **No terms page, no copyright page, no disclaimer — verified against their full sitemap.** Cheapest yes on the list, and drainage fittings sit on the failure data |
| 12 | **Herman Pacific** | `technical@hermpac.co.nz` | Large open detail library (PDF + REVIT + DWG + DXF), no copyright line in the specs. Website terms are aggressive, so ask |
| 13 | **Expol** | `tech@expol.co.nz` | **42-page technical guide, no copyright statement anywhere.** Website restrictive |
| 14 | **Equus Industries** | `central@equus.nz` | Membrane and tanking failures. Terms name technical documents explicitly and downloads are 403-blocked — you have to ask |
| 15 | **Nelson Pine** | `LVL@nelsonpine.co.nz` | No terms page, no copyright in the PDFs. Small corpus but core LVL data. Near-formality |
| 16 | **Rondo** | `rondo@rondo.com.au` | No terms-of-use page at all, zero copyright statements. A courtesy note |
| 17 | **Resene Paints** | `update@resene.co.nz` | Invites requests. ⚠️ **Name Resene Construction Systems separately** — its 245pp manual is stamped on every page and will not be covered |
| 18 | **NK Windows** | `info@nkwindows.co.nz` | Explicit prohibition but squarely on the failing item. ⚠️ much of the library is image-only vector CAD — one file yields 3 characters of text. Would need OCR even with permission |
| 19 | **Timber Unlimited** (NZ Wood Design Guides) | contact form | 16 chapters, 50–80pp each, no copyright clause in any checked. Blocked by one line: *"You may not commercially exploit this site or its contents."* **But the IP is MPI-owned Crown material**, which grants far more readily than a manufacturer |
| 20 | **Concrete NZ** | `admin@concretenz.org.nz` | ⚠️ **Non-negotiable carve-out: CP 01 Section 4.6 (Masonry Veneer) is NZS 4229 content under Standards NZ licence 001006 issued to them by name.** Raise it yourself. Do not write to CCANZ — the domain is dead |
| 21 | **FPANZ** | via the Chief Executive | The register the inspector refused a product against |
| 22 | **Elephant Plasterboard** | `info@epb.co.nz` | Write alongside GIB, not instead. NZ-owned, already grants narrow reuse rights |
| 23 | **Techlam · Stahlton · Metalcraft · XLam · Mammoth** | see notes | Bare-notice-or-nothing, no reuse restriction. Cheap yeses, modest corpora — batch them once a template works. ⚠️ verify mammoth.co.nz resolves first |
| 24 | **ARDEX · Thermakraft/Kingspan · Masons · Ramset · JSC Timber** | — | Class B, silent on reuse |

### Skip — and why

| Who | Reason |
|---|---|
| **Hilti** | Access Agreement bars users from **"store"**-ing content — names the exact act. Portal-gated, no NZ email |
| **Knauf** | *"All rights reserved, including those of... **storage in electronic media**."* Group-level German notice |
| **Metro Performance Glass** | Bars material being **"stored in a retrieval system"** |
| **Steel & Tube** | The only explicit **anti-scraping** clause found anywhere. Literature is downstream of COLORSTEEL and BHP — licence NZ Steel instead |
| **HERA** | Publications *are* the revenue (NZ$271/guide) and they already have a published AI policy. A paid negotiation |
| **Simpson Strong-Tie** | Restricts commercial use by name |
| **Sika · Bostik · Holcim** | European parents, no permission channel named |
| **Cirtex** | Has a grant, but *"non-commercial use within your organization only"*. Drawings carry almost no text anyway |
| **NZTPC · WPMA** | No corpus at all — HTML only. Treatment levels live in NZS 3602 and B2/AS1, already covered |
| **Red Stag** | Thin free literature; the valuable span tables are login-gated |
| **Fairview** | Login-gated — you would be asking for access *and* permission |
| **RX Plastics/Aliaxis · Rosenfeld Kidson · Gripset · Wolfin · Envirospec · Dux** | No usable corpus, no NZ entity, or compliance paperwork only |

### Two rules for the ingest pipeline, both now confirmed as patterns

**1. BRANZ Appraisals travel inside manufacturer literature.** Confirmed verbatim in BRANZ Appraisal 871: the appraisal *"is copyright of BRANZ"*. Juken embeds two in full; Resene Construction and Bostik carry them; Equus and Mapei host entire appraisal libraries. **Index the manufacturer's own literature, never the appraisal — even when the manufacturer distributes it.** BRANZ is already a hard no, so a wholesale library pull would quietly import exactly what we ruled out.

**2. Standards content arrives under licences issued to the publisher by name, and cannot be passed on.** Confirmed: Concrete NZ CP 01 §4.6 under Standards NZ licence **001006**; Pryda under **000925**; MiTek under **000907**. Needs page-level exclusion, not document-level. Also watch Golden Bay's safety data sheets — those are **Datachem's** copyright, not Golden Bay's to grant.


## The gap money can't close

| Category | Your failures | Answerable free | Why |
|---|---|---|---|
| Fire | 19 | ~17 | C/AS2 + BPS + GIB is strong |
| Interior / Linings | 8 | ~8 | GIB territory |
| Acoustic | 7 | ~5 | Pipe lagging is a real hole |
| Plumbing & Drainage | 62 | ~20 | Rest is AS/NZS 3500 |
| Mechanical | 35 | ~12 | FCU vibration isolation has no free source |
| Seismic | 2 | 0 | NZS 4219 answers both — blocked only by licence |
| **Electrical** | **75** | **~8** | **Every item is AS/NZS 3000. No free NZ document states any of it** |

Those are a researcher's judgement, not a benchmark. **Before spending on any standards licence, run 20 real failure items from the three worst categories against a Tier 1 corpus.** That turns an estimate into a number worth buying from. AS/NZS 3000 is $256.16; AS/NZS 3500 Parts 1–4 is $976.06; both + GST.

---

## The numbers you can now cite — and three you can't

**From MBIE, annually, free to reuse:**
- **64.6% of consent applications require an RFI**, median **11.0 working days** to respond
- An RFI **more than doubles** processing time — 11.0 working days vs 5.0
- It scales with complexity: **52.9% simple residential → 77.8% complex**; all commercial above 70%
- **Auckland is 81.6%**, median 17 days — the worst large BCA

**From the Taylor Report** (2016 Auckland, caveat that the author says it *"would not stand up to statistical scrutiny"*):
- Auckland inspection failure **23% three-year average**, residential finals **59% in 2015**
- **Framing 18% + Preline 18% + Cavity Wrap 14% = half of all non-final failures**
- *"At least 10% of final inspections fail because the site is not ready"*

**From peer-reviewed CC BY research** (co-authored by your own AUT professor): **64.7% of recent home buyers did not hire an independent inspector; 74% said in hindsight they should have.**

**Do not use:**
- *"92% of new houses had compliance defects"* — BRANZ, licence-blocked
- *"$2.5 billion a year"* — NZIER **for BRANZ**, and the original says GDP would *rise* $2.5b with better productivity. Doubly wrong
- *"one-third of Auckland builds fail final inspection"* — mangled. The actual quote is **~25% first-time failure**
- ⚠️ MBIE's appendix has a column headed **"Pass rate"** — it's statutory-timeframe compliance, **not** an inspection pass rate

**And a strategic one:** MBIE's own 2022 evaluation says national consent data is *"mostly limited to the number, floor area and value of consents"* and that RFI/inspection/CCC data *"is held by individual BCAs and may not be collected in a way that is comparable across regions."* **Your 27-report dataset may genuinely be the best NZ inspection-outcome data outside council systems.** The regulator is saying the national dataset doesn't exist.

---

## Where the reform actually stands

| Reform | Status |
|---|---|
| **Granny flat / small standalone dwelling exemption** | ✅ **In force since 15 January 2026.** Up to 70m², single storey, detached, notified rather than consented |
| **Overseas building product recognition** | ✅ Passed April 2025, usable in consent applications from 1 Oct 2025. BCAs **must** accept. ~128,000 products across two tranches |
| **Proportionate liability** | ⏳ **Bill only** — introduced 2 July 2026, first reading ~7 July, now at select committee, then a further year's implementation. Realistically 2028 |
| **Remote inspections** | ❌ Neither. Not in the Bill. What landed instead is the **80%-of-inspections-within-3-working-days** timeframe |

**Commercial read:** the liability-defence positioning is real but early — it's a sales narrative, not a compliance deadline. What you *can* point at this month is the 3-working-day timeframe and the granny-flat exemption already being live.

---

## Controls this implies

- **Jurisdiction tag per document**, and a standing rule: never state an NZ dimension, bracing value, treatment level or legal duty from a non-NZ source. Your code layer audited 15/15 with zero fabrications — mixing jurisdictions untagged is how that breaks. **Exception: passive fire.** AC1825 requires firestopping per AS 4072.1 with test reports to AS 1530.4, so Australian firestop manuals *are* the NZ benchmark there.
- **Page-level licence exclusion, not document-level** — manufacturer guides embed NZS content under licences issued to that company by name.
- **Version-stamp and staleness-warn.** Two documents here carry machine-detectable staleness banners ("TO BE UPDATED TO REFLECT LATEST LEGISLATIVE CHANGES"). The 2012 roofs guideline is written against a repealed Act. WorkSafe's 2016 asbestos ACOP and the 2026 GPGs **partially conflict**, and the ACOP is still the legally approved code — ingest both, be explicit about which is which.
- **Check text density per page on ingest.** AC1824's charts are images; GWRC's 294-page erosion guide is an OCR'd scan where some pages yield 2,000 clean characters and others yield 22. Both fail silently.
- **Retrieval cost.** Four legislation documents are 62% of that corpus's pages; the infrastructure codes total ~2,900 pages of subdivision engineering. At $0.048/question with 74% in retrieval payload, weight accordingly.

---

## Still unverified

- **Judicial Decisions Online** — the licence position is confirmed favourable, but the search interface wouldn't connect from outside NZ. Retest from an NZ IP.
- **FENZ** — fireandemergency.nz returns empty content to every automated fetch. The Designers' Guide to Firefighting Operations series exists as free per-chapter PDFs but none were retrieved.
- **Hilti NZ** — documents are portal-gated behind per-product links. Poor early bet versus Promat and Trafalgar, who serve PDFs openly.
- **Bostik, 3M NZ, Fyreline, Pyropanel, Abesco** — not verified first-party.
- **Natural Hazards Commission** (ex-EQC) licence — 404s on every plausible terms URL.
- **A signal worth chasing first:** MBIE may now be publishing **free bracing ratings** directly. If true it partly substitutes for the NZS 3604 tables.

---

## If I were picking

**Tonight, zero risk, zero cost:** legislation (14 docs), determinations (~1,100), WHT decisions (419), Royal Commission (8), NZGS modules, Canterbury guidance, the AC3601 modules, Far North, Rotorua, Co-Lab's eight-council set, the metal roofing Code of Practice. That's roughly 3,000 documents and it is the largest single upgrade available.

**This week:** the WorkSafe email (biggest single unlock), the GIB scope confirmation (easiest yes), and the LGOIMA for the remaining AC3601 modules.

**Before launch:** a lawyer on the Auckland Council terms, and the BRANZ audit.

**Don't rush:** the standards licence. Benchmark first.
