# SOTERRA - HANDOVER (next thread, for Fable 5)

You are picking up the Soterra build. Everything below is current as of this handover.
Read it fully, then do the two tasks in section 6. Adam is a PM/founder, not a coder:
explain plainly, lead on product, follow his working style (section 7).

---

## 1. WHAT SOTERRA IS
An AI project assistant for construction. **Live at soterra.co.nz** (B2B, login-only via
Clerk). A company uploads its plans, specs and inspection reports; Soterra answers questions
cited to the source sheet (its own drawings + NZ Building Code + NZ Standards + manufacturer
literature + its own inspection history), generates pre-inspection QA checklists, tracks RFIs
with a consultant-accountability scorecard + EOT evidence pack, and turns filed inspection
reports into a "what do we keep failing on" ranking. Data isolation (per-company, per-project)
is the #1 sales point and an absolute invariant.

The anchor: one Auckland consent had 27 inspections, 22% clean-pass, 67% needed a return
visit; every failed item was a plan lookup or a code figure. Soterra turns a company's own
construction data into company intelligence.

## 2. STACK & DEPLOY
Everything is in **`soterra-web/`** (Next.js app-router, deployed on Vercel).
- Auth: Clerk. DB: Neon Postgres via Drizzle (`lib/db.ts`, tables in `lib/schema.ts`).
- Storage: Vercel Blob. LLM: `@anthropic-ai/sdk`, model `claude-opus-4-8`, structured JSON.
- Retrieval: BM25/TF-IDF, no embeddings (`lib/retrieve.ts`).
- **`app/page.tsx`** is the whole SPA (~4,500 lines): tabs Assistant / Inspections / Plans /
  Upload / RFIs / Insights, the chat, the plan viewer, checklists, RFI screens, all modals.
- **Deploy:** a plain `git push` does NOT update the live site. It publishes only via the
  Vercel CLI: `npx vercel deploy --prod --yes --token=<TOKEN>`. Adam holds a Vercel token
  (ask him to paste one; he creates it at vercel.com -> Account Settings -> Tokens -> Full
  access, and deletes it after). The project is on the shared `montazsapp` Vercel team, linked
  as `soterra-web`. Always: commit + push to `main`, then deploy, then verify live with a real
  `curl -s -o /dev/null -w "%{http_code}" https://soterra.co.nz` (expect 200) - never trust
  "build finished".
- **DB dev scripts:** `npx tsx dev/<file>.mts` - they load `.env.local` themselves and hit the
  PROD Neon DB (that's intended - that's how the live account gets data). `.env.local` has
  Clerk TEST keys, so live Clerk user ids won't resolve locally - but you don't need Clerk for
  DB scripts; read ids from `projectMembers`.
- **Typecheck** after every change: `npx tsc --noEmit`. **House rule: no em/en dashes** in any
  user-facing copy (plain hyphens); it's an AI tell Adam hates.

## 3. WHAT IS LIVE (do NOT rebuild)
All 7 planned features are built, reviewed (two 14-15 agent adversarial passes, all confirmed
findings fixed) and deployed:
1. **Email sending** - `lib/email.ts` + `lib/emailTemplates.ts` + `email_log` table. Record-
   first: every send is logged before transmit. **Currently RECORD-ONLY** (composes + records,
   does not transmit) because `send.soterra.co.nz` isn't DNS-verified yet and `EMAIL_TRANSMIT`
   is off. See section 8.
2. **Plan pinning** - `plan_pins` table, `/api/pins`, the full-screen `PinStage` sheet viewer.
3. **Location extraction at ingest** - `lib/locations.ts` derives QA-scope locations from
   drawing titles; cached on `project_locations`; `/api/locations`.
4. **QA-check flow** - New check -> location picker -> check scoped to that location's sheets ->
   walk it (Good/Needs-fixing/N-A + pin + photo + note) -> send Needs-fixing items to the
   responsible subs, recorded (`send-fixes` route). `subs` table.
5. **RFI system** - `rfis` / `rfi_messages` / `rfi_transitions` (immutable audit) /
   `contract_instructions`. `lib/rfi.ts` (state machine, NZ working-day maths, EOT). The RFIs
   tab: register + thread + analytics (consultant scorecard, turnaround bars, EOT pack). Sends
   via Foundation 1. Impact inputs (critical-path/cost/programme) set at raise or toggled later.
