# Soterra — where it got to, 2026-07-22

_Written at the end of the day's session, for whoever picks this up next. Read this, then `BUILD-PLAN.md` for the spec and `CATEGORY-MAP.md` for the category decisions._

---

## ▶️ START HERE

Everything below is **live on soterra.co.nz**. Deploy with `cd soterra-web && npx vercel deploy --prod --yes`.

**Three things are blocked and none of them are code:**

| # | Blocker | What to do |
|---|---|---|
| 1 | `soterra-web/.env.local` still holds the **old, empty** Anthropic key. Vercel production has a new one; local dev scripts don't. | Adam pastes the new key into that file. **Never do this for him — no API keys, ever.** Then `npx tsx dev/reprocess-blobs.mts 7b66634b-30ac-4722-9fbe-e375f273ecb2 --since=48h` picks up anything stuck. |
| 2 | `git push` 403s. Saved credential is the **montazsapp** GitHub account; the repo is **AdamSoterra/Soterra**. ~65 commits behind. | Adam clears the github.com entry in Windows Credential Manager and signs in as himself. Deploys go via Vercel CLI, so nothing is broken meanwhile. |
| 3 | Auckland Council's **Appendix 2** ("building consent conditions, advice notes and notifiable inspections") is referenced on p3 of AC1229 but isn't in the published PDF. | Ask the council for it. It's the last document that would let us verify the booking codes from source rather than from their web page. |

---

## What exists

### The company boundary — read this before touching any query
`lib/company.ts`. `companyId` is derived from the caller's **verified project row**, never a header or body. `CompanyId` is a branded type only `resolveScope()` can mint, so a history or checklist query that skipped the check **does not compile**.

**Run `npx tsx dev/verify-company-isolation.mts` after touching `lib/company.ts`, `lib/history.ts` or `lib/checklist.ts`.** It seeds two real companies into the real database, calls the real query layer the way the routes do, and asserts 25 things. If one builder ever sees another's failure data that isn't a bug to patch, it ends the business.

### The pieces
| Piece | Where | Note |
|---|---|---|
| Company layer | `lib/company.ts`, `companies` table, `projects.companyId` | Company is created with a person's FIRST site; later sites join it |
| History learner | `lib/inspectionExtract.ts` | Two passes: exact parse of the council's numbered fail list, then a model pass for prose. Refuses a half-read report rather than filing a flattering one |
| Categories | `lib/categories.ts` | 12 categories, 17 council codes (verified against the council's page), 9 consultant disciplines |
| Inspection order | `lib/inspectionOrder.ts` | Encoded from AC1229's flowcharts. Three hard dependencies. Verified box-by-box |
| History queries | `lib/history.ts` | Every read takes a `Scope` |
| Checklist engine | `lib/checklist.ts` | Items cited to plans / Code / own history + a fixed CCC evidence pack |
| Insights page | `app/page.tsx`, `app/api/insights` | The only new page |
| Shared Code corpus | `lib/codeIndex.ts`, `dev/ingest-code.mts` | 3,289 pages. **Universal knowledge only — it's visible to every company** |

### Dev scripts (all `npx tsx dev/<x>.mts`, cwd = `soterra-web`)
- `verify-company-isolation.mts` — the isolation test
- `ingest-reports.mts "<folder>" <projectId> [--dry]` — bulk-file a folder of reports
- `reprocess-blobs.mts <projectId> [--dry] [--since=6h]` — re-read reports already in Blob
- `ingest-code.mts "<folder|file>" [--title=…] [--dry]` — load the shared corpus
- `db-status.mjs`, `migrate-company-layer.mjs` (idempotent)

---

## Real data in there now

12 consultant reports on **Kauri Tower**, 209 items. **The 209 is understated by roughly 70** — two reports (`18004.2.221010` #009 and `5217-CA-39-G`) came back with 1 and 2 items against registers of 50 and 25. The retry + under-read flag that catches this shipped *after* they were filed, so **re-uploading those two should pick the rest up**.

Ten of the twelve tracked their register almost exactly, which is the reason to trust the other ten.

---

## Judgement calls worth not re-litigating

- **A degraded read is refused, never filed.** If the model pass fails, the deterministic parse alone makes a Partial Pass look clean when the job wasn't. A history that flatters you is worse than none.
- **`search_history` is deliberately NOT wired into RFI drafting.** An RFI goes to the consultant, and a previous answer may sit under a different plan revision or engineer's requirement. Adam's call, and he's right.
- **No pass rate over ungraded inspections.** Consultant site visits carry no verdict; counting them produced a "0% passed first time" headline off twelve reports that were never graded.
- **Commercial-only rules are labelled, not asserted.** Same booking code covers both charts; membranes-before-cladding is commercial only.
- **Extraction is Opus, chat is Sonnet.** Extraction runs once per report, is accuracy-critical, and a miss is invisible.

---

## Open, in rough priority order

1. **Insights display.** Adam: *"we will need to work on the display and what to show what not."* Discuss before building — he wants to be shown options. My read: category bars answer "which trade" when the useful question is "what do I do about it". Candidates: repeat offenders (failed 3+ times), open vs closed, by site, trend over time. My pick is repeat offenders.
2. **Re-upload 009 and CA-39** to recover ~70 items.
3. **CATEGORY-MAP.md Q2** — is the top electrical item seismic clearances? Needs the Electrical folder loaded; council data can't answer it.
4. **Photos and consent** (BUILD-PLAN open item 4). Site photos contain people; no retention or consent decision yet. Decide before a customer uses it.
5. **MBIE determinations** — Adam is downloading. Drop them in a folder and `ingest-code.mts` handles them. Last 2–3 years is plenty. Always show the year in the citation; cite as guidance, never as the rule.
6. **OCR ceiling.** Scans go to the model as pages, bounded at 30pp / 24MB. Bigger scans are refused.
7. **Erosion / sediment control** is a real failed-inspection cause we score zero on, because council checklists barely cover it.

---

## Working style that fits him

- He's a PM and founder, not a coder. Don't hand him terminal commands unless there's no alternative — do it, verify it, tell him what happened.
- Propose wording and visual changes before building them.
- Commit and deploy as you go; don't ask.
- When something's wrong, say so plainly and lead with it. He spotted "209 seems high" and was right that something was off — just in the opposite direction.
