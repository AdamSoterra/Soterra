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

| Code | Name | Fallback category |
|---|---|---|
| IFO | Foundation | Structural |
| ISF | Slab / floor | Structural |
| IPF | Pre-pour / reinforcing | Structural |
| IBF | Block fill | Structural |
| IFG | Framing | Structural |
| ICA | Cavity wrap | Weathertightness / Cladding |
| ICL | Cladding | Weathertightness / Cladding |
| ITK | Waterproofing / tanking | Weathertightness / Cladding |
| IRF | Roofing | Weathertightness / Cladding |
| IDT | Drainage | Plumbing & Drainage |
| IDP | Drainage pre-cover | Plumbing & Drainage |
| IPP | Plumbing | Plumbing & Drainage |
| IPB | Pre-line building | Interior / Linings |
| IPL | Post-line | Interior / Linings |
| IF1 | Final (residential) | Interior / Linings |
| IF2 | Final (commercial) | Interior / Linings |
| IME | Site meeting | Other |
| IMV | Minor variation | Other |

**❓ Q1 — are IFO/ISF/IPF/IBF/IRF/IDP/ICL/ITK the right letters?** I only had IPL, IPP, IME, IPB, IFG, ICA, IF2 and IDT in your 27 reports; the rest came from the build plan or from guessing the pattern. A wrong letter means that inspection type just never matches.

The fallback only fires when nothing in the item's wording matched, which is 1.5% of the time — so a wrong fallback on IPB/IPL/IF1/IF2 barely matters. Those four legitimately produce fails across half the categories anyway, which is exactly why the wording wins.

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

**❓ Q2 — your prediction was that the top electrical item would be seismic clearances. The council data can't confirm or deny it: there is essentially no electrical content in a council checklist (1 line), and only one seismic line ("HWC: Seismic restraints").** Electrical goes to the electrician's certificate, not the BCA. I'd expect your prediction to show up once the *consultant* reports go in — the Electrical folder has 12 files and cable-tray seismic restraint is a classic. Worth re-checking after those are loaded.

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
