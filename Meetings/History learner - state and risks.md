### 1. WHAT THE "HISTORY LEARNER" ACTUALLY IS

It is a five-part loop. Nothing about it is machine learning; it is "PDF → model extraction → two Postgres tables → three SQL aggregations → prompt text".

**The pieces**

| Part | File | What it does |
|---|---|---|
| Extractor | `C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web/lib/inspectionExtract.ts` | PDF text (or PDF pages) → *failed items only* |
| Categoriser | `C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web/lib/categories.ts` | one of 13 trades per item |
| Anonymiser | `C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web/lib/anonymise.ts` | scrubs before the prompt and before storage |
| Storage + queries | `C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web/lib/history.ts` | `saveInspection`, `categoryCounts`, `topItems`, `historyForCode`, `searchHistory`, `historySummary`, `listInspections`, `inspectionDetail` |
| Tables | `C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web/lib/schema.ts:266-316` | `inspections` (header) + `inspection_items` (one row per failed item) |
| Ingest (UI) | `C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web/app/api/inspections/route.ts` | POST blob pathname → extract → file |
| Ingest (CLI) | `C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web/dev/ingest-reports.mts` | a folder of PDFs → same pipeline |
| Insights page | `C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web/app/api/insights/route.ts` + `app/page.tsx:2500-2690` | the read-out |
| Assistant tool | `C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web/app/api/ask/route.ts:195` (schema), `:785-800` (execution), `:1102` (system prompt) | `search_history` |
| Checklist feed | `C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web/lib/checklist.ts:196-241` | history becomes the 4th source in the checklist prompt |

**Extraction is two passes, merged** (`inspectionExtract.ts:5-21` says so explicitly):

1. *Deterministic*, `parseCouncilFails` (`inspectionExtract.ts:89-100`), which scrapes the council's own numbered "Inspection Summary … 1. `<item>` ( Fail )" block.
2. *Model*, Opus (`const MODEL = "claude-opus-4-8"`, line 27), 32k max tokens, streamed, `output_config.format` = a JSON schema (`ITEM_SCHEMA`, lines 117-152) with a long SYSTEM prompt (lines 154-182).

Merge and per-report dedupe, `inspectionExtract.ts:344-365`:
```ts
const seen = new Set<string>();
const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
for (const d of deterministic) { ... const c = classify({ title, inspectionCode }); ... }
for (const r of rawItems)      { ... const c = classify({ title, detail, suggested: str(r.category), inspectionCode }); ... }
```

**Storage.** `saveInspection` (`history.ts:20-85`) upserts on `(projectId, doc)` and then *replaces* the item rows wholesale:
```ts
await db.delete(inspectionItems).where(and(eq(inspectionItems.inspectionId, row.id), eq(inspectionItems.companyId, scope.companyId)));
```
Every item row inherits the parent's `inspectionCode` and `inspectedOn` (denormalised, `history.ts:78-79`).

**Read-out.** The Insights page shows only three numbers plus two panels: `Items flagged` = `summary.failedItems`, `Reports read` = `summary.inspections`, `Worst trade` = `categories[0]`, then a per-trade bar chart and a "most repeated" list (`app/page.tsx:2544-2630`). `historySummary` also computes `graded`, `cleanPasses`, `returnVisits` (`history.ts:250-261`) — **the UI renders none of them**; the pass-rate headline was deliberately removed (see the comment at `history.ts:242-249`).

