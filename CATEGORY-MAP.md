# Category map — please check this, Adam

_Drafted 2026-07-22 from the 27 real Auckland Council reports in `All inspection reports/Council/` (270 distinct checklist lines). This is BUILD-PLAN open item 2. You'll spot in seconds what would take me an hour to get wrong._

The live version is `soterra-web/lib/categories.ts`. Change it there, or tell me what's wrong and I'll change it.

---

## What a "category" actually decides

Every failed item gets exactly one category, and the Insights page counts items per category. So this file is the product's opinion about **what your crew keeps getting pulled up on**.

The important design call: **the category comes from what physically went wrong, not from which inspection found it.** A passive-fire stopping fail found on a post-line inspection is `Fire`, not `Interior / Linings`. That's why 79 of the 259 council checklist lines land in Fire even though there is no "fire inspection" code.

## How an item gets classified, in order

1. **A keyword rule** on the item's own wording. First match wins. Deterministic, so the same wording always lands in the same bucket no matter which model read the report.
2. **The model's suggestion**, if no rule matched and the suggestion is a real category.
3. **The inspection code's default** (below).
4. `Other`.

Against the 259 real checklist lines, the rules alone match **255 (98.5%)**. The 4 that fall through are genuinely generic admin lines — "As-built plan available onsite", "Test and method", "As-built plan scope", "Complies with Manufacturers test reports/ specifications".

---

## Council code → readable name + fallback category

**✅ Q1 CLOSED 2026-07-22** — checked against Auckland Council's own published "Types of building inspections" page. Three of my guesses were wrong and are gone: `IBF` (the real code is **ICB**), plus `IPF`, `IRF`, `IDP` and `IMV`, which don't exist. Three real ones were missing and are now in: **CPU**, **SWP**, **IRM**. All 17 below match the council page exactly, no extras, none missing.

| Code | Name | Fallback category |
|---|---|---|
| IFO | Foundation | Structural |
| ISF | Concrete floor slab | Structural |
| ICB | Concrete block / reinforcing | Structural |
| IFG | Framing | Structural |
| ICA | Cavity wrap | Weathertightness / Cladding |
| ICL | Cladding | Weathertightness / Cladding |
| ITK | Waterproofing membrane | Weathertightness / Cladding |
| IDT | Drainage | Plumbing & Drainage |
| IPP | Plumbing (underslab / pre-line) | Plumbing & Drainage |
| IPB | Pre-line building | Interior / Linings |
| IPL | Post-line building | Interior / Linings |
| IF1 | Residential final | Interior / Linings |
| IF2 | Commercial final | Interior / Linings |
| CPU | Certificate for Public Use | Access & Barriers |
| SWP | Swimming pool fencing | Access & Barriers |
| IME | Site meeting | Other |
| IRM | Reclad pre-construction meeting | Other |

One code, **IPP**, covers both the underslab and the pre-line plumbing inspection — that's the council's own doing, not a merge on our side.

The fallback only fires when nothing in the item's wording matched, which is 1.5% of the time — so a debatable fallback on IPB/IPL/IF1/IF2 barely matters. Those four legitimately produce fails across half the categories anyway, which is exactly why the wording wins.

**Consultant disciplines** sit alongside these, with their own codes so they can never collide: FIRE, ELEC, MECH, HYD, STRU, ARCH, ACOU, SEIS and SERV (one report covering electrical + hydraulic + mechanical together).

---

## Where your 259 council checklist lines actually land

| Category | Lines | Reads as |
|---|---:|---|
| Fire | 80 | passive fire, fire stopping, collars, fire doors, sprinklers, alarms, exit signs, emergency lighting |
| Plumbing & Drainage | 48 | foul/storm water, pipework, gradients, HWC and its valves, gullies, traps, vents |
| Weathertightness / Cladding | 43 | cavity, wrap, RAB, flashings, membranes, saddles, upstands, deck/balcony |
| Structural | 34 | framing, studs, lintels, bracing, plates, blockwall, moisture content, timber treatment |
| Interior / Linings | 30 | linings, GIB, wet areas, tiles, insulation, ceilings, glazing, slip resistance |
| Access & Barriers | 10 | barriers, balustrades, stairs, F4 restrictors, access hatches |
| Acoustic | 5 | acoustic insulation, intertenancy acoustic systems |
| Mechanical | 3 | ventilation, extractor hoods |
| Electrical | 1 | — |
| Seismic | 1 | HWC seismic restraints |
| Site / External | 0 | — |
| Architect | 0 | — |

**❓ Q2 — still open, by design.** Your prediction was that the top electrical item would be seismic clearances. Council data can't confirm or deny it: there's essentially no electrical content in a council checklist (1 line out of 259), and one seismic line ("HWC: Seismic restraints"). Your call on 2026-07-22: *"this will come to light once I finally upload the electrical inspections, council could not care less about that."* Agreed — the Electrical folder is 12 files and cable-tray seismic restraint is a classic. Re-check this table once they're in.

---

## The judgement calls I made — these are the ones to argue with

1. **Emergency lighting and exit signage → Fire, not Electrical.** The council files them under "Building interior", but they're life-safety-on-fire. If you'd rather see them under Electrical, say so.
2. **Electrical flush-box intumescent pads → Fire, not Electrical.** The council calls this passive fire; I followed them.
3. **Fire dampers → Fire, not Mechanical.** Same logic.
4. **Riser hydrants → Fire, not Access & Barriers** (the word "riser" otherwise reads as a stair riser).
5. **Insulation and R-values → Interior / Linings.** There's no thermal/H1 category in the twelve. It could arguably be its own one.
6. **Safety glass and glazing manifestation → Interior / Linings**, not Access & Barriers. F2 hazardous building materials, not a fall hazard.
7. **Intertenancy walls → Acoustic** when the line mentions acoustic, otherwise Structural ("fire wall structural stability").
8. **"Engineer to confirm" → Structural.** It's nearly always a bracing or beam question in your reports.
9. **Seismic beats Structural and Mechanical** wherever the word appears, so seismic restraints don't get swallowed by the framing rules.
10. **Site / External and Architect score zero on council data** and will only populate from consultant reports. That's expected, not a bug.

---

## Two things the non-council reports will need from you later

Reading the other 8 discipline folders turned up two problems that don't affect the council pipeline:

- **Three Sysmic PDFs and the Isthmus facade report have no text layer at all** — they're photos with annotations. Soterra now refuses them with a clear message rather than filing an empty (and falsely clean) inspection. Making those work means OCR/vision, which isn't built.
- **Ten files are byte-identical duplicates** across the Electrical/Hydraulik/Mechanical folders — they're multi-discipline reports filed three times. Re-uploading the same document name replaces it rather than double-counting, but the same report under two different filenames would count twice. Worth a dedupe-by-content pass if it turns out to matter.