6. **Inspection worklist + send** - failed inspection items get a status + can be emailed to subs.
7. **QA-flag-to-subs** - `qa_flags` table; pin a mistake on a plan, send to the sub, record it.

Plus polish shipped this session: cached plan renders (`lib/planRender.ts`, `image_url`/
`thumb_url` on `plan_pages`) - opening a sheet went from ~10s to ~170ms (56x); a Procore-style
**preview grid** on the Plans tab (`PlanGrid` in page.tsx, `/api/plan-thumb`); scorecard
footnotes + bar-label fix + Reopen% removed; EOT merged into one card; New-RFI form slimmed.

## 4. THE DEMO ACCOUNT (domokadam43@gmail.com / "Kauri Tower")
Repurposed as the demo/showroom account. All FICTIONAL data.
- project `7b66634b-30ac-4722-9fbe-e375f273ecb2`, company `e9210ba0-b03b-402b-8cfa-e6fa66d39055`,
  admin `user_3GcPx9L3pXhpSe20wl9H5rTuS8E`. 120 real plan pages (Kauri's actual drawings, kept).
- **`dev/seed-demo.mts`** (idempotent, re-run to refresh backdated dates) seeded: 21 RFIs
  (designed scorecard - Meridian Mechanical = worst offender, Totara Structural = star, 5
  overdue, 2 EOT rows), 36 inspection reports (clustered failures for Insights), 8 subs, 2
  checklists, 3 QA flags. `dev/verify-demo.mts` asserts the story. The demo data source of truth
  for inspections is **`dev/demo-inspections-data.ts`** (shared by seed + export).
- **Report PDFs**: `dev/export-demo-reports.mts` writes a manifest + folder tree to
  `C:\Users\adam\Desktop\Soterra Demo Inspection Reports\`; the 36 report PDFs were generated
  from it (council "Building Inspection Result" template + consultant "Site Observation Report"
  template, text-based/parseable). Keep consultant/site names fictional; no real firm should be
  the villain.

## 5. KEY GOTCHAS
- **LLM calls:** copy `lib/checklist.ts` / `lib/locations.ts` - `claude-opus-4-8`,
  `output_config:{effort:"high", format:{type:"json_schema", schema}}`, `thinking:{type:"adaptive"}`,
  every schema object `additionalProperties:false`, `max_tokens: 8000`, and VALIDATE the output.
- **Isolation invariant:** every data endpoint goes through `resolveScope`/`resolveProjectId`;
  companyId/projectId come only from verified membership, never a header/body. Keep it on every
  new endpoint.
- **Inspection extraction** (reads uploaded reports -> failed items) lives in
  `lib/inspectionExtract.ts`. This is what Task A stress-tests.
- After retrieval/corpus changes run `npx tsx dev/eval-retrieval.mts` (0 failed is the number).

---

## 6. YOUR TWO TASKS THIS THREAD

### TASK A - More + harder inspection reports (for testing the assistant AND for AUT)
Adam wants inspection report PDFs that are **more numerous and much more challenging to read**,
like real reports: a genuine mix of Pass / Partial Pass / Fail, **questionable / borderline
items** a human would flag ("possibly non-compliant, confirm on site", "appears short but not
measured"), human shorthand, inconsistent wording, items buried in long "inspection summary"
prose (like real Auckland Council reports do - the finding is inside a paragraph, not a tidy
list), abbreviations, the odd ambiguous outcome. Purpose: (1) stress-test our own reading
(`lib/inspectionExtract.ts` must still pull the right failed items out of messy input), and (2)
a set Adam can hand to AUT.

How to build it (reuse the existing pipeline):
- The current clean 36-report set is the DEMO set - **keep the demo seed clean** (its Insights
  story is deliberately legible; don't muddy it). Make the hard reports a **separate, larger
  batch** (aim ~40-60+), in a new folder e.g. `Soterra Challenge Inspection Reports` on Adam's
  Desktop, generated the same way (a manifest + the two PDF templates in the reusable python
  generator; ask Adam for the generator, or re-derive from `dev/demo-inspections-data.ts` +
  `dev/export-demo-reports.mts` + the council/consultant templates already proven this session).
- Model the council reports on the REAL samples in `C:\Users\adam\Desktop\Soterra\inspections\`
  (open a few) - especially how findings hide inside an "Inspection Summary / items to be
  resolved" prose block, with "N/A" checklist rows and a mix of Pass/Partial. That messiness is
  the point.
- After generating, VERIFY: extract text from several, confirm they're text-based (not images),
  and ideally upload one or two into a SCRATCH project (not the polished demo) and check
  `inspectionExtract` pulls sane items - report where it struggles (that's useful signal).
- Do NOT touch the DB/deploy for this task unless you deliberately test extraction in a scratch
  project. It's a file-generation + robustness-probe task.

### TASK B - Plan checking should default to the FLOOR PLAN
Adam's product call (I agree): when you pin an item/issue for a location-scoped check, the
drawing that opens should be the **floor plan / GA plan** for that area - the "you are here"
map you drop a pin on - not a random detail sheet. Right now it opens the location's FIRST
drawing, which is often a detail sheet.

- Current behaviour: `openPinFor` in `app/page.tsx` (~line 2169) sets the pin drawing to
  `loc.drawings[0]` (the location's first drawing) or `docs[0]` (first site doc). `loc.drawings`
  comes from `lib/locations.ts` (drawings assigned to a location by title).
- Implement: a small helper `floorPlanFor(locationLabel, docs)` that picks a floor/GA plan by
  sheet title - prefer titles containing "floor plan" / "GA" / "general arrangement" / a bare
  "... plan" and NOT "detail" / "section" / "elevation" / "schedule"; prefer one whose
  level/area matches the location; fall back to the location's first drawing, then the first
  site doc. Use it in `openPinFor` (and anywhere a location-scoped pin surface is chosen). Keep
  the existing "pin already exists -> open its own sheet" branch first.
- Nice-to-have: the `PinStage` viewer has page nav but no sheet switcher, so once on the floor
  plan you can't flip to the detail sheet. Consider a small "switch sheet" control. Optional;
  confirm with Adam before building.
- Propose the approach to Adam in text first (he likes propose-before-build), then implement,
  commit, deploy, verify.

---

## 7. ADAM'S WORKING STYLE
- **Propose before building** anything non-trivial; show wording/design specifics and get a yes.
- **HTML-first** for new UI surfaces: mock it, agree in the browser, then port.
- **No em/en dashes** anywhere in his copy. Plain hyphens.
- **Always commit + push to `main`, then deploy, then verify live** - he never touches the
  terminal; you run everything end to end.
- Lead on product/marketing (his weaker side), be research-grounded, verify against real data,
  and report outcomes honestly (if something's broken or record-only, say so).
- He often works from screenshots - read them carefully.

## 8. PENDING / PARKED (not this thread unless he asks)
- **DNS for email:** 3 records for `send.soterra.co.nz` must go into Adam's registrar
  (he says "Domains Direct"; nameservers are secureparkme/syrahost). Records (from Resend,
  domain id 4c34f64c-b31b-488a-8248-1b92d2dad838):
  - TXT  host `resend._domainkey.send`  value `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDKkxx4vSMSuUtknl+FQRvGZZMxXXF4+sTuMDs/j1Rf7OuYWwkM73ZuDuHws7alcQFjKSsJSWf5gaUufxHd9wPMk9gJOmtYuem35EtCcVvQZ3u9E7JkXr4wzwNHdrRzfcDwyq0dbOjJmbtJ96ZMPQLHVCm2yLlhwJ5KOxG+RH8tLwIDAQAB`
  - MX   host `send.send`  value `feedback-smtp.us-east-1.amazonses.com`  priority 10
  - TXT  host `send.send`  value `v=spf1 include:amazonses.com ~all`
  Once Adam adds them: verify from your side (DNS lookup), confirm Resend shows verified, then
  set `EMAIL_TRANSMIT=1` in Vercel env + `.env.local`, redeploy, and fire a test RFI/flag so he
  sees a real email. Resend keys: a send-only key is already in `.env.local`/Vercel.
- **Consultant portal** (later, once there's a customer): a restricted-view consultant login
  that sees only their RFIs + referenced plans and answers in-app - closes the RFI loop so the
  turnaround clock stops automatically instead of a manual "Log answer".
- Standards NZ + MBIE both green-lit standards usage; Ryanfire in, Trafalgar Fire in the pipe.
- History learner was flagged flaky earlier; get a concrete repro from Adam before touching it.

## 9. FIRST STEP FOR THE NEW THREAD
Confirm the two tasks with Adam (and for Task B, propose the floor-plan approach), then go:
Task A (harder report set) and Task B (floor-plan default), one at a time, commit/push/deploy/
verify as you go.