**The loop closes in two places.**
- `search_history` in chat (`ask/route.ts:785-800`) — a plain query over `inspection_items`, returned to the model with the note *"These are THIS company's own past failed inspection items, across all its sites."*
- `create_checklist` → `generateChecklistItems` (`checklist.ts:196-241`). Which history query runs depends on the request:
```ts
const historyQuery = !opts.inspectionCode
  ? searchHistory(scope, opts.title, { limit: 10 }).then((rows) => rows.map((r) => ({ title: r.title, category: r.category, count: 1, lastSeen: r.inspectedOn })))
  : type?.group === "consultant"
    ? topItems(scope, { category: type.category, limit: 10 })
    : historyForCode(scope, opts.inspectionCode, 10);
```
and it is rendered into the prompt as source #4 (`checklist.ts:238`):
```ts
`THIS COMPANY'S OWN HISTORY — already failed on these\n${history.map((h) => `- ${h.title} [${h.category}] — failed ${h.count} time${...}`)}`
```
with `GEN_SYSTEM` (`checklist.ts:98`) saying *"4. THIS COMPANY'S OWN HISTORY … These matter most"* and (line 111) *"Order by what fails an inspection: history items first"*.

Deliberately **not** wired: RFI drafting (`history.ts:178-181`, `ask/route.ts:1119`, `HANDOVER.md:60`). That call is sound.

---

### 2. HOW DATA GETS IN

**Formats: PDF only.** Both paths hard-filter. UI: `app/page.tsx:1495` `all.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name))`. CLI: `dev/ingest-reports.mts:43` `fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort()` — **not recursive**, so the 8 discipline sub-folders need 8 separate runs.

Text is pulled with `unpdf`, whitespace-collapsed, then a text-quality gate decides text-vs-vision (`inspectionExtract.ts:219-221`):
```ts
export function hasUsableText(text: string, pages: number): boolean {
  return text.length >= 400 && text.length / Math.max(pages, 1) >= 250;
}
```
Below the bar the raw PDF is sent as a `document` block and Claude reads the pages — that IS the OCR. Bounded at 30 pages / 24 MB (`app/api/inspections/route.ts:89-101`).

**What it extracts** — `ITEM_SCHEMA`: `is_inspection_report`, `source` (council|consultant), `inspection_code`, `inspection_type`, `inspector_org`, `outcome`, `inspected_on`, and `items[] = {title, detail, location, category}`. Header fields are overridden by printed truth where available (`inspectionExtract.ts:339`): filename regex `parseCouncilFilename` and header regex `parseCouncilHeader` beat the model.

**How it decides FAILED vs passed.** Two mechanisms, neither of which is a pass/fail column read:
- Deterministic: only rows the council itself reprinted in the summary as `( Fail )` or `( Partial )` — regex `inspectionExtract.ts:93` `/\d+\.\s*(.+?)\s*\(\s*(Fail|Partial)\s*\)/g`.
- Model: prose judgement, driven by the SYSTEM prompt list at lines 163-172 ("Fail, Open, non-compliant, defective, outstanding, incomplete, 'to be resolved', 'to complete', 'still to do', 'to come', 'query', 'customer to confirm'…") and an exclusion list (closed items, acceptances/concessions, photo captions, boilerplate, admin).

There is **no pass row stored at all** — only failures. So "27 inspections, 209 items" is a count of *flags*, not a denominator.

**Categorisation** — `classify()` (`categories.ts:211-223`), strictly ordered:
```ts
const byRule = categoryFromText(opts.title) ?? categoryFromText(opts.detail ?? "");
if (byRule) return { category: byRule, by: "rule" };
if (isCategory(opts.suggested) && opts.suggested !== "Other") return { category: opts.suggested, by: "model" };
const type = inspectionType(opts.inspectionCode);
if (type) return { category: type.category, by: "code" };
return { category: "Other", by: "fallback" };
```
`RULES` is 13 regex/category pairs, first-match-wins, with one veto mechanism used exactly once (Acoustic, `categories.ts:156-160`).

**Reliability of the categoriser — measured, not guessed.** I ran the shipped `categoryFromText` over 371 checklist-style lines pulled from all 96 real PDFs: **283 matched a rule, 88 fell through**. Coverage is high (matching `CATEGORY-MAP.md`'s claimed 98.5% on the cleaner 259-line set). But coverage is not correctness, and first-match-wins produces real mis-files:

| Real line | Lands in | Should be |
|---|---|---|
| `Commercial kitchen: extractor hood as per design (check sprinkler requirement)` | **Fire** | Mechanical — matched on the parenthetical "sprinkler" |
| `Continuous lining support behind stairs, up to roofing, past ceilings etc` | **Access & Barriers** | Interior / Linings — matched "stairs" |
| `HWC: Seismic restraints` | **Seismic** | Plumbing (the plumber fixes it) — the "subject outranks modifier" veto exists only for Acoustic |
| `Building interior: Light and ventilation as per design` | **Mechanical** | Interior |

And a hard regex bug: the Electrical rule is `earth(?:ing|ed|bond)` (`categories.ts:170`), which **does not match the two-word NZ term "earth bonding"**. That phrase occurs **35 times across 12 documents** in this corpus, including "Earth bonding to complete" as a live open item. It falls through the rules; on a deterministic item it then lands on the inspection code's default — `Interior / Linings` on an IPL. I verified: `/\bearth(?:ing|ed|bond)/i.test("Earth bonding to complete") === false`.

`dev/_cat-regress.mjs` is **not a regression test**. It has no ground truth; it re-declares an OLD and a NEW ruleset inline and prints which lines *changed* between them (`const run = (rules, t) => ...; if (a !== b) { diffs++; ... }`). It is also **stale** — its "NEW" acoustic rule is a strong/weak split that never shipped; `categories.ts` instead ships the old regex plus a veto, and its Electrical rule has `\bswitch(?:es)?\b|\bipx\d?\b` which the regress copy lacks. So the categoriser has no test that can fail.

---

### 3. WHAT IS ACTUALLY WEAK

**A. The single biggest problem: Auckland Council reports carry a ROLLING open-items register, and every report re-files the whole thing.**

`ITEMS TO BE RESOLVED` is not this inspection's findings — it is a carried-forward list. `BCO10341827-3_3703888867_IPL_Fail_20240408.pdf` literally prints `ITEMS TO BE RESOLVED – ONGOING HISTORY LIST.` and then repeats, verbatim, the Basement/Ground/Level 1 items from the 19 March report.

Measured across the 27 council PDFs:
- `"ITEMS TO BE RESOLVED"` appears in **25 of 27**
- the single item `"fire doors to install and seal"` appears in **23 of 27**, *including four reports whose outcome is PASS* (`IPL_Pass_20231220`, `IPP_Pass_20240119`, `IFG_Pass_20240209`, `IPP_Pass_20240223`) and the three `IME` site-meeting reports
- `"Fire wall before stairs"` in 6, `"terminal vents through the roof"` in 6

The SYSTEM prompt explicitly tells the model to take these ("outstanding", "to be resolved", "to complete"). The per-report `seen` set only dedupes *within* one document. So one unfixed fire door becomes ~23 rows in `inspection_items`, and the Insights list — whose footer literally reads *"the number is how many times it came up"* — will say it failed 23 times. That is the headline number of the whole feature and it is inflated by an order of magnitude on the founder's own data. It also drags Fire's category count up, which is what makes "Worst trade" read as Fire.

Second-order damage: every item row inherits the parent inspection's code (`history.ts:78`). So a *plumbing* IPP report contributes Fire items tagged `IPP`, and `historyForCode(scope, "IPP", 10)` — the exact query that feeds "what we personally keep failing" into a plumbing checklist — returns fire doors.

**B. The deterministic "floor" is absent on 63% of council reports.** I ran `parseCouncilFails` over all 27: it returns items on only **3** of them (ICA_Fail → 6, IPL_Fail_20240319 → 1, IPL_Fail_20240408 → 1, IF2_Fail → 5). Every Partial Pass returns 0, because the council prints literally `Inspection Summary Fail Comments Not applicable to this inspection.` The comment at `inspectionExtract.ts:18-19` is right, but the consequence is that the model is the *only* source on 17 of 27 council reports, and the route then refuses the report outright when the model call fails (`app/api/inspections/route.ts:121-126`, 503). No Anthropic credit → nothing files at all.

Separately, the summary regex (`inspectionExtract.ts:90`) is brittle to page breaks. `BCO10341827-3_3703781636` prints `Inspection Summary Page 4 of 6 Fail Comments`, which `Inspection Summary\s+(?:Pass|Fail|Partial Pass|Completed)?\s*Comments` cannot match. It happens to be a Partial Pass (nothing to lose), but the same shape on a Fail would silently drop the whole numbered list.

**C. The under-read guard almost never arms.** `expectedItemCount` (`inspectionExtract.ts:196-200`) counts `\bOpen\b` markers and `#\d+` numbers, and the retry only fires at `expected >= 8` (line 315). Measured over the corpus:
- all 27 council reports: expected = **0** (one is 1). Guard never arms.
- all 21 Fire (CANF/CMA) reports: expected = 0-14, and 17 of them are 0. Guard never arms.
- all 4 Architectural TGO/JP reports: 0.
- Only the 5 `18004.2` services reports (44/38/38/50/15) and 4 of the `5217-CA` reports (9/20/25/3/12) produce a usable number.

So on ~75% of this corpus a report can come back with 1 item from 7 pages of defects and nothing notices. `HANDOVER.md:50` already records this happening twice ("209 is understated by roughly 70").

**D. `topItems` / `historyForCode` grouping splits the same defect.** The key is (`history.ts:114`, identical at `:228`):
```sql
lower(array_to_string((string_to_array(regexp_replace(title, '[^a-zA-Z0-9 ]', ' ', 'g'), ' '))[1:6], ' '))
```
`regexp_replace` turns every punctuation char into **one** space and `string_to_array(..., ' ')` keeps the resulting **empty strings as array elements**, so punctuation consumes slots out of the 6-word window. I simulated the expression exactly:

| A | B | groups |
|---|---|---|
| `Head/ sill/ jamb flashings/ wanz support bars` | `Head/sill/jamb flashings/wanz support bars` | `"head  sill  jamb flashings"` vs `"head sill jamb flashings wanz support"` — **SPLIT** |
| `Cavity battens as per plan` | `Cavity battens as per plan and installed correctly` | `"cavity battens as per plan"` vs `"cavity battens as per plan and"` — **SPLIT** (the exact pair the doc-comment at `history.ts:102-103` claims it merges) |
| `Passive fire: all service penetrations fire stopped` | `Passive fire — all service penetrations fire stopped` | **SPLIT** |
| `Fire doors to install and seal` | `fire doors to install & seal` | **SPLIT** |

Because inspector wording drifts and the model paraphrases, the repeat count is simultaneously *inflated* by the rolling list and *fragmented* by the grouping key. On a genuinely different pair it also over-merges: `Unit 2/3, kitchen conduits passive fire…` and `Unit 2/5, kitchen conduit pipes…` differ only past the window.

Also: with no category filter, `topItems` selects `min(category)` over the group, so two different-trade items sharing a 6-word prefix merge under whichever category sorts first alphabetically.

**E. `searchHistory` is far weaker than the retrieval that was rebuilt and eval'd.** `lib/retrieve.ts` has BM25, stemming and brand aliases; `searchHistory` (`history.ts:183-221`) has none of it — raw substring ILIKE:
```ts
const terms = (q.toLowerCase().match(/[a-z0-9]{3,}/g) || []).slice(0, 8);
conds.push(sql`(${... `(title ILIKE %t% OR coalesce(detail,'') ILIKE %t%)` ... OR ...})`);
const rank = ... `case when title ILIKE %t% then 2 when detail ILIKE %t% then 1 else 0 end` ... ` + `;
```
Two demonstrated failures:
- **Stopwords are terms.** For `"what failed on the last cavity wrap?"` the terms include `the`, and `%the%` is a substring of **weather**, **the roof**, etc. Simulated: `Cavity battens as per plan and installed correctly` (score 2) *ties* with `Weathertightness: head flashing not taped` (score 2, matched only on "the" inside "Weathertightness") and `Terminal vents through the roof to finish` (score 2). The tie then falls to `desc(inspectedOn)`, i.e. pure recency — the relevant row can be pushed under noise.
- **No stemming.** `"cavity wrap flashings"` returns **1 of 6** rows: `flashings` is not a substring of `flashing`, so the head-flashing row is excluded by the WHERE clause entirely — not just ranked low, *absent*.
- `orderBy(desc(rank), desc(inspectionItems.inspectedOn))` with `inspected_on` a nullable text column: Postgres sorts NULLS FIRST on DESC, so undated items outrank dated ones at equal score.

