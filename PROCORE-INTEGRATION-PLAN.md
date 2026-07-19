# Soterra x Procore - Integration Plan

_Written 2026-07-18. Status: DRAFT for validation. Do not apply to the Procore Developer program until 1-2 Procore-using firms have confirmed the value (see "Validation gate" below)._

## 1. Why this is the flagship integration

Static uploaded plans go stale the moment a drawing is revised. Procore versions drawings natively, so if Soterra reads drawings straight from Procore we get:

- No manual upload. Plans land in Soterra automatically.
- Always current. When a firm issues a revision, Soterra re-indexes it.
- Zero extra AI cost. Procore-sourced PDFs go through the exact same text-extraction pipeline we already run for uploads ($0, no OCR, no model calls).

Positioning: **Soterra is the intelligence layer on top of Procore.** We do not replace Procore's drawing register, we make it answerable in plain language, cited to the sheet.

This is the one integration worth the OAuth friction because it targets Procore-paying firms and keeps their plan set permanently fresh. WhatsApp / Outlook / camera-roll can stay screenshot-based.

## 2. How Procore drawings enter our existing pipeline

Our current upload pipeline (confirmed in code):

- `app/api/upload/token/route.ts` - authorizes a direct-to-Blob upload (Clerk + membership check, path locked to `${projectId}/`, PDF only, 100 MB max).
- `app/api/upload/process/route.ts` (`maxDuration=300`) - pulls the private Blob bytes, extracts per-page text with `unpdf` (`getDocumentProxy` + `extractText(..., {mergePages:false})`), drops pages under 10 chars, **deletes existing rows for that (projectId, doc)**, then bulk-inserts one `plan_pages` row per page in chunks of 100.
- `lib/schema.ts` - `planPages` = one row per PDF page (`projectId`, `doc`, `file` = Blob pathname, `page`, `npages`, `text`, plus `code`/`title`/`disc` reserved but unpopulated).
- Search is lexical (BM25-style) in `app/api/ask/route.ts` (`getProjectIndex`, `search_plans`). No embeddings.

**Key insight: a Procore drawing is just a PDF.** Once we have the bytes, indexing is identical to an upload. The integration is entirely about *getting the bytes and keeping them fresh* - the indexing half already exists and costs nothing.

### The one refactor this needs

The index core is currently inlined inside the `POST` handler of `app/api/upload/process/route.ts` (lines ~52-82) and nothing is exported. Extract it into a shared, auth-free helper:

```
lib/indexPdf.ts
  export async function indexPdf({ projectId, doc, bytes, file }): Promise<{ pages: number }>
    // 1. getDocumentProxy(bytes) + extractText(mergePages:false)
    // 2. build one row per page (skip <10 chars)
    // 3. delete existing rows for (projectId, doc)
    // 4. chunked bulk insert into plan_pages
```

Then:
- `app/api/upload/process/route.ts` keeps its Clerk/membership gate and calls `indexPdf(...)`.
- The Procore sync worker calls the same `indexPdf(...)` after landing the drawing in Blob under `${projectId}/`.

This is a pure lift, no behaviour change to existing uploads. It is the first, safe, code-only task and can ship before any Procore account exists.

## 3. Procore API facts (verified 2026-07-18)

**OAuth 2.0 - Authorization Code grant** (developers.procore.com):
- Authorize: `https://login.procore.com/oauth/authorize` (params: `client_id`, `response_type=code`, `redirect_uri`, `state`)
- Token: `https://login.procore.com/oauth/token` (exchange `code` + `client_id` + `client_secret` + `redirect_uri`)
- Access token lives **1.5 h (5400 s)**. Authorization code single-use, 10 min.
- Refresh token has **no fixed expiry**; every refresh returns a **new access AND new refresh token**, and the old refresh token is invalidated immediately. So we must persist the rotating refresh token on every refresh.
- Sandbox available for build/test before production.

**Drawings REST API** (`/rest/v1.0`, needs `project_id`; company scoping via `Procore-Company-Id` header):
- List drawing areas: `GET /rest/v1.0/projects/{project_id}/drawing_areas`
- List drawings: `GET /rest/v1.0/drawing_areas/{drawing_area_id}/drawings`
- **List drawing revisions: `GET /rest/v1.0/projects/{project_id}/drawing_revisions`** - returns *all* revisions; filter to the live set with **`current: true`**. This is the endpoint we live on.
- Each revision carries a downloadable **PDF URL** (confirmed to exist; exact field name to confirm in sandbox - likely a `pdf`/`file` object with a signed `url`), plus discipline, sheet number/title, revision, and updated timestamps we can map onto `plan_pages.code/title/disc`.
- Enumerate what a token can see: `GET /rest/v1.1/companies`, then `GET /rest/v1.0/projects?company_id=...`.

**Webhooks API** (for revision re-sync):
- Create hook: `POST /rest/v1.0/webhooks/hooks` (`project_id` or `company_id`, `destination_url`, `api_version`, `namespace`).
- Add trigger: `POST /rest/v1.0/webhooks/hooks/{hook_id}/triggers` with `resource_name` + `event_type` (`create`/`update`/`delete`).
- Payload includes `resource_name`, `resource_id`, `event_type`, `company_id`, `project_id`, `timestamp`, `api_version`.
- **To confirm in sandbox:** whether `drawing_revisions` is an available `resource_name` and how Procore signs the POST. If drawing revisions are *not* directly subscribable, fall back to a scheduled poll of `drawing_revisions?filters...` (cron) as the re-sync trigger. Design assumes webhook-preferred, poll-fallback.

## 4. Data model additions

Two new tables in `lib/schema.ts` (mirroring the existing plain-text-FK convention, no cross-table DB FKs):

