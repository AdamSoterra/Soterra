# Soterra RFI Platform — Build Spec

_Grounded in real NZ commercial-construction RFI practice + contractor delay-defense analytics + a competitive scan of Procore / Aconex / Autodesk / Fieldwire (Aug 2026)._

Brand: DM Sans, blue `#0E8FE6`, navy `#0C2A47`, white cards, soft shadows, tab nav. New top-nav tab **`RFIs`** between Plans and Insights. One project per assistant, so no portfolio roll-ups.

**One-line pitch to hold the design to:** register + ball-in-court + official-response thread + three turnaround numbers at 20% of Procore's surface area, plus Fieldwire pin-on-sheet — and the AI drafts the RFI pre-cited from the plans and the code, the one job every incumbent still leaves to a human.

---

## 1. DATA MODEL

### Entity: `RFI`
| Field | Type | Notes |
|---|---|---|
| `id` | uuid | internal |
| `number` | string | display `RFI-014`; optional discipline segment `RFI-STR-014`. Assigned on Send, not Draft |
| `revision` | int | 0,1,2… reissues |
| `subject` | string | short title |
| `discipline` | enum | Architectural, Structural, Civil, Fire, Mechanical, Electrical, Hydraulic, Geotech, Facade |
| `status` | enum | Draft, Open, Answered, Closed, Void (see §4) |
| `ball_in_court` | ref(party) | derived; indexed; drives dashboard + overdue clock |
| `priority` | enum | Normal, High, Critical |
| `location` | string | level / zone / gridline (free text) |
| `question` | rich text | |
| `proposed_solution` | rich text | contractor's suggested answer (expected on NZ jobs) |
| `drawing_refs[]` | ref(plan_pin) | drawing no. + revision, each with an x/y pin |
| `code_refs[]` | string | spec section / NZS clause (pre-cited by AI) |
| `attachments[]` | file | name, type, uploaded_by, ts |
| `cost_impact` | enum + $ | None / Unknown / Yes ($est) |
| `programme_impact` | enum + days | None / Unknown / Yes (N days) |
| `critical_path` | bool | drives EOT pack |
| `raised_by` | ref(user) | individual + company |
| `assignee` | ref(consultant) | **individual + consultant company** — the accountability key |
| `cc[]` | ref(party) | distribution list (emails) |
| `date_raised` | datetime | on Send |
| `date_required_by` | date | contractor's needed-by (default = raised + SLA working days) |
| `date_answered` | datetime | |
| `date_closed` | datetime | |
| `resulting_ci` | ref(CI) | nullable forward link |
| `email_message_id` | string | outbound Message-ID (for reply threading, fast-follow) |
| `created_at` / `updated_at` | datetime | |

### Entity: `ThreadMessage`
| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `rfi_id` | ref(RFI) | |
| `type` | enum | `question` (original), `official_answer` (promoted/locked, one of), `followup`, `system` (status change / sent / bounced-back) |
| `author` | ref(party) | individual + company |
| `author_side` | enum | contractor / consultant / client — colours the bubble |
| `body` | rich text | |
| `attachments[]` | file | |
| `created_at` | datetime | immutable |

### Entity: `StatusTransition` (immutable audit — the evidentiary core)
`rfi_id`, `from_status`, `to_status`, `by_user`, `at`, `comment`, `ball_from`, `ball_to` (the party hand-off recorded here too).

### Entity: `ContractInstruction` (spawned from an answer)
`id`, `number` (`CI-001`, own sequence), `title`, `source_rfi` (back-ref), `amends_drawings[]` (drawing + from_rev → to_rev), `cost`, `created_at`.

### Entity: `PlanPin`
`id`, `rfi_id`, `drawing_number`, `drawing_revision`, `sheet_id`, `x`, `y` — bidirectional (sheet ↔ RFI).

