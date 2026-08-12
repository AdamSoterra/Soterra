# SOTERRA — BUILD HANDOVER (2026-08-12)

You are picking up Soterra mid-build. Read this whole document first. The project's
auto-memory (`MEMORY.md` + `project_soterra_aspec_roadmap.md` and its links) holds the
running history and every decision; **this file is the consolidated build brief.** Where
this file and memory agree, trust them; the code is the final authority on what exists.

**Golden rule: build the shared FOUNDATIONS first, then the features. Do NOT try to build
everything at once — these features interlock, and foundations-first is what keeps the
build clean.** Adam is a PM/founder, not a coder: explain plainly, lead on product, and
follow his working style (§7).

---

## 1. WHAT SOTERRA IS

An AI project assistant for construction. **Live at soterra.co.nz** (B2B, login-only via
Clerk). A company uploads its plans, specs, and inspection reports; Soterra then:
- **Answers questions cited to the source sheet** — reads the project's own drawings +
  the NZ Building Code + NZ Standards + manufacturer literature (GIB, BOSS Fire, Ryanfire,
  etc.) + the company's own inspection history. Every answer names where it came from.
- **Generates pre-inspection QA checklists** (interactive: Good / Needs fixing / N-A, with
  photo + note) from the plans + Code + manufacturer manuals + the company's failure history.
- **Learns from filed inspection reports** ("what do we keep getting failed on?").

**The WHY (from the 11 Aug ASPEC meeting — the anchor for everything we're building):**
one Auckland consent had 27 inspections, 22% clean-pass, 67% needed a return visit; every
failed item was a plan lookup or a code figure. The industry treats rework, RFIs, and
delays as normal. Soterra turns a company's own construction data into company intelligence.
Data security is the #1 sales objection ("the director asks it first") — it is answered by
**hard per-company + per-project data isolation** (see §6).

---

## 2. STACK & CODEBASE MAP

Everything lives in **`soterra-web/`** (a Next.js app-router app), deployed on Vercel.

- **Auth:** Clerk (users + orgs). `projectMembers.userId` is the Clerk user id.
- **DB:** Neon Postgres via **Drizzle ORM** — `lib/db.ts`, all tables in **`lib/schema.ts`**.
- **Storage:** Vercel Blob (pre-rendered page PNGs).
- **LLM:** `@anthropic-ai/sdk`, model **`claude-opus-4-8`**, structured JSON output (see §6 gotchas).
- **Retrieval:** **BM25 / TF-IDF, NO embeddings/vectors** — `lib/retrieve.ts`.

**Key files:**
| File | What it is |
|---|---|
| `app/page.tsx` | The entire SPA UI (~4,000 lines): tabs (Assistant · Inspections · Plans · Upload · Insights), the chat, the plan/sheet viewer, checklists, modals. |
| `app/api/ask/route.ts` | The assistant: an agent loop (`MAX_ROUNDS=10`), the tools, and the big `STATIC_PROMPT` (all source-authority rules incl. REVISIONS + the AMENDMENTS rule we added). Tools: `search_plans`, `review_plans` (reads every page), `search_code`, `search_determinations`, `search_manufacturer`, `search_history`, `create_checklist`, `create_safety_plan`. |
| `lib/checklist.ts` | `generateChecklistItems()` + `createChecklist()` — how QA checks are built. **The pattern to copy for any new LLM call** (structured output, `thinking:{type:"adaptive"}`, `output_config` json_schema, `max_tokens:8000`). |
| `lib/history.ts` | Inspection history: `saveInspection`, `listInspections`, `deleteInspection`, `inspectionDetail`. Company-scoped. |
| `lib/locations.ts` | **NEW (committed f8beeac)** — `deriveLocations()` / `getProjectLocations()` — extracts QA-scope locations from a project's drawing titles. See §3-C. |
| `lib/retrieve.ts` | BM25 scorer + brand/code scoping + synonym expansion. |
| `lib/schema.ts` | All tables. |
| `lib/project.ts` | `resolveProjectId(req,userId)` (reads `x-soterra-project` header, checks membership → 403 "No site selected" if not a member), `listUserProjects`. |
| `lib/manufacturerIndex.ts` | Manufacturer corpus + the `licence` gating (`granted|pending|demo|withdrawn`, `DEMO_CORPUS_USERS`). |
| `app/api/doc-page/route.ts` | Renders one manufacturer/plan page to a PNG (stored Blob image, or live render from source). The pattern the plan-pin overlay sits on. |
| `app/globals.css` | Every style. Brand: `--brand:#0E8FE6`, `--navy:#0C2A47`, DM Sans. |

**Data model highlights (`lib/schema.ts`):**
- `plan_pages` — one row per PDF page: `projectId, doc (title), file (blob), page, npages, text`. **No doc-type tag** (a fire report uploaded via /upload is an undifferentiated plan page). Same-sheet revisions handled by `lib/sheetRev.ts` (filename `Rev.N`).
- `inspections` — `companyId, projectId, doc, source(council|consultant), inspectionCode, outcome, inspectedOn, itemCount`. `inspection_items` — the extracted failed items (`companyId, inspectionId, category, ...`). **Company-scoped.**
- `manufacturer_pages` — `manufacturer, doc, page, text, sourceUrl, imageUrl(blob), licence`.
- `projects` — `id, name, code, companyId, creatorId, timezone`. `projectMembers` — `projectId, userId(clerk), name, role`.

---

## 3. THE BUILD — FOUNDATIONS FIRST, THEN FEATURES

### 3-A. FOUNDATION: Email sending  ← build first (everything below sends)
Soterra must **send an email from a `soterra.co.nz` address** and store the record.
- Powers: RFI (to the consultant), QA-flag-to-subs, inspection-items-to-subs.
- Soterra's mail is Microsoft 365 (Exchange Online). For app-sent transactional mail,
  the clean route is a **transactional email service** (e.g. Resend/Postmark/SES) sending
  from a verified `soterra.co.nz` sender (DKIM). Keep it simple; **outbound first**.
- **Reply capture is a fast-follow, not v1** — inbound parsing (a unique reply address per
  thread) is the fragile part; Adam prefers to avoid heavy webhooks. v1: send + record;
  the reply is pasted/logged manually or lands in a Soterra inbox.
- Store: recipient, cc, subject, body, an outbound message-id, timestamps, and the link to
  the RFI/flag it belongs to.

### 3-B. FOUNDATION: Plan pinning component
Drop / save / show an **x,y pin on a drawing**, tied to a record (an RFI, a QA-flag, or a
checklist item).
- The plan viewer already renders each sheet as an image with zoom/pan; **pinning is an
  overlay on that** — click to drop a pin (store x/y as % of the sheet + the drawing id),
  render existing pins, click a pin to open its record.
- ⭐ **The full UX is already mocked and approved: `plan-pinning-mock.html` (repo root).**
  Open it — location picker → scoped check → drop pins → send to subs, all clickable, in
  the real Soterra style. Build the app version to match it.

### 3-C. FOUNDATION: Location extraction at ingest + cache  (module DONE; wire it)
`lib/locations.ts` already derives the physical locations a QA check can be scoped to
(Unit 1, Level 12, Tower A, Basement Car Park, Site-wide…) from a project's own drawing
titles, via `claude-opus-4-8` structured output. The prompt was **hardened by an adversarial
stress-test across 5 naming conventions** (residential, apartment tower, commercial towers,
school blocks, unnamed) — it rejects drawing-type/code/element noise + "Type A" typologies,
rolls up multi-level buildings, folds site works into "Site-wide", applies NZ storey naming
(First Floor → Level 1), returns `[]` (→ free-type) when nothing names a place, and
validates every returned drawing verbatim against the input. **Verified on Kauri's real 120
plans → Unit 1, Unit 2, Ground Floor, Level 1, Roof, Site-wide.** `GET /api/locations`
serves it. General by construction (reads whatever a company uploads).
- **Remaining:** run extraction **at plan-upload/ingest** (`lib/indexPdf.ts`) and **persist
  a per-project cache** keyed on a title fingerprint (currently an in-memory cache), so the
  picker is instant and never a model round-trip. **Merge user-added/renamed zones** (store
  `source: "user"` vs `"extracted"`; user overrides win). Re-run on any plan-set change.

### 3-D. FEATURE: QA-check flow upgrade (uses B + C)
Evolve check creation into: **pick a location → scoped check → pin issues → send failed
items to subs → report titled by location.** Mocked in `plan-pinning-mock.html`.
1. **New check → location picker** (fed by `/api/locations`; "add your own zone" free-type).
2. Generate the check **scoped to that location**, passing the location + its drawings into
   `generateChecklistItems` (so items come from that location's sheets), and pull that
   location's drawing as the sheet to pin on.
3. **Walk the check:** each item keeps Good / Needs-fixing / N-A, and gains **pin on the
   drawing + photo + note.**
4. **Finish:** the Needs-fixing items **send to the responsible subs** (pin + photo + note)
   and are **recorded**; the report is titled "Unit 1 — Fire check: 15 items, 2 need fixing".

### 3-E. FEATURE: RFI system  ← the big one; ⭐ full spec in `RFI-BUILD-SPEC.md`
A **new top-nav tab** (after Insights). The whole RFI conversation (question, answer, full
thread) lives in Soterra; Soterra **sends** the RFI by email; the **killer feature is the
CONSULTANT ACCOUNTABILITY ANALYTICS** — a per-consultant scorecard (open count, avg
turnaround, overdue, ball-in-court) and an **EOT evidence-pack export**: the document a head
contractor hands over when the client blames them for delays, proving the design team held
the ball. `RFI-BUILD-SPEC.md` has the full data model (RFI / ThreadMessage / StatusTransition
audit / ContractInstruction / PlanPin), the 3 screens (register · thread · analytics), the
raise+send flow (AI drafts the RFI pre-cited from plans+code = the differentiator), the 5
statuses (Draft/Open/Answered/Closed/Void) + ball-in-court, and Phase-1-vs-fast-follow.
Uses foundations A (send) + B (pin). **Build HTML-first: mock the 3 screens, agree, then port.**

### 3-F. FEATURE: Inspection items → status + send-to-subs
The extracted inspection items are already a clean categorised list. Give each a **status
(completed / in progress / not done)** — a live worklist — and let the **failed items be
sent to the responsible sub and recorded** (reuses foundation A + the same send/record UI as
QA-flags). Adam: "we generate this nice list, why not send them out and record them."

### 3-G. FEATURE: QA-flag-to-subs (the light sibling of RFI)
Open a plan → **pin a mistake** → note → **send to the sub**, recorded. Reuses A + B and the
RFI send rails. This is what `plan-pinning-mock.html` demonstrates directly.

**Hierarchy note (already shipped, keep in mind):** the assistant already treats a CI / CAN /
client-change as **superseding the drawing it amends** (prompt rule in `ask/route.ts`,
commit a815bdd). The **robust** version — a CI physically linked to the exact drawing it
amends — falls out of the RFI system (an answered RFI spawns a CI linked to its drawing), so
build RFI with that link in mind.

---

## 4. ALREADY DONE — do NOT rebuild
- **Mobile chat cut-off bug** — fixed, LIVE (min-width:0 flex chain in globals.css).
- **Data-security page** — LIVE at `soterra-overview.vercel.app` (source: `Desktop/Soterra/Soterra latest short html pitches/soterra-pitch-gib/index.html`, deploys to the `soterra-overview` Vercel project — note it's a PINNED alias, must `vercel alias set` after deploy).
- **Hierarchy / AMENDMENTS rule** — shipped to the assistant, LIVE (commit a815bdd).
- **Ryanfire demo** — all 4 docs pre-rendered to Blob (bulletproof), dead Mastic URL repointed; visible only to `DEMO_CORPUS_USERS` (founder accounts), verified working on the Kauri Tower founder account.
- **Kauri Tower inspections wiped** (clean slate; 120 plan pages kept).
- **Location extraction** (3-C) — module + endpoint built, committed f8beeac.

---

## 5. NON-BUILD ITEMS — still to be done at some point
- **History learner is still broken** (Adam: "does not work properly") despite an earlier
  6-bug fix + proof suite. Needs a real diagnosis — get a concrete repro from Adam (bad
  counts? wrong items? fabrication?) before touching it. Lives in `lib/history.ts` +
  `dev/_verify-history-fixes.mts`.
- **NZS 3910** (not 3901 — that's a defunct contract). It's "Conditions of contract for
  building and civil engineering construction", the standard behind CIs/variations. **Paid
  (~$166), not free like 3604.** Task: buy a copy for reference; confirm usage with David
  Riley at Standards NZ (we reference clause numbers + process, never reproduce text,
  customers work from their own uploaded contract); add it as a handoff-card reference, not
  ingested text.
- **Free 5-question trial** — scoped (see `project_soterra_access_control` memory), needs
  Adam's sign-off on wording/flow.

---

## 6. KEY FACTS & GOTCHAS (read before coding)
- **LLM calls:** copy `lib/checklist.ts` / `lib/locations.ts` — `claude-opus-4-8`,
  `output_config:{effort:"high", format:{type:"json_schema", schema}}`, `thinking:{type:"adaptive"}`.
  **Every object in the JSON schema MUST set `additionalProperties:false`** (400 otherwise).
  Use **`max_tokens: 8000`** — 4000 truncates the JSON because adaptive thinking eats the budget.
  Always **validate the model's output** (e.g. locations verifies every drawing verbatim
  against the input titles; never trust a returned id you didn't send).
- **Data isolation (the product's whole pitch):** every data request checks membership —
  `resolveProjectId` returns nothing unless the caller is a `projectMembers` row for that
  project; the site list is filtered to the user's own projects. A company only ever sees its
  own sites. Keep this invariant on every new endpoint.
- **Manufacturer/demo gating:** `manufacturer_pages.licence`; `demo`-tier makers (Ryanfire,
  Rondo, James Hardie, ColorSteel, Concrete NZ, Resene, Allproof) are served ONLY to
  `DEMO_CORPUS_USERS` (Adam's founder accounts). Don't leak them to other accounts.
- **`.env.local`** has `DATABASE_URL`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `BLOB_READ_WRITE_TOKEN`,
  and **Clerk TEST keys** — so live Clerk user ids won't resolve with the local Clerk key
  (prod `CLERK_SECRET_KEY` is a "sensitive" Vercel var, unreadable via API). Run DB dev
  scripts with `npx tsx dev/<file>.mts` (they load `.env.local` themselves).
- **Test data:** the **Kauri Tower** project (a founder account, `user_3GcPx9…`) has 120 real
  plans and Ryanfire access — use it to verify anything against real data.
- **Deploy:** a plain `git push` does NOT update the live site — soterra-web publishes only
  via the Vercel CLI. Commit + push your work to git; Adam/the operator handles the deploy.
- **Retrieval eval:** run `npx tsx dev/eval-retrieval.mts` after any retrieval/corpus change
  (0 failed is the number that matters).

---

## 7. ADAM'S WORKING STYLE (follow this)
- **HTML-first:** build a feature's design as a self-contained, clickable **HTML mock**
  first, agree on it in the browser, THEN port to the app. `plan-pinning-mock.html` is the
  model. Iterate the mock before writing app code.
- **Propose before big builds / storyboard >200-line builds** in text first, so you don't
  build the wrong thing and rework it.
- **No em dashes or en dashes** anywhere in his copy — they read as an AI tell. Plain hyphens.
- **Always commit + push** to `main` after a change (don't ask).
- Lead on product and marketing (his weaker side); be research-grounded; verify against real
  data; report outcomes honestly (if something's broken, say so).

---

## 8. RECOMMENDED FIRST STEP FOR THE NEW THREAD
1. Read this file + the memory (`MEMORY.md` → `project_soterra_aspec_roadmap.md`).
2. Open `plan-pinning-mock.html` and `RFI-BUILD-SPEC.md` to see the two design targets.
3. Start with **Foundation 3-C's remainder** (run location extraction at ingest + persistent
   cache) — it's small, it's the "works for every account" spine, and it makes the QA-flow
   picker instant — OR **Foundation 3-A (email sending)** if you'd rather unblock every
   send-feature at once. Confirm the order with Adam, then build foundations → features,
   HTML-first, one at a time.