```
procoreConnections
  id            uuid pk
  projectId     text        -- our Soterra project (the site)
  procoreCompanyId  text
  procoreProjectId  text
  accessToken   text        -- encrypted at rest
  refreshToken  text        -- encrypted, rotates on every refresh
  tokenExpires  timestamptz
  connectedBy   text        -- Clerk userId who authorized
  status        text        -- active | expired | revoked
  createdAt / updatedAt

procoreDrawings   -- maps a Procore revision to what we indexed, for idempotent re-sync
  id                    uuid pk
  projectId             text
  procoreDrawingId      text
  procoreRevisionId     text
  doc                   text        -- the plan_pages.doc we wrote
  blobPathname          text
  revisionLabel         text
  indexedAt             timestamptz
```

One Soterra project maps to exactly one Procore project. `procoreDrawings` gives us idempotency: on a webhook/poll we compare `current` revision ids to what we last indexed and only re-pull the changed sheets.

Token encryption: store `access`/`refresh` tokens encrypted with a server-side key (new env `PROCORE_TOKEN_KEY`), not plaintext. Never log tokens.

## 5. The flow, end to end

**A. Connect (per company/project, one-time, admin-driven)**
1. In the Soterra project settings, a project admin clicks **"Connect Procore."**
2. We redirect to `login.procore.com/oauth/authorize` with `state` (CSRF + our projectId).
3. Callback `app/api/procore/callback/route.ts` exchanges the code, stores encrypted tokens in `procoreConnections`.
4. We call `GET /rest/v1.1/companies` + `projects` and let the admin pick which Procore project maps to this Soterra site.

**B. Initial backfill**
5. Fetch `drawing_revisions?...` where `current: true` for the mapped project.
6. For each current revision: download the PDF, `put` it into Blob at `${projectId}/procore/<sheet>-<rev>.pdf` (`access:'private'`), call `indexPdf(...)`, record it in `procoreDrawings`.
7. Runs as a background job (page-at-a-time; respect Procore rate limits and our 300 s function cap - chunk across invocations or use a queue for large sets like Kauri Tower's 120 sheets).

**C. Stay current (the payoff)**
8. Register a webhook on the mapped project for drawing revision create/update (or, fallback, a cron poll).
9. `app/api/procore/webhook/route.ts` receives the event, verifies the signature, looks up the affected drawing, pulls the new `current` revision, re-runs `indexPdf(...)` (which deletes the old rows for that `doc` and inserts the new ones), updates `procoreDrawings`.
10. Result: a superseded sheet is never in the answer set. The assistant always cites the live revision.

**D. Token upkeep**
11. A small `getProcoreToken(projectId)` helper refreshes when `tokenExpires` is near, persisting the rotated refresh token every time.

## 6. Build phases

| Phase | Deliverable | Needs Procore account? |
|---|---|---|
| 0 | Extract `lib/indexPdf.ts`, wire existing `/process` route to it (no behaviour change) | No - ship now |
| 1 | OAuth connect + callback + token store, "Connect Procore" button, company/project picker (sandbox) | Sandbox app |
| 2 | Initial backfill of current revisions -> Blob -> `indexPdf` -> `procoreDrawings` | Sandbox app |
| 3 | Revision webhook (or cron-poll fallback) -> re-index | Sandbox app |
| 4 | Token encryption, rate-limit backoff, error/retry, backfill queue for large sets | Sandbox app |
| 5 | Production: apply to Developer program / Marketplace, optional move to DMSA Data Connection App for unattended sync | Production app |

Phase 0 is safe today. Phases 1-4 all run against Procore's **sandbox** - no program approval or partner status needed to build and prove the whole thing.

**Auth-model note:** Authorization Code grant (above) is the fastest path and works in sandbox immediately, but the background sync then depends on one user's rotating refresh token (breaks if that user is deactivated). For production hardening, Procore's **Data Connection App + Developer Managed Service Account (DMSA)** / Client Credentials grant is the cleaner fit for unattended company-level sync. Plan: build phases 1-4 on Authorization Code, evaluate DMSA at phase 5.

## 7. Validation gate (do this BEFORE applying to the Developer program)

Adam validates with 1-2 Procore-using NZ firms:
- Do they keep their live drawing set in Procore's Drawings tool (vs Files/other)? Our plan reads the **Drawings** tool specifically.
- Roughly how many sheets and how often do revisions land? (sizes the backfill + webhook load)
- Would "ask your Procore drawings in plain language, always the current revision, cited to the sheet" get them to pay?
- Who in the firm can authorize an OAuth app install (admin permission)?

If drawings actually live in the **Files** tool for some firms, add the Files API (`GET /rest/v1.0/files`) as a secondary source in phase 2. Same `indexPdf` downstream.

## 8. Open questions to close in sandbox

1. Exact field name for the revision's downloadable PDF URL, and whether it is a signed/expiring link (affects when we download).
2. Is `drawing_revisions` a subscribable webhook `resource_name`? If not, cron-poll fallback.
3. Webhook signature scheme (how we verify authenticity).
4. Rate limits on `drawing_revisions` + PDF download (paces the backfill).
5. Do we want per-sheet mapping to `plan_pages.code/title/disc` now (Procore gives us clean discipline/sheet metadata we currently leave null) - cheap win for citation quality.

## 9. Risks

- **Auth fragility** (Authorization Code depends on one user's token) - mitigated by DMSA at phase 5.
- **Backfill size vs 300 s cap** - Kauri Tower is 120 sheets; must chunk/queue, not one request.
- **Signed-URL expiry** - download immediately, don't store the Procore URL and fetch later.
- **Program approval latency** - none of phases 0-4 are blocked by it; only production launch is.

---

_Next action after Adam's validation: stand up a Procore sandbox app, do Phase 0 (the `indexPdf` extraction) in parallel since it needs no account._