### What analytics reads (all derivable from the above)
`assignee.consultant_id` · `date_raised` / `date_answered` (→ working-day turnaround) · `date_required_by` (→ overdue) · `StatusTransition[]` (→ net consultant-side days, pausing the clock when ball returns to contractor) · `ball_in_court` (→ current split) · `critical_path` + `programme_impact.days` (→ EOT pack) · `cost_impact.$` · reopen/followup count (→ answer quality).

---

## 2. THE THREE SCREENS

### (a) RFI REGISTER — the default view of the tab
**Top summary strip** (3 tiles, left-aligned, small):
- `18 open` (sub-label: 14 with consultants)
- `Avg response 11.4 wd` (red vs `7 wd allowed` shown beneath)
- `5 overdue` (red tile)

**Filter bar** (chips, single-select toggles): `All · My court · Overdue · By discipline ▾ · By consultant ▾ · Status ▾`. Default = All open.

**Table columns** (exactly these six — resist Procore's 12):
1. `RFI #`
2. `Subject`
3. `Ball in court` — coloured pill: navy = consultant name, grey = us, amber = client
4. `Status` — Open / Answered / Closed / Void pill
5. `Due` — date; **row / due cell turns red when overdue**
6. `Days open` — integer, right-aligned

Row click → RFI Detail. Overdue rows get a left red accent bar. `+ New RFI` button top-right; a subtle "drafts (2)" link for un-sent drafts.

### (b) RFI DETAIL / THREAD
**Header:** `RFI-014 · Rev 0` · subject · status pill · ball-in-court pill · discipline · priority. Right side: `Due 22 Aug · 6 days open`.

**Left column (the thread, ~65%):**
- **Question card** (top, bordered): question text; `Proposed solution` sub-block; **cited references** as chips — `A-201 Rev C 📌` (click → jumps to plan pin) and code chips `NZS 3604 cl 7.1.2` (click → citation viewer). Attachments row.
- **Send action** (when Draft): recipient (`to: Jane Smith, Holmes Structural`), cc list, `Send RFI` primary button. Once sent → a `system` line: "Sent to Holmes Structural, 12 Aug 09:14".
- **Official Answer card** — visually promoted (blue left border, "Official response" label, locked). Empty state: "Awaiting response — log answer" button.
- **Follow-up messages** — chronological bubbles, coloured by side (contractor / consultant), author + timestamp. `Add follow-up` composer at bottom.
- **Resulting CI** — once answered and flagged as a change: green banner "This answer spawned `CI-014` → revises A-201 Rev C→D" with a link. `Create clarification/CI` button on any answer.

**Right rail (~35%):**
- **Plan pin preview** — thumbnail of the drawing with the pin dropped; "Open on plan" link.
- **Details block** — assignee, raised by, cost impact, programme impact + critical-path flag, dates.
- **Activity / audit** — collapsible list of status transitions (from → to, who, when).

### (c) ANALYTICS / CONSULTANT SCORECARD
**Tile row** (ranked, 4 big):
1. **Ball in court: consultants vs us** — `14 design team / 4 us` (count + %)
2. **Avg consultant response vs allowance** — `11.4 wd vs 7 wd` (red when over)
3. **Overdue RFIs** — count past required-by, still open
4. **Open RFIs (total)**

(secondary tiles if room: `Potential EOT days linked`, `Cost impact flagged`.)

**⭐ Chart 1 — Consultant Scorecard table (THE feature).** One row per consultant. Columns: `Consultant | Open | Avg turnaround (wd) | Median | % within SLA | Overdue | Avg days late | Longest open | Reopen % | ▲▼ trend`. RAG-coloured cells against the SLA, worst offender sorted to top. This is the artefact screenshotted into monthly minutes.

**Chart 2 — Turnaround by consultant (horizontal bars).** avg turnaround per consultant, median tick, vertical SLA line at 7 wd; bars past the line go red.

**Chart 3 — Ball-in-court split (stacked bar / doughnut).** Open RFIs: contractor vs client vs each consultant.

**Chart 4 — Aging (stacked bars by bucket).** Open RFIs across `0–7 / 8–14 / 15–28 / 29–42 / 43+` working days, coloured by consultant.

**Chart 5 — Raised vs answered over time (S-curve).** Cumulative raised vs answered; widening gap = backlog story.

**Bolt-on button — `Generate EOT evidence pack`.** Filters to `late AND critical-path` RFIs, exports a cause-and-effect table: `RFI # | subject | issued | required-by | responded | net consultant wd late | linked activity | schedule-impact days | cost flag | status`.

Guardrail note shown on-screen: the assumed SLA is displayed ("7 working days"); turnaround is **net of clarification bounce-backs**; the contractor's own late-raised RFIs are included (honest log).

---

## 3. RAISE + SEND FLOW
**Path A — AI-drafted (the differentiator):** In Assistant, a plan/spec answer surfaces a `Raise RFI` action. Soterra pre-fills subject, question, **drawing_ref + pin**, and **code_ref clause** from the citation it just produced → opens the New-RFI form pre-populated.

**Path B — New-RFI form:** subject, discipline, question, proposed solution, priority, location; pick drawing → drop pin on sheet; add code refs; assignee (person + consultant company) + cc; required-by (auto = today + SLA, editable); attachments. Saves as `Draft` (no number burned yet).

**Send:** `Send RFI` → assigns `number`, `status = Open`, `ball_in_court = assignee`, `date_raised = now`, writes a StatusTransition. **Soterra emails the consultant** the formatted RFI (question + refs + attachments + a note that the thread lives in Soterra), storing the outbound `email_message_id`.

**Log the answer (Phase 1 = manual):** consultant replies by email; contractor pastes/attaches the response → `Log answer` creates the `official_answer` ThreadMessage, `status = Answered`, flips ball to contractor, stamps `date_answered`. Contractor either `Close` (accept) or, if it changes the works, `Create CI` (spawns `ContractInstruction`, links the drawing rev delta) then Close. Follow-ups add `followup` messages and can bounce the ball (status → Open, ball → consultant).

---

## 4. STATUS SET + BALL-IN-COURT
**Five statuses:**

| Status | Ball |
|---|---|
| `Draft` | Contractor (not sent, no number) |
| `Open` | Consultant (assignee) — issued, clock running |
| `Answered` | Contractor (to accept/close or dispute) |
| `Closed` | Nobody (locked) |
| `Void` | Nobody (raised in error) |

`Overdue` is a **derived flag**, not a status (Open + past required-by).

**Allowed transitions** (enforce): Draft→Open, Draft→Void, Open→Answered, Open→Void, Answered→Closed, Answered→Open (bounce/reopen), Closed→Open (reopen). Every transition writes a `StatusTransition` row.

**Ball-in-court model:** a party reference (consultant company/person · contractor · client), not a two-way toggle — it can pass laterally between consultants on multi-discipline RFIs. Recomputed on each status/assignee change. When the consultant bounces for info, ball → contractor and the **consultant-side clock pauses** (this net figure is what analytics reports).

---

## 5. PHASE 1 vs FAST-FOLLOW
**Phase 1 (build now):**
- Register (6 cols + summary strip + filters + overdue signal)
- Detail/thread (question w/ cited refs, Send, manual `Log answer`, follow-ups, plan pin, Create-CI link)
- Soterra **sends** the RFI email (outbound only)
- Full analytics data captured from day one (timestamps, StatusTransition audit, assignee = consultant id, ball-in-court) → Scorecard table + tiles + turnaround bar + ball-in-court split live immediately
- EOT evidence-pack export

**Fast-follow:**
- **Auto-capture of email replies** — inbound parsing keyed on `email_message_id` / reply headers, so the consultant's emailed answer lands in the thread automatically and flips status to Answered without a manual paste
- Aging + raised-vs-answered charts, turnaround-trend line, reopen-rate quality metric
- Discipline-segmented numbering, RFI revisions/reissue

---

_Build order per [[feedback_html_first_then_app]]: HTML mock of the three screens first, agree in the browser, then port to the app. See [[project_soterra_aspec_roadmap]] point 3._