**F. `count: 1` is hardcoded into the checklist prompt.** `checklist.ts:202` — on any free-text checklist (no inspection code, which the `create_checklist` tool description at `ask/route.ts:~205` actively encourages: *"when in doubt omit it"*), every history line rendered at line 238 reads **"failed 1 time"** regardless of the true repeat count. The prompt tells the model these "matter most" and to put them first, then feeds it a fabricated frequency.

**G. Deterministic items get no model category suggestion.** `inspectionExtract.ts:352` calls `classify({ title, inspectionCode })` with no `suggested`, so the chain is rules → *(skip)* → inspection code → Other. Any council fail whose wording misses all 13 regexes is filed under the inspection's default trade. `"Earth bonding to complete"` on an IPL → **Interior / Linings**. Same for `"Rails to complete"` (a cavity/weathertightness item) and `"Second layers to finish"`.

**H. No delete.** `app/api/inspections/route.ts` exports only `GET` and `POST`. A badly-read report cannot be removed from the UI. The only correction path is re-uploading a file with the identical name so the `(projectId, doc)` upsert replaces it. For a clean-account test that means a bad read is permanent unless you go to SQL.

**I. Small-sample maths shown as fact.** The page prints raw integers with no floor: one report gives "Worst trade: Fire, 6 items, most of any trade". `insights/route.ts:24` auto-selects `categories[0]` as the drill-down, so the largest number on the page is always presented as the answer even at n=1.

**J. Duplicate source files.** `All inspection reports/` holds **97 PDFs but only 79 unique filenames**. The `18004.2` services reports and the `5217-CA` observation reports each sit in Electrical *and* Hydraulik *and* Mechanical (3 copies), because one report covers all three disciplines. Ingesting the whole tree into one project is safe (same `doc` name → upsert replaces). Ingesting **folder-per-project would triple-count 19 files.**

**K. Privacy — the raw reports contain real personal data, and the scrubber has two holes.** Measured over the corpus: **453 email addresses and 92 phone numbers** in the raw text. `anonymiseText` removes 100% of the emails. It does **not** remove:
1. **NZ international-format mobiles.** `const PHONE = /(?:\+?64[ -]?)?(?:\(0\d\)|0\d)[ -]?\d{3}[ -]?\d{3,5}\b|.../g` (`anonymise.ts:20`) requires `0d` after `+64`, but the international form drops the leading zero (`+64 21 …`, `+64 9 …`). Result: **1 surviving mobile in every one of the 26 council reports** (the inspector's, printed on the outcome statement) and **51 / 40 / 38 / 35 / 32 survivors** in the five services reports. Same regex is used by `anonymiseField`, so such a number would also survive into storage if quoted into an item.
2. **`Inspector's name`.** The rule at `anonymise.ts:27` is `/(Inspector(?:'s)? name\s*[:\-]?\s*)([^\n]{0,60}?)(?=\s*(?:Date|Signature|Page \d|$))/gi`. In the real document the next token is `Inspector's email`, and the text has already been collapsed to one line so `$` never helps. I verified on the ICA report: after `anonymiseText` the output still reads `Inspector's name <real full name>` while the adjacent `Person on site (name)` correctly became `[PERSON]`.
3. The **site street address** is untouched by design (`Inspection Address : <street>, <suburb>, Auckland <postcode>` survives) and is also carried in the blob path and the `doc` name.

`anonymiseField`'s name guard is `if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(out.trim())) out = "[PERSON]"` (`anonymise.ts:56`) — it only fires when the whole field is exactly two capitalised words. A name inside a sentence survives.

One false-positive was also observed: in `3009 St2 CMA30 Palm_Grove…pdf` the PHONE regex matched a Fieldwire page-number run (`205 206 2072`), i.e. the regex will chew digit sequences that are not phone numbers.

---

### 4. WHAT DATA EXISTS

**`C:/Users/adam/Desktop/Soterra Github/Soterra/All inspection reports/`** — 97 PDFs, 79 unique names, 8 sub-folders (`Structure/` is **empty**), plus a non-report `Key words and steps.pdf` at the root.

| Folder | Files | Notes |
|---|---|---|
| Council | 27 | `BCO10341827-3_<id>_<CODE>_<Outcome>_<YYYYMMDD>.pdf`. All parse cleanly: 27/27 filename code + header code + date + outcome. Codes present: IPL(10), IPB(3), IPP(4), IME(3), IFG(2), ICA(3), IF2(1), IDT(1). Outcomes: 17 Partial Pass, 5 Pass, 4 Fail, 3 Completed. 3-23 pages, 3.9k-14.6k chars |
| Fire | 25 | 3 consultancy templates (`18011CM/18013CM CANF*`, `3009 … CMA*` Fieldwire exports). No codes, no pass/fail |
| Electrical | 12 | 5 are the shared `18004.2 Building Services` reports (32-51 pages, the biggest in the set) |
| Hydraulik | 10, Mechanical 12, Architectual 6, Accoustic 1 | heavy overlap with Electrical |
| Sysmic | 3 | **all three have zero text** (1-2 pages) — pure scans |

Text-quality gate results across the whole tree: **91 text, 5 scan** (`Isthmus site observation 00 - facade items.pdf`, all 3 Sysmic reports, `50956-Jimmys Point-Site Visit Report.pdf`). All 5 are under the 30pp/24MB caps, so they take the vision path.

**`C:/Users/adam/Desktop/Soterra Github/Soterra/Inspections/`** — 10 PDFs + `anonymize.py` + `anonymizer.html` + `mapping.json`. This is the anonymisation workbench, not extra data: the reports here are duplicates of ones in `All inspection reports/`.

**Is the raw data personal? Yes, unambiguously.**
- `mapping.json` has 39 hand-written rules covering 3 project names, 3 consultancies, 1 builder, 4 named inspectors, 4 named managers, 1 site contact, 6 real email addresses, 4 street addresses, 4 phone numbers and the consent number.
- I confirmed against the PDFs: the `*original.pdf` files contain live addresses at `kalmar.co.nz`, `winton.nz`, `ryanfire.co.nz` and `aucklandcouncil.govt.nz`; the council reports print the site contact's full name **and mobile**, three recipient emails, the inspector's full name, email and mobile, and the residential street address.
- Across the 96-file corpus: **453 emails, 92 phones**.

**The anonymised copies are damaged.** `anonymize.py` does a byte-level `raw.replace(old_b, new_b)` on decompressed content streams and re-writes them (`anonymize.py:43-57`). Result:
- `CA-39-G Site Observation Report ANON.pdf` (32pp), `Council Inspection - Kauri Apartments 09-04-24.pdf` (9pp), `Fire Inspection - 07 Kauri Apartments.pdf` (10pp), `Services Inspection – Kauri Apartments – 09 April 2024.pdf` (22pp) all now extract **0 characters** — the text layer is destroyed (pypdf throws `Error -3 while decompressing data` on them). These would be classified `scanned` and read as images.
- `CA-39-G Site Observation Report ANON2.pdf` has a **corrupted replacement**: an address reads `…@consultant1rees.co.nz` (the "22degrees" substitution truncated mid-token).
- The script's own verifier only checks terms it already knows about (`verify_pdf`, lines 63-88, skipping any term under 4 chars) — it cannot detect a name that was never in `mapping.json`.

**Practical conclusion:** the raw folders must be treated as containing real PII. The runtime `anonymise.ts` catches emails and most phones but demonstrably leaks the inspector's name and every `+64 21 …` mobile into the prompt, and the vision path bypasses text scrubbing entirely (the code says so at `app/api/inspections/route.ts:104-107`).

---

### 5. HOW TO TEST IT ON A CLEAN ACCOUNT

**Prep (do first)**
1. Patch the two PII holes before anything is uploaded — `anonymise.ts:20` PHONE (add the `\+?64[ -]?(?:\(0\)|0)?\d{1,2}` international form) and `anonymise.ts:27` `Inspector's name` (the lookahead must include `Inspector|Outcome|Next|Signature`). One-line each; verifiable with the probe below.
2. Decide the corpus. Recommended: **one site, one company, the whole tree**, because ingesting per-folder into separate projects triple-counts the 19 duplicated services/observation files.

**Route A — CLI, which is what I'd use for a controlled test**

```bash
cd "C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web"
# 1. list projects and grab the clean site's id
node dev/db-status.mjs

# 2. DRY RUN first — writes nothing, prints every item and its category
npx tsx dev/ingest-reports.mts "../All inspection reports/Council" <projectId> --dry
```
`--dry` prints, per report (`ingest-reports.mts:78-79`):
`ok    ICA  fail    6 item(s)  2024-02-21  Weathertightness / Cladding, Fire`
followed by `· [Category] Title` for every item. **Read this output before writing anything** — it is the only place the category assignment is visible per item.

Then, folder by folder (the script is not recursive):
```bash
for d in Council Fire Electrical Hydraulik Mechanical Architectual Accoustic Sysmic; do
  npx tsx dev/ingest-reports.mts "../All inspection reports/$d" <projectId>
done
```
It finishes with `company totals now: {...}` and a per-category count table.

**Route B — the product path (this is what the founder should exercise)**
Sign in on a clean account → create a site → **Insights** tab → the empty-state drop zone (`app/page.tsx:2517-2536`) → drag the PDFs in. It runs 4 concurrently (`LANES = 4`, `app/page.tsx:1507`), 20-60s each, and reports per file: `N items · Cat1, Cat2`, or `only read N of about M — check this one`, or an error.
⚠️ **Trap:** the report drop zone exists *only* on Insights. The **Upload** tab is plans-only (`app/page.tsx:2412-2418`) and will silently index an inspection report as plan pages.

**Then verify the learner, in this order**

1. **Insights page.** Expect `Reports read` ≈ number filed, `Items flagged`, `Worst trade`. Click each trade bar; the right panel is `topItems` for that trade.
2. **Recount by hand on one report.** Open `BCO10341827-3_3703830455_ICA_Fail_20240221.pdf` — the council prints exactly 6 numbered fails plus a long `ITEMS TO BE RESOLVED` prose block. Compare the filed item count and check *how many of the filed items are the rolling list rather than this inspection's findings*. This single report is the fastest way to see problem A.
3. **Chat.** Ask, on the clean site: `"what have we been pulled up on before at cavity wrap?"` and `"do we keep failing passive fire?"` — forces `search_history`. Then ask the plural/singular pair `"cavity wrap flashings"` vs `"cavity wrap flashing"` and watch the result sets differ (problem E).
4. **Checklist.** Ask `"build me a pre-line checklist"` (code path, `historyForCode("IPB")`) and separately `"QA check for the GIB fire-rated corridor wall"` (free-text path, `searchHistory` + hardcoded `count: 1`). Check whether the items sourced `history` are (a) genuinely this crew's repeats and (b) on-subject.
5. **Isolation** (unchanged by this work but cheap): `npx tsx dev/verify-company-isolation.mts` — 25 assertions, seeds two companies into the real DB.
6. **PII probe.** Re-run the scrubber over the corpus and assert zero survivors. My probe is at `C:/Users/adam/AppData/Local/Temp/claude/C--Users-adam-Desktop-Soterra-Github-Soterra/18b13807-78f0-4465-9677-d429d5ea0be3/scratchpad/pii.mts` (with patched local copies of the lib in `.../scratchpad/lib/`); it currently prints `RAW corpus: 453 email(s), 92 phone(s)` → `AFTER anonymiseText: 0 email(s), 1 phone(s)` plus the `+64` misses per file.

**What a GOOD result looks like**
- Every council report files with the correct code, date and outcome (it already does — 27/27).
- Item counts track the report: the ICA Fail files **6-10** items (its own fails plus genuinely-new prose items), *not* 30 including the whole carried register.
- A PASS report files **0-2** items, not 8. Today `IPL_Pass_20231220` and `IPP_Pass_20240119` both carry the rolling list and will file fire-door items.
- "Most repeated" shows things the crew *actually* repeats across *different* jobs — the same defect recurring on distinct inspections — with a count you can defend to a customer.
- `search_history` on "cavity wrap flashings" returns the flashing rows; a stopword-heavy question does not tie unrelated rows to the top.
- The history block in a checklist prompt carries the true repeat count.

**What actually happens today** (predicted from the code and the corpus, worth confirming on the run)
- Fire dominates by a wide margin, largely because one unfixed fire door is re-filed off 23 reports.
- The "N ×" repeat counts are simultaneously inflated (rolling list) and fragmented (6-word grouping key), so two rows describing the same defect sit in the list with counts of 9 and 4.
- Several trades are cross-contaminated: fire items tagged `IPP`/`IDT`, an extract-hood item under Fire, "Earth bonding" under Interior / Linings.
- Two of the 12 consultant reports are known to be under-read by ~70 items (`HANDOVER.md:50`), and the guard that would now catch them does not arm on ~75% of the corpus.
- On a fresh account with 3-5 reports, the page will confidently name a "worst trade" off single-digit counts.


## Problems
- ROLLING REGISTER DOUBLE-COUNTING (the core defect). Auckland Council reports carry a carried-forward 'ITEMS TO BE RESOLVED' list. Measured: it appears in 25 of 27 council PDFs, and the single item 'fire doors to install and seal' appears in 23 of 27 — including four reports whose outcome is PASS and all three IME site-meeting reports. The SYSTEM prompt (inspectionExtract.ts:163) explicitly tells the model to extract anything 'outstanding / to be resolved / to complete', and the dedupe `seen` set (inspectionExtract.ts:345-346) only works WITHIN one document. One unfixed fire door therefore becomes ~23 rows in inspection_items, and the Insights list — whose footer reads 'the number is how many times it came up' — reports it as 23 failures. This inflates the product's headline number by an order of magnitude on the founder's own data.
- CROSS-TRADE CONTAMINATION FROM THE SAME CAUSE. Every item row inherits the parent inspection's code (history.ts:78 `inspectionCode: extracted.inspectionCode`). Because the rolling list lands on whatever report is being read, a plumbing IPP report contributes Fire items tagged IPP. `historyForCode(scope, 'IPP', 10)` — the exact query that feeds 'what we personally keep failing' into a plumbing checklist (checklist.ts:205) — will return fire doors.
- TOPITEMS GROUPING KEY SPLITS THE SAME DEFECT. `lower(array_to_string((string_to_array(regexp_replace(title,'[^a-zA-Z0-9 ]',' ','g'),' '))[1:6],' '))` (history.ts:114, duplicated at :228). regexp_replace turns each punctuation char into ONE space and string_to_array keeps the resulting empty strings as array elements, so punctuation eats slots out of the 6-word window. Simulated exactly: 'Cavity battens as per plan' vs 'Cavity battens as per plan and installed correctly' SPLIT into two groups — the very pair the doc-comment at history.ts:102-103 claims it merges. Also 'Head/ sill/ jamb flashings/...' vs 'Head/sill/jamb flashings/...' SPLIT, and 'Passive fire: all service penetrations' vs 'Passive fire — all service penetrations' SPLIT.
- SEARCHHISTORY HAS NO STEMMING AND NO STOPWORD REMOVAL, unlike lib/retrieve.ts which has BM25 + stemming + brand aliases. Terms are `/[a-z0-9]{3,}/g` (history.ts:190) so 'the' is a search term, and '%the%' is a substring of 'weather'. Simulated: 'what failed on the last cavity wrap?' scores the real cavity row (2) EQUAL to 'Weathertightness: head flashing not taped' (2, matched only on 'the' inside 'Weathertightness'); the tie then falls to `desc(inspectedOn)`, i.e. pure recency. Worse, 'cavity wrap flashings' returns 1 of 6 test rows — 'flashings' is not a substring of 'flashing', so the relevant row is excluded by the WHERE clause entirely, not merely ranked low.
- HARDCODED `count: 1` IN THE CHECKLIST PROMPT. checklist.ts:202 — on any free-text checklist (no inspection code, which the create_checklist tool description actively encourages: 'when in doubt omit it'), searchHistory rows are mapped with `count: 1`, and checklist.ts:238 renders 'failed 1 time' regardless of the true repeat count. GEN_SYSTEM tells the model these history items 'matter most' and to list them first, then hands it a fabricated frequency.
- THE UNDER-READ GUARD ALMOST NEVER ARMS. `expectedItemCount` (inspectionExtract.ts:196-200) counts `\bOpen\b` and `#\d+`; the retry fires only at `expected >= 8` (line 315). Measured over all 96 PDFs: all 27 council reports return 0 (one returns 1); 17 of 21 fire reports return 0; all architectural reports return 0. Only the 5 `18004.2` services reports and 4 `5217-CA` reports produce a usable number. So on roughly 75% of this corpus a report can come back with 1 item from 7 pages of defects and nothing notices — the exact failure HANDOVER.md:50 records happening twice.
- THE DETERMINISTIC 'FLOOR' IS ABSENT ON 63% OF COUNCIL REPORTS. I ran `parseCouncilFails` over all 27: it returns items on only 4 of them (ICA_Fail 6, IPL_Fail_20240319 1, IPL_Fail_20240408 1, IF2_Fail 5). Every Partial Pass returns 0 because the council prints 'Inspection Summary Fail Comments Not applicable to this inspection.' Combined with app/api/inspections/route.ts:121-126 refusing degraded reads with a 503, an Anthropic outage or empty credit means NOTHING files at all.
- PARSECOUNCILFAILS IS BRITTLE TO PAGE BREAKS. The regex `Inspection Summary\s+(?:Pass|Fail|Partial Pass|Completed)?\s*Comments` (inspectionExtract.ts:90) cannot match `Inspection Summary Page 4 of 6 Fail Comments`, which is what BCO10341827-3_3703781636 actually prints. It is a Partial Pass so nothing is lost today, but the same shape on a Fail would silently drop the entire numbered fail list.
- CATEGORISER REGEX BUG: 'earth bonding' does not match. categories.ts:170 has `earth(?:ing|ed|bond)` which requires no space, so the standard two-word NZ term fails. Verified: /\bearth(?:ing|ed|bond)/i.test('Earth bonding to complete') === false. The phrase occurs 35 times across 12 documents in this corpus as a live open item. It falls through all 13 rules and, on a deterministic item, lands on the inspection code's default — Interior / Linings on an IPL.
- FIRST-MATCH-WINS MIS-FILES, with the 'subject outranks modifier' veto implemented for Acoustic only (categories.ts:156-160). Verified on real corpus lines: 'Commercial kitchen: extractor hood as per design (check sprinkler requirement)' -> Fire (should be Mechanical); 'Continuous lining support behind stairs, up to roofing, past ceilings etc' -> Access & Barriers (should be Interior / Linings); 'HWC: Seismic restraints' -> Seismic (it is the plumber's item); 'Building interior: Light and ventilation as per design' -> Mechanical.
- DETERMINISTIC ITEMS GET NO MODEL CATEGORY SUGGESTION. inspectionExtract.ts:352 calls `classify({ title, inspectionCode })` with no `suggested`, so an unmatched council fail skips straight to the inspection code's default trade. 'Rails to complete' (a cavity/weathertightness item on an ICA-adjacent list) and 'Second layers to finish' both land as Interior / Linings.
- THE CATEGORISER HAS NO TEST THAT CAN FAIL. dev/_cat-regress.mjs has no ground truth — it re-declares an OLD and a NEW ruleset inline and prints only which lines CHANGED between them. It is also stale relative to shipped code: its 'NEW' acoustic strong/weak split never shipped (categories.ts ships the old regex plus a veto) and its Electrical rule is missing `\bswitch(?:es)?\b|\bipx\d?\b`. dev/eval-retrieval.mts covers the document corpus only — zero mentions of history or inspections.
- PII HOLE 1 — NZ INTERNATIONAL MOBILES SURVIVE. `const PHONE` (anonymise.ts:20) requires `0d` after `+64`, but the international form drops the leading zero. Measured: the raw corpus holds 453 emails and 92 phones; anonymiseText removes 100% of the emails but leaves ONE mobile in every one of the 26 council reports (the inspector's, printed on the outcome statement) and 51/40/38/35/32 survivors in the five services reports. The same regex backs anonymiseField, so such a number would also survive into storage if quoted into an item detail.
- PII HOLE 2 — THE COUNCIL INSPECTOR'S NAME IS NOT SCRUBBED. The rule at anonymise.ts:27 requires a lookahead of `Date|Signature|Page \d|$`, but the real document's next token is `Inspector's email`, and the text has been collapsed to a single line so `$` never applies. Verified on the ICA report: after anonymiseText the output still reads `Inspector's name <real full name>` while the adjacent `Person on site (name)` correctly became `[PERSON]`. The site street address is untouched by design and is also carried in the blob path and the `doc` name.
- ANONYMISED DEMO COPIES ARE DAMAGED. anonymize.py does a byte-level replace on decompressed content streams and re-writes them (lines 43-57). Result: `CA-39-G Site Observation Report ANON.pdf` (32pp), `Council Inspection - Kauri Apartments 09-04-24.pdf` (9pp), `Fire Inspection - 07 Kauri Apartments.pdf` (10pp) and `Services Inspection – Kauri Apartments – 09 April 2024.pdf` (22pp) now extract ZERO characters — the text layer is destroyed (pypdf: 'Error -3 while decompressing data'). `CA-39-G ... ANON2.pdf` has a corrupted substitution leaving '@consultant1rees.co.nz'. These are the anonymised copies intended for demos.
- NO WAY TO DELETE A FILED INSPECTION. app/api/inspections/route.ts exports only GET and POST. A badly-read report cannot be removed from the UI; the only correction is re-uploading a file with the identical name so the (projectId, doc) upsert replaces it. On a clean-account test a bad read is permanent short of raw SQL.
- SMALL-SAMPLE NUMBERS PRESENTED AS FACT. insights/route.ts:24 auto-selects `categories[0]` as the drill-down, so the biggest number is always shown as the answer even at n=1. 'Worst trade: Fire, 6 items, most of any trade' is rendered identically off one report or off fifty. There is no minimum-sample floor and no confidence framing anywhere on the page.
- DUPLICATE SOURCE FILES. `All inspection reports/` holds 97 PDFs but only 79 unique filenames — the `18004.2` services reports and `5217-CA` observation reports each sit in Electrical AND Hydraulik AND Mechanical because one report covers three disciplines. Ingesting the tree into one project is safe (upsert on doc name), but folder-per-project would triple-count 19 files. `Structure/` is empty; all 3 `Sysmic/` reports have zero extractable text.
- UPLOAD-TAB TRAP. The inspection-report drop zone exists only on the Insights tab. The Upload tab is plans-only (app/page.tsx:2412-2418) and will silently index an inspection report as plan pages — a very likely first mistake on a clean account.
- DEAD SUMMARY FIELDS. historySummary computes `graded`, `cleanPasses` and `returnVisits` (history.ts:250-261) and app/page.tsx:70 types them, but the UI renders none of them. The pass-rate headline was removed for good reason (history.ts:242-249), but the computation was left behind, so the page has no outcome-quality signal at all — only raw flag counts.

## Unknowns
- I did not connect to the database. Every number I give about the CORPUS is measured from the PDFs on disk with the shipped parsers; I have NOT measured what is currently sitting in `inspections` / `inspection_items` for any existing company. `node dev/db-status.mjs` (extended with those two tables) would settle it in seconds.
- I did not run the model pass — no ANTHROPIC_API_KEY spend, and the memory note says the Soterra Anthropic org was out of credit. So the rolling-register double-counting is derived from (a) the SYSTEM prompt's explicit instruction to extract 'to be resolved / to complete' items and (b) the measured fact that the same item text appears in 23 of 27 reports. It is a very strong inference, not an observed extraction. The dry run in step 5 confirms or refutes it in one command.
- Whether the founder's existing production history already contains the inflated counts, or whether he has only ever loaded the Council folder. HANDOVER.md:50 says 12 consultant reports / 209 items were filed on 'Kauri Tower', which suggests real data exists and would need clearing before a clean test.
- Exactly how the model handles the INSPECTION HISTORY block, where the council writes resolved items in caps ('RESOLVED', 'SIGHTED PHOTO EVIDENCE OF THIS COMPLETED', 'CHECKED TODAY'). The prompt does tell it to skip closed items; whether it reliably does so on this template is unmeasured and directly affects how bad the double-count is.
- Whether the four zero-text 'Kauri Apartments' anonymised PDFs were intentionally flattened to images or accidentally corrupted by anonymize.py. The `Error -3 while decompressing data` from pypdf points at corruption, but only Adam knows the intent.
- Whether the raw reports may legally be uploaded at all. They name a real builder, a real consent number, real consultancies and real council staff, on real Auckland addresses. Whether Adam has permission from the head contractor to load them into a hosted product is a business question I cannot answer from the repo.
- Whether the `underRead` retry has ever actually recovered items in production. The comment cites a measured case, but HANDOVER.md item 2 says the two known bad reports still have not been re-uploaded, so the retry path may never have run end to end.
- Vercel function limits on a bulk load. maxDuration is 300s per report and the UI runs 4 lanes; a 97-file drag-and-drop is ~25 minutes of sustained serverless + Opus usage and may hit Anthropic rate limits or Vercel usage overages. Unmeasured.