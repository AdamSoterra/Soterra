# What Soterra could learn next — the candidate list

_Researched 22–23 July 2026. **Nothing here has been ingested.** This is the menu; you pick._

Every document below was verified by actually fetching it — real URL, real page count, real licence wording. Where something couldn't be verified it says so. Nothing is listed from memory.

---

## The five things worth knowing before you read the list

**1. The corpus is aimed at the wrong half of the problem.** 3,289 pages that are excellent on *what the rule is* and nearly silent on *how the work is done and checked*. Your own failure data says the second half is where jobs fail.

**2. Councils publish the rubric they mark you against — and it's better than anything else out there.** Auckland's Inspection Code of Practice defines every checklist line item. Hutt City publishes 24 inspector-side checklists with explicit fail rules. Rotorua publishes 24 checklists numbered in inspection order and tells builders to self-check against them before the inspector arrives. That last one is BUILD-PLAN feature #1, written by a council.

**3. Copyright is the binding constraint, not availability.** Almost everything useful is free to *read*. Very little is licensed to *index*. Three separate publishers — Standards NZ, BRANZ, and most councils — restrict exactly what Soterra does. Two name AI knowledge bases explicitly.

**4. Electrical is 36% of your failure data and is essentially unanswerable for free.** Every one of those 75 items is AS/NZS 3000 clause-by-clause, and Standards NZ will never sponsor a joint AS/NZS because it doesn't own the copyright. That gap is structural and permanent.

**5. MBIE is the one clean, generous source.** building.govt.nz is CC BY 4.0 — commercial reuse, adaptation and redistribution, with attribution. Everything already in the corpus is on solid ground, and there's more there worth taking.

---

## TIER 1 — Ingest now. Clean licence, high value.

Roughly **1,000 pages**. No permission needed, no meaningful risk.

| # | Document | Pages | Licence | What it buys you |
|---|---|---|---|---|
| 1 | **NZ Metal Roof and Wall Cladding Code of Practice** v26.06 (NZMRM) | **515** | Attribution only — *"NZMRM should be acknowledged as the source of information"* | The benchmark document for metal roof/wall cladding. Cited by E2/AS1, so quasi-regulatory. Text extraction is permitted in the PDF's own flags. ⚠️ Reissued quarterly — version-stamp it |
| 2 | **AC3601.16 Inspection Code of Practice — Framing (IFG)** | **108** | Auckland Council terms | ⭐ The rubric. Written directly against checklist line items, with hard figures (barrier 1000mm from FFL, gutters min 300×70mm, 12mm airgap deck to cladding) |
| 3 | **AC3601.18 Inspection Code of Practice — Preline Build** | **94** | Auckland Council terms | ⭐ Same, for the inspection that failed you twice on passive fire |
| 4 | **AC3601.17 Inspection Code of Practice — Drainage & Residential Final** | **27** | Auckland Council terms | ⭐ Same |
| 5 | **C/AS2 Protection from fire (non-SH)**, 2nd ed, eff 28 Jul 2025 | **124** | CC BY 4.0 | Cl 4.3.2 fire stopping; 4.3.2.3 *"identical to the prototype used in tests"*; fire dampers 4.4.5.2; detail drawings pp59–61. **Answers your three passive-fire council fails** |
| 6 | **Compliance Schedule Handbook** (Am 3) | **58** | ⚠️ MBIE's *older* wording — see note | SS1–SS16, BWOF, Form 12A, IQP. The entire back half of a commercial job |
| 7 | **Exemplar Compliance Schedule** (MBIE + ABC, Dec 2021) | **49** | CC BY 4.0 | A real worked schedule, system by system. The specificity a model needs |
| 8 | **AC1824 Guide to Booking Inspections** v5, Jun 2026 | **46** | Auckland Council terms | Every inspection type + booking code + what's checked + LBP class required |
| 9 | **Building Product Specifications** Am 1, eff 2 Apr 2026 | **45** | CC BY 4.0 | New — C/AS2 moved its AS 1530 / AS 4072 references here. Lets you say *why* a fire collar fails without owning the standard |
| 10 | **AC1833 Building Consents — Demonstrating Compliance** v2, Jun 2026 | **38** | Auckland Council terms | What evidence the inspector actually wants |
| 11 | **Rotorua Lakes IC 01 – IC 24** (24 files) | **55** | Rotorua terms (workable) | ⭐ Numbered in inspection order. Council's own words: *"check your building work against the relevant checklist before the building inspector gets to the site"* |
| 12 | **Tauranga T-801A + Builder's Self Check Sheets BSCS-01..06** | **12** | ⚠️ all rights reserved — see Tier 3 | Ready-made pre-inspection checks. Listed here for value; licence says ask first |
| 13 | **GWRC Small earthworks — ESC for small sites** (2006) | **39** | CC BY 4.0 | Erosion control sized for a house site, not a subdivision |
| 14 | **AC/BC5850 Building on Small Sites — Doing it Right** | **21** | Auckland Council terms | Builder-facing ESC. Better value per page than GD05's 304 |
| 15 | **AC2301 Producer Statement Policy** | **33** | Auckland Council terms | When council will and won't accept a PS |
| 16 | **Introduction to Construction Project Management** (McGary, 2024) | **211** | **CC BY 4.0** | Programme-reading brain: WBS, dependency logic, critical path, float, progress variance. Fence the US contract/procurement pages |

**⚠️ On #6:** the 2014 Compliance Schedule Handbook carries MBIE's older copyright — *"You may not distribute this document to others or reproduce it for sale or profit."* The 2021+ documents have no such clause. Worth five minutes of legal eyes before it goes in. Edition 2 exists as a Nov 2025 **draft** (114pp) — don't ingest it, the effective date is still a placeholder.

**⚠️ On #8:** pages 44–45 are the inspection-order charts and they are **images with no extractable text**. A text-only pipeline loses them silently. Use AC1229 pp12–13 instead, which is real text.

**⚠️ On Auckland Council's licence:** it is **not** Creative Commons. It permits reproduction *"for informational purposes"* with accurate reproduction and acknowledgement. Undefined for a paid product. Your citation-card design — verbatim excerpt shown beside the answer — fits *"reproduce it accurately"* considerably better than a paraphrasing product would. Worth preserving that deliberately, and worth a lawyer's read before launch.

---

## TIER 2 — Worth an email. High value, licence needs permission.

Ranked by probability of yes × value. Every one of these is free to download and restricted to reuse.

| Priority | Who | What you'd get | The ask |
|---|---|---|---|
| **1** | **Auckland Council** (LGOIMA) | The remaining AC3601 modules — **wrap/cavity/cladding first**, since that's where your six flashing fails live | Not a permission ask, a request. File at fyi.org.nz; the release becomes public and citable. Free |
| **2** | **NZQA** | 269 carpentry unit standards — the closest thing to NZ-native build-sequence knowledge that exists | Explicitly carved out of NZQA's CC BY: *"unit standards and achievement standards"* excluded, citable but other uses need permission. One email |
| **3** | **Window & Glass Association NZ** | 5 guides, ~213pp on window install, flashings, barriers — lands directly on your ICA fails | All silent on reuse. Named technical staff publish their emails. Highest-probability yes in the survey |
| **4** | **James Hardie NZ** | ~50 technical manuals incl. Bracing Design and Cladding Junctions Detail Design | No reproduction clause anywhere in their PDFs. They publish `literaturefeedback@jameshardie.co.nz` |
| **5** | **Hutt City Council** | ⭐ 24 inspector-side checklists, ~148pp, Ver 14 Nov 2024, with explicit *"If yes, fail the inspection"* rules | The single best non-Auckland document found — and Hutt has **no discoverable copyright statement at all**. Ask before building on it |
| **6** | **Winstone Wallboards (GIB)** | Noise Control (132pp) + Fire Rated Systems (152pp). These answer your acoustic and passive-fire items better than any government document | Hardest ask. Class C, and the Site Guide is a priced publication. Fletcher legal decides, not the technical team |
| **7** | **Standards NZ** | NZS 3604 under the Digital Products Licensing programme | **Fee-free during development**, revenue share at commercialisation. Precedent: LawHawk licensing NZS 3910. Scope the first ask to NZS 3604 alone — NZ-only copyright, already MBIE-sponsored. Don't open with joint AS/NZS |
| **8** | **Wellington Water** | Regional Standard for Water Services, 139pp, binding across four cities | Explicit non-commercial share-alike: *"not used or sold for profit"*. `standards@wellingtonwater.co.nz` |
| **9** | **ARDEX NZ** | 386pp waterproofing manual, silent on reuse | Biggest single Class-B page count found |
| **10** | **BRANZ** | 614 free research reports incl. ER49 *The economic cost of quality defects* and SR387 *Common residential housing defects* | See Tier 3 — this is a licence purchase, not a permission email |

**The framing that works on manufacturers:** *"Your installation manual, quoted verbatim and cited by document name and page, shown to a builder at the moment they're about to install your product. No paraphrasing that could misstate your spec, always pointing at your current published version."* Incorrect installation is their warranty cost — this is aligned with their interest. Offer a version-pinned corpus with a refresh commitment; staleness is the objection they'll actually raise.

---

## TIER 3 — Do not ingest.

| What | Why |
|---|---|
| **BRANZ, all of it** | Terms of use cl 3.1(k): *"conduct, facilitate, authorise or permit the use of any Content from the Website in any artificial intelligence programme."* Plus 3.1(j) bans scraping and 3.1(a) bans use "for the purposes of competing with Us". No carve-outs. **Also: audit the existing index and remove any BRANZ material before a customer launch.** Pre-emptive removal is a very different conversation from post-complaint |
| **NZ Standards, all of them** | Standards NZ's Digital Products Licensing page names *"AI tools and LLMs (including prompts, outputs, or knowledge bases)"*. The free sponsored PDF is a free *copy under a personal-use licence*, not free content |
| **Chorus technical requirements** | Every page footer reads "Chorus Confidential"; terms bar storage "in a retrieval system". Painful — their Vol 1 Table 4 has the exact power/comms clearances your data failed on |
| **TCF Premises Wiring Guidelines** | Same "retrieval system" prohibition |
| **QLDC Land Development Code** (462pp) | *"NO PRINTING IS PERMITTED"* on nearly every page, and it embeds NZS 4404:2010 under a Standards NZ licence issued to QLDC alone |
| **ECan Erosion & Sediment Control Toolbox** | *"must not be used in any way for any commercial purpose without the prior written consent"* |
| **ABCB Housing Provisions** (Australia) | CC BY-**ND** blocks derivatives, and it's the highest jurisdiction-confusion risk in the survey — looks NZ-adjacent, isn't. AS 1684 ≠ NZS 3604 |
| **Building Science Corporation** | Non-commercial only, no reposting |
| **Messner / Forehand construction texts** | CC BY-**NC** |
| **Napier, Hastings, Horizons, Waimakariri (website), Western Bay, Hamilton, Whangarei, BOPRC, Christchurch** | All reserve rights or restrict to non-commercial. Christchurch's B-306 covers five councils and is genuinely excellent — but it's "personal and non-commercial only" |

---

## The gap money can't close

| Category | Your failures | Answerable free | Why |
|---|---|---|---|
| Fire | 19 | **~17** | C/AS2 + BPS + GIB is genuinely strong |
| Interior / Linings | 8 | **~8** | GIB territory |
| Acoustic | 7 | ~5 | GIB Noise Control. Pipe lagging is a real hole |
| Plumbing & Drainage | 62 | ~20 | Rest is AS/NZS 3500 |
| Mechanical | 35 | ~12 | Fire dampers yes; FCU vibration isolation has no free source |
| Seismic | 2 | 0 | NZS 4219 answers both outright — blocked only by licence |
| **Electrical** | **75** | **~8** | **Every item is AS/NZS 3000. No free NZ document states any of it** |

Those per-category numbers are a researcher's judgement, not a benchmark. **Before spending anything on standards licences, take 20 real failure items from the three worst categories and run them against a Tier 1 corpus.** That turns an estimate into a number worth buying from.

Prices if you go that way: AS/NZS 3000 **$256.16**, AS/NZS 3500 Parts 1–4 **$976.06**, all + GST. The only published licence price anywhere is **$6,705** for a two-year adaptation licence on one standard — so four figures per standard is the realistic order of magnitude.

---

## Two things that fell out of this that aren't documents

**A free compliance feature, zero licence risk.** Standards NZ lists sponsored standards as *separate products* from their amended versions — `NZS 2295:2006 – excluding Amendment 1` is free; the amended one is $193. Same on `NZS 1170.5:2004 (Excludes Amdt 1)` and `NZS 4223.3:2016 excluding Amendment 1`. **A builder using the free copy may be reading a superseded amendment state and not know it.** Soterra can flag that from public metadata alone, without reproducing a word. Standards NZ also expressly permits *"refer to a standard's name and number, and link to the page on our website"* — so "NZS 3604 clause 7.1.2 governs this, open the free PDF here" is legal today.

**Write the build sequence yourself.** There is no openly-licensed end-to-end residential build sequence anywhere — I looked hard. But you have 27 real council reports and the inspection order already encoded. A ~20-page *NZ residential build sequence*, authored by Soterra and reviewed by a builder, becomes a first-class citable source with zero licence risk and perfect NZ fit. Given every failed item in your own data was a plan lookup or code figure, an in-house sequence document is more defensible than a licensed foreign one.

---

## Controls this list implies

- **Jurisdiction tag per document**, and a standing rule: never state an NZ dimension, bracing value, treatment level or legal duty from a non-NZ source. Your code layer audited 15/15 with zero fabrications — mixing jurisdictions untagged is how that record breaks.
- **Page-level licence exclusion, not document-level.** Manufacturer guides embed NZS content under licences issued to that publisher by name (Pryda 000925, MiTek 000907). A full yes from Pryda still wouldn't cover the NZS 3604 pages inside Pryda's own guide — and those are the valuable pages.
- **Version-stamp and staleness-warn CodeMark systems.** They oblige installation per the *current* manual. Serving a stale detail is product-liability exposure, which cuts directly against the liability-defence positioning.
- **Check text density per page on ingest.** Two documents here are traps: AC1824's inspection-order charts are images, and GWRC's 294-page ESC guide is an OCR'd scan where some pages yield 2,000 clean characters and others yield 22. Both fail silently.
- **Retrieval cost.** The infrastructure codes total ~2,900 pages of subdivision engineering. At $0.048/question with 74% of cost in retrieval payload, loading them wholesale dilutes retrieval for a builder asking about framing. Take GD05, BC5850 and ATCOP §14/§16; hold the rest until a customer asks.

---

## Not finished — four tracks died on a session limit

Signal only. **Do not cite any of this without verifying it.**

| Track | Where it got to |
|---|---|
| **Legislation & case law** | Harvested 419 Weathertight Homes Tribunal decision PDFs. LBP Building Practitioners Board decisions are hard-blocked by Imperva. legislation.govt.nz 403s automated fetching. 2026 reform status never confirmed |
| **Health & safety** | Partial signal that **WorkSafe PDFs carry CC BY-NC, not plain CC BY**. If true that blocks commercial use and contradicts the usual NZ-government pattern. Needs re-checking — it matters |
| **Engineering societies** | Died before NZGS modules 2–6, NZSEE seismic assessment, SESOC, Engineering NZ's CM1–CM5 construction-monitoring practice notes, Canterbury Royal Commission |
| **MBIE guidance & determinations** | Died before the final pass. Codewords archive, determinations bulk access and the tolerances guide are all unconfirmed |
| **Passive fire (manufacturer)** | Highest-value unresolved lead. C/AS2 4.3.2.3 requires installation *"identical to the prototype used in tests"* — so the manufacturer's manual **is** the compliance benchmark. Hilti/Promat/Trafalgar/3M + FENZ/FPANZ unverified |
| **Free bracing ratings** | Signal that **MBIE may now publish bracing ratings directly**. If true it partly substitutes for the NZS 3604 tables. Worth chasing first |
| **Far North DC, Tasman DC** | Far North is Cloudflare-blocked, entirely untested. Tasman reportedly has a builder-facing "Building Site Guide", unverified |

---

## If I were picking

**Tonight:** Tier 1 items 1–11 and 13–16. About 1,000 pages, no permission needed, and it doubles what Soterra can answer on fire, linings, compliance schedules and inspection process.

**This week:** the LGOIMA request for the remaining AC3601 modules — free, and it makes them public, which means a competitor could get them too but only if they know to ask. Plus the NZQA and WGANZ emails.

**Before launch:** a lawyer on the Auckland Council terms, and the BRANZ audit.

**Don't rush:** the standards licence. Benchmark 20 real failure items first, then decide whether AS/NZS 3000 earns its $256.
