## Bottom line

A brand-new, empty company account can demo **three of the eleven model-facing tools well**, one adequately, and **three not at all**. Manufacturer answers are limited to **GIB, BOSS Fire and Kingspan Thermakraft only** — confirmed by running the real ranking code. I have 30 verified questions that retrieve correctly and 4 that must not reach the demo.

There is also **one live leak** (`create_checklist` bypasses the demo gate) and **one prompt/reality mismatch** (the assistant is told it holds 14 manufacturers; a new account can only see 3) that will both bite tomorrow if not handled.

Verification script: `C:\Users\adam\Desktop\Soterra Github\Soterra\soterra-web\dev\_demo-questions.mts` (read-only, run with `npx tsx dev/_demo-questions.mts`).

---

## 1. Every tool the assistant can call

`app/api/ask/route.ts` defines 22 tools in `TOOLS` (line 121), withholds 11 via `CALENDAR_TOOL_NAMES` (line 414), leaving `ACTIVE_TOOLS` (line 419). I enumerated it by parsing the file rather than reading by eye — the result is **11 tools**, plus the Anthropic server-side `web_search` tool added at line 1225.

| Tool (exact name) | What it does | Needs | Works on an EMPTY account? |
|---|---|---|---|
| `search_plans` | TF-IDF over this site's uploaded drawings/specs, returns up to 8 pages | Uploaded plans (`planPages`) | **NO.** Returns `"Nothing matched in this site's uploaded plans."` |
| `review_plans` | Reads the FULL text of every plan page for clash/completeness review | Uploaded plans | **NO.** Returns `"No plans are uploaded for this site yet."` |
| `search_code` | TF-IDF over the free MBIE Building Code corpus | `code_pages` table | **YES.** Verified: **3,203 pages, 67 documents** loaded |
| `standards_handoff` | Renders a card pointing at an NZS with edition + free download link | `lib/standards.ts` registry (15 standards, hard-coded) | **YES**, but degraded. The `answer` field (the actual figure) comes from `demoPagesFor()` and is gated behind `canSeeDemoCorpus` — a new account gets the card and a qualitative answer only, never the number |
| `search_determinations` | Postgres full-text over MBIE determinations | `determination_pages` | **YES.** Verified: **364 determinations, 6,121 pages, 2019–2026**. ⚠ see §4 |
| `search_manufacturer` | Ranked search over manufacturer literature, licence-filtered per user | `manufacturer_pages` + `visibleTo()` | **YES**, but only 3 brands — see §2 |
| `search_history` | This company's own past failed inspection items | `ctx.scope` + filed reports | **NO.** Scope exists (see below) but returns `"Nothing in this company's filed inspection history matched."` |
| `create_checklist` | Generates + saves a real tickable pre-inspection checklist | `ctx.scope`; reads plans + Code + manufacturer + history | **YES but degraded + LEAKY.** Runs on Opus, ~30–60 s. With no plans it falls back to Code + manufacturer only. See §3 |
| `create_safety_plan` | Generates a SWMS/JSA from HSWA 2015 + WorkSafe practice | `ctx.scope` only | **YES, fully.** `generateSwmsItems()` does **no retrieval at all** — this is the single most demo-safe generative feature on an empty account |
| `delete_event` | Deletes a calendar event | An event id | **Leaked into ACTIVE_TOOLS** — see finding below |
| `delete_task` | Deletes a task | A task id | **Leaked into ACTIVE_TOOLS** — see finding below |
| `web_search` | Anthropic server tool, `max_uses: 2` | — | **YES** |

**Does a new account have `scope`?** Yes. `app/api/projects/route.ts:73-92` creates a company on first site creation (behind `SOTERRA_ACCESS_CODE`), so `companyIdForProject()` returns a real id and `ctx.scope` is non-null. `create_checklist` and `create_safety_plan` will not hit the `"This site isn't set up with a company yet"` error.

**Finding — two calendar tools are still exposed.** The comment at line 409 says scheduling is withheld "so it doesn't offer to book or remind", but `delete_event` and `delete_task` are absent from `CALENDAR_TOOL_NAMES` and therefore remain in `ACTIVE_TOOLS`. Harmless tomorrow (nothing exists to delete, and `find_items` *is* withheld so the model can't obtain an id), but the model can see two tools that contradict the "Soterra is NOT a calendar" instruction at prompt line 1077.

---

## 2. What a NEW account can and cannot see — CONFIRMED

Your belief is correct. `visibleTo()` (`lib/manufacturerIndex.ts:73`) drops every `licence === "demo"` page unless `canSeeDemoCorpus(userId)` returns true, and that only passes for Clerk ids listed in `DEMO_CORPUS_USERS`. **`.env.local` currently lists 4 user ids.** `app/api/ask/route.ts:761` applies the filter before ranking.

Actual output of the script:

```
canSeeDemoCorpus(new account) = false
canSeeDemoCorpus(null)        = false

FOUNDER / demo-allowed account sees 1516 manufacturer pages:
   GIB                       823 pages   [pending]
   BOSS Fire                 305 pages   [pending]
   James Hardie              154 pages   [demo]
   Kingspan Thermakraft       95 pages   [pending]
   Rondo                      60 pages   [demo]
   Concrete NZ                35 pages   [demo]
   ColorSteel                 23 pages   [demo]
   Resene                     10 pages   [demo]
   Allproof                    7 pages   [demo]
   Ryanfire                    4 pages   [demo]

BRAND NEW ACCOUNT sees 1223 manufacturer pages:
   GIB                       823 pages   [pending]
   BOSS Fire                 305 pages   [pending]
   Kingspan Thermakraft       95 pages   [pending]

HIDDEN from a new account (7 brands): 293 pages
```

**CAN answer from (3 brands, 82 documents):**
- **GIB / Winstone Wallboards** — 21 documents: Fire Rated Systems (146p served), Noise Control Systems (129p), Site Guide 2024 (122p), Weatherline Design & Construction (64p), Noise Control Supplement (50p), Intertenancy Barrier Systems (48p), X-Block Radiation Shielding (40p), EzyBrace Systems (32p), Wet Area Systems/Aqualine (30p), Healthcare Design Guide (28p), Rondo Metal Batten Systems (25p), Rigid Air Barrier Systems Guide (16p), Weatherline RAB Supplement (16p), EzyBrace Bracing Supplement (16p), Curveline (12p), Tough Systems (12p), GIBFix Framing (8p), EzyBrace Steel Frame (8p), Suspended Ceilings (7p), Compound Supplement (7p), Site Guide Supplement (3p), Bracing Plates (2p), Curved Walls (2p)
- **BOSS Fire** — 28 documents: FyreBox TDS (44p), Quick Reference Guide HVAC Systems (57p), QRG FireMastic-HPE (39p), QRG 60min Plasterboard Systems (19p), FyreBox Cast-In (17p), FastWrap-XLS (16p), Cable Transits CT120/CT240 (13p), FacadeGard (12p), FireMastic-HPE (8p), FireMastic-300 (7p), FlexiCoat-MAK (7p), MaxiCollars (6p), FireMortar-360 (6p), Batts (6p), PenoPatch (6p), UniWrap (6p), Ablative Coating (5p), FireSilicone-EMA (5p), FireStrip-ALX (5p), FlexiBatt (5p), P40-MAK Wrap (5p), Thermal Defence Wrap (5p), + 6 BPIR statements
- **Kingspan Thermakraft** — 33 documents: the Covertek 215/401/403/405/407 install guides + data sheets, Thermakraft 213/215/220, Watergate Plus, RainArmor Self Adhesive, Aluband Window Flashing Tape, Thermaflash, Thermabar 344/397, OneSeal, NZ Tape Selection Range

**CANNOT answer from (7 brands, silently invisible):** James Hardie, Rondo, Concrete NZ, ColorSteel, Resene, Allproof, Ryanfire. Also **47 GIB pages carry `licence = 'archived'`**, excluded from `SERVED_LICENCES` and served to nobody.

Not manufacturer-gated, available to everyone: the Building Code corpus (3,203p / 67 docs) and the 364 MBIE determinations (6,121p).

**Citation viewer works.** `app/api/doc-page/route.ts:57` applies the same gate (`row.licence === "demo" && !canSeeDemoCorpus(userId)` → 404), and `app/api/manufacturer-docs/route.ts:36` uses `visibleTo`. I fetched **all 82 served documents' `source_url` and every one returned HTTP 206** — no dead links. Caveat: only 119 of 823 GIB pages are pre-rendered to Blob; **BOSS Fire and Kingspan have 0 pre-rendered pages**, so every one of their citation cards depends on a live `unpdf` render on Vercel. That path is exactly the one that produced blank pages for some GIB PDFs (hence the pre-render script), so test a BOSS Fire and a Kingspan citation card in the live app before relying on it on stage.

---

## 3. 🔴 TWO ISSUES THAT WILL BITE ON A NEW ACCOUNT

**(a) `create_checklist` bypasses the demo gate — verified, not theoretical.**
`lib/checklist.ts:216` reads:
```ts
const mfrHits = retrieve(mfrIdx.pages, mfrIdx.df, q, 6);
```
It calls `getManufacturerIndex()` and never applies `visibleTo()`. Running the exact `CODE_QUERIES` from that file against the unfiltered index:

```
IPB: 6 mfr pages, 0 of them DEMO-TIER
ICA: 6 mfr pages, 1 of them DEMO-TIER
   [demo] James Hardie · James Hardie Axon Panel Timber Cavity Batten Technical Specification · page 17 of 80
ICL: 6 mfr pages, 2 of them DEMO-TIER
   [demo] James Hardie · ... page 29 of 80
   [demo] James Hardie · ... page 10 of 80
IPL: 0   IFG: 0
```
So generating a **cavity (ICA)** or **cladding (ICL)** checklist on a brand-new customer account produces items citing James Hardie pages the account is not entitled to — and the citation card then 404s, because `doc-page` *does* enforce the gate. For tomorrow: **demo the checklist with a fire, pre-line (IPB), post-line (IPL) or framing (IFG) subject, not cavity or cladding.**

**(b) The prompt promises 14 manufacturers; a new account holds 3.**
The `search_manufacturer` description (route.ts:185) and `STATIC_PROMPT` section 3 (line 1057) both enumerate GIB, Kingspan Thermakraft, BOSS Fire, James Hardie, Rondo, Ryanfire, Resene, ColorSteel, Concrete NZ, Allproof, Roofing Industries, Dimond, APL — and instruct a HARD RULE to call `search_manufacturer` on any of their product names. Neither string is filtered per user. On a new account the model will confidently claim to hold Allproof/Resene/James Hardie, search, get nothing back, and have to walk it back mid-demo. **Do not ask anything naming those brands or their products.** (Roofing Industries, Dimond and APL are named in the prompt but are not in the database at all any more — they were deleted post-demo per the demo-corpus policy.)

---

## 4. Determinations: long questions return ZERO

`searchDeterminations()` uses `websearch_to_tsquery`, which **ANDs every term**. Verified failures vs successes on the same subject:

| Query | Hits |
|---|---|
| `"MBIE ruling on fire separation between units in a multi unit building"` | **0** |
| `"fire separation between units"` | 3 |
| `"determination about passive fire penetrations not sealed"` | **0** |
| `"passive fire penetration"` | **0** |
| `"fire penetration sealed"` | 3 |

Keep determination questions to 2–4 substantive words. The assistant phrases its own query, so a long user question can still produce a short tool query — but it's a coin toss, and an empty determinations result on stage looks like the corpus is missing.

---

## 5. VERIFIED SHORTLIST — questions that retrieve well, with the page each would cite

All run through `searchManufacturerPages(visibleTo(pages, newUser), df, q, 8, allPages.length)` / `retrieve()` / `searchDeterminations()` — the identical code paths the live route uses. **None of these 30 showed any founder-vs-new-account divergence in the top-3 brands**, i.e. not one leans on a hidden brand.

### Fire-rated systems (GIB) — strongest territory
| Question | Cites |
|---|---|
| "What fire rating does a GIB Fyreline wall achieve?" | GIB · GIB Fire Rated Systems · p111/152 |
| "GIB fire rated wall fastener type and centres for the first layer" | GIB · GIB Fire Rated Systems · p82, p36, p42, p37 |
| "GBTL 60 system board and framing specification" | GIB · GIB Fire Rated Systems · p143, p4, p15, p3 (exact-code path fires) |
| "GIB Fyreline fire rated system 60 minutes" | GIB · GIB Fire Rated Systems · p127, p36, p143, p124 |

### Passive fire (BOSS Fire) — clean, all top-5 in-brand
| Question | Cites |
|---|---|
| "BOSS Fire FastWrap XLS on a plastic pipe" | BOSS Fire · FastWrap-XLS TDS · p2, p10, p13, p12, p11 (all 5 correct doc) |
| "BOSS Fire FyreBox cast-in transit for cables" | BOSS Fire · FyreBox Cast-In TDS · p3, p17, p2; Cable Transits CT120/CT240 TDS · p3 |
| "BOSS FireMastic sealing a penetration through a fire rated wall" | BOSS Fire · QRG 60min Plasterboard Systems · p17; FireMastic-300 TDS · p2, p4 |
| "BOSS Fire MaxiCollars technical data sheet pipe sizes" | BOSS Fire · MaxiCollars TDS · p1/6 (⚠ ranks #2 — see reject list) |

### Intertenancy / noise separation (GIB)
| Question | Cites |
|---|---|
| "GIB intertenancy barrier system for terrace homes" | GIB · GIB Intertenancy Barrier Systems · p7, p5, p3, p6 |
| "GIB Noise Control Systems intertenancy STC rating" | GIB · GIB Noise Control Systems · p77, p78, p19, p82 |
| "Acoustic insulation required in a GIB noise control wall system" | GIB · GIB Noise Control Systems Supplement · p15; Noise Control Systems · p76, p77, p78 |

### Bracing (GIB)
| Question | Cites |
|---|---|
| "Bracing element ratings for GIB EzyBrace" | GIB · GIB EzyBrace Systems · p8; EzyBrace Steel Frame Systems · p6, p2; EzyBrace Bracing Supplement · p6 |
| "GIB Braceline sheet fixing and hold down for a bracing panel" | GIB · GIB EzyBrace Systems · p29, p30, p28 |

### Wet areas (GIB)
| Question | Cites |
|---|---|
| "GIB Aqualine behind tiles in a shower, is a membrane required?" | GIB · GIB Wet Area Systems (Aqualine) · p7; GIB Site Guide 2024 · p83–86 |
| "GIB Aqualine wet area systems" | GIB · GIB Wet Area Systems (Aqualine) · p28, p31, p9, p7 |

### Rigid air barrier / weathertightness (GIB + Kingspan) — Kingspan is the cleanest brand in the corpus
| Question | Cites |
|---|---|
| "GIB Weatherline rigid air barrier installation and fixing" | GIB · GIB Weatherline Design and Construction Manual · p11, p6, p16, p20; Rigid Air Barrier Systems Guide · p7 |
| "Kingspan Thermakraft Covertek underlay installation over framing" | Kingspan Thermakraft · Covertek 215/401/403/405/407 Installation Guides · p1 each |
| "Watergate Plus wall underlay lap and fixing" | Kingspan Thermakraft · Watergate Plus Installation Guide · p2, p1; Watergate Plus PDS · p2, p1, p3 (all 5 correct doc) |
| "Thermakraft Aluband window flashing tape application" | Kingspan Thermakraft · Aluband Window Flashing Tape PDS · p2; Aluband Installation Guide · p3, p1, p2 |
| "Kingspan Thermakraft RainArmor self adhesive installation" | Kingspan Thermakraft · RainArmor Self Adhesive Installation Guide · p1, p4, p2; RainArmor PDS · p1, p2 (all 5 correct doc) |
| "Thermakraft 220 roof underlay installation" | Kingspan Thermakraft · Thermakraft 220 PDS · p2, p1; 220 Installation Guide · p2, p1 |
| "OneSeal pipe penetration seal installation" | Kingspan Thermakraft · OneSeal Pipe and Cable Wall Penetration Seals Installation Guide · p2, p1; OneSeal PDS · p2, p1 |

### Building Code clauses — all 9 land on the right Acceptable Solution
| Question | Cites |
|---|---|
| "E2 cavity requirement for direct fixed cladding risk score" | E2 Riskmatrix · p20, p19; E2 External Moisture AS1 (4th ed) · p193, p195, p97 |
| "Minimum clearance from finished ground level to cladding, E2" | External Moisture an Introduction · p36; E2 External Moisture AS1 · p89, p88, p87; Constructing Cavities · p17 |
| "What does C/AS2 require for fire separation between firecells?" | C Protection From Fire AS2 (2nd ed) · p20, p101, p68, p74 |
| "C/AS2 requirements for fire doors on an exitway" | C Protection From Fire AS2 (2nd ed) · p20, p70, p65, p81 |
| "G12 hot water delivery temperature at the tap" | G12 Water Supplies (3rd ed, amdt 14) · p47, p46, p6 |
| "F4 barrier height and the 100mm sphere gap" | F4 Safety From Falling (3rd ed) · p13, p5, p17 |
| "E3 internal moisture requirements for a shower and impervious surfaces" | E3 Internal Moisture AS2 (1st ed) · p2, p1, p3 |
| "D1 stair riser and going limits for a common stairway" | D1 Access Routes (2nd ed, amdt 6) · p32, p29, p35, p36, p52 (all 5 correct doc) |
| "Does this window need safety glass? F2 human impact" | F2 Hazardous Building Materials (1st ed, amdt 3) · p15, p9 — and this is the one that naturally triggers `standards_handoff` → NZS 4223.3:2016 card |

### Determinations — short phrasings only
| Question | Cites |
|---|---|
| "Council refused a code compliance certificate for weathertightness" | Determination 2025/015 p2/13 (Oamaru); 2024/062 p6/21 (Omaha); 2023/021 p2/17 (Whangarei); 2023/019 p2/25 (Wellington); 2022/019 p2/20 (Katikati) |
| "Pool barrier" | Determination 2023/001 p22/24 (Thames); 2021/024 p8/12 (Greenhithe); 2021/009 p2/20 (Raumati Beach); 2020/018 p8/19 (Papamoa); 2019/066 p4/12 (Remuera) |
| "Council notice to fix on a dangerous building" | Determination 2026/004 p7/28 (Manly); 2024/001 p5/72 (Pyes Pa); 2024/038 p2/25 (New Lynn); 2020/025 p10/23 (Twizel); 2023/038 p20/22 (Oriental Bay) |
| "Bracing" | Determination 2023/006 p8/11 (Rolleston, bracing design compliance); 2026/014 p3/8 (Rotorua, B1/AS1 bracing); 2024/006 p12/20; 2024/007 p13/15 |
| "Intertenancy wall fire" | Determination 2019/010 p2/10 — *code compliance of an intertenancy wall in an apartment building with respect to sound transmission* (a genuinely strong PM story); 2026/007 p9/24; 2019/070 p7/22 |
| "Fire separation between units" | Determination 2025/002 p3/10 — *proposed refusal of consent for two multi-unit buildings re application of C/AS1 Part 5*; 2024/041 p15/20; 2025/028 p14/30 |

### Best single demo narrative
Ask the F2 safety-glass question → `search_code` returns the F2 clause **and** `standards_handoff` renders the NZS 4223.3:2016 card with the free standards.govt.nz link. That shows the citation engine, the honest "we point, we don't reproduce" position, and the standards story in one exchange, with zero dependency on uploaded plans.

---

## 6. REJECT LIST — do not use these

| Question | Why |
|---|---|
| "MBIE ruling on fire separation between units in a multi unit building" | **0 results.** Too many ANDed terms |
| "Determination about passive fire penetrations not sealed" | **0 results.** Same cause |
| "BOSS Fire MaxiCollar fire collar for a PVC pipe penetration" | MaxiCollars TDS does not appear in the top 5 at all — the HVAC guide and FireMastic-HPE guide outrank it because "collar/pipe/penetration" saturate them. Use "BOSS Fire MaxiCollars technical data sheet pipe sizes" instead, and even then it ranks #2 behind the 60min Plasterboard QRG |
| "Kingspan Thermakraft RainArmor roof underlay minimum pitch and support" | Returns **five Covertek pages and zero RainArmor pages** — wrong product inside the right brand. Use "RainArmor self adhesive installation" |
| "GIB Noiseline STC rating for a separating wall between units" | Top 2 are *GIB Fire Rated Systems* p106/p111, not the noise manual. Use "GIB Noise Control Systems intertenancy STC rating" |
| "GIB Aqualine fixing centres in a wet area" | #1 and #2 are *Noise Control Systems Supplement* p24 and *Healthcare Design Guide* p22; Aqualine only reaches #3. Answerable (it's inside the k=8 window) but the top hit is off-subject — use "GIB Aqualine wet area systems" |
| Anything naming **Allproof, James Hardie, Rondo, Ryanfire, Resene, ColorSteel, Concrete NZ, Roofing Industries, Dimond, APL/Centrafix/Altherm/Vantage** | Invisible to a new account, but the prompt tells the model it holds them → confident claim followed by an empty search |
| Anything about **this project's plans, drawings, specs, RFIs from the plans, clash review** | `search_plans` / `review_plans` return the "no plans uploaded" note |
| Anything about **past inspection failures / "what do we keep failing"** | `search_history` is empty |
| **`create_checklist` for cavity (ICA) or cladding (ICL)** | Pulls hidden James Hardie pages whose citation cards then 404 |

## Risks
- create_checklist leaks demo-tier pages: lib/checklist.ts:216 calls retrieve() on the raw getManufacturerIndex() with no visibleTo() filter. Verified — an ICA (cavity) checklist pulls 1 James Hardie page and an ICL (cladding) checklist pulls 2, on any account. The citation card for those items will 404 because app/api/doc-page/route.ts DOES enforce the gate, so it looks broken as well as being a permission problem with a manufacturer who has not answered.
- The static prompt and the search_manufacturer tool description hard-code all 14 manufacturers regardless of who is asking. A new account will hear the assistant claim it holds Allproof/James Hardie/Rondo/Resene/APL etc., then get an empty search. Three of those (Roofing Industries, Dimond, APL) are not in the database at all any more.
- BOSS Fire and Kingspan Thermakraft have ZERO pre-rendered page images (only 119 of 823 GIB pages are pre-rendered). Every citation card for those two brands relies on a live unpdf render on the Vercel Linux runtime — the exact path that produced blank pages for some GIB PDFs and prompted the pre-render script. Untested for these two brands; test one of each in the live app before the demo.
- DEMO_CORPUS_USERS currently lists 4 Clerk user ids. If Adam demos while signed in as any of those, he will see all 10 brands and the NZS 3604 figures, which is NOT what a prospect's account will do. The demo must run on an account that is not in that list.
- searchDeterminations uses websearch_to_tsquery (AND semantics). The assistant writes its own query string, so even a well-chosen user question can produce a long tool query and return zero rows. Determination questions are the least deterministic part of the demo.
- delete_event and delete_task are missing from CALENDAR_TOOL_NAMES and remain in ACTIVE_TOOLS, contradicting the 'Soterra is NOT a calendar' instruction. Harmless on an empty account (nothing to delete, find_items is withheld so no ids are obtainable) but the model can see them.
- create_checklist runs claude-opus-4-8 with effort:high inside the 300s agent loop and takes 30-60s. On a live demo that is a long silence, and any Anthropic 429/529 surfaces as 'The assistant couldn't be reached just now.' Soterra is its own Anthropic org — confirm the credit balance before demoing, since checklist.ts has an explicit 'out of credit' error branch.
- Retrieval was verified; ANSWER QUALITY was not. I confirmed the correct page reaches the model's 8-result window, not that the model reads it correctly or that the figure on that page is the one a PM would want. The two GIB questions flagged with off-subject top hits (Aqualine fixing centres, Noiseline STC) are the likeliest to produce a plausible-but-wrong answer.
- Label/count mismatch worth knowing: GIB Fire Rated Systems cites as 'page N of 152' but only 146 pages are served (6 are in the 47-page 'archived' GIB tier). Cited pages always come from retrieval so they are always served, but the denominator in the citation is larger than what exists in the product.