# Soterra x Procore - Integration Plan

_Rev 2, 2026-07-19. Status: DRAFT, and the strategic case is now genuinely open (see section 9). Do not commit significant build time until the validation in section 8 is done._

## 1. What this would do

Static uploaded plans go stale. Procore versions documents natively, so reading from Procore gives us: no manual upload, always-current plans, automatic re-index on revision, and it all costs $0 in AI (same `unpdf` text extraction we already run).

Scope is **not just drawings**. If we hold an OAuth connection we should read the whole project record:

| Source | Why it matters |
|---|---|
| **Drawings** | The live sheet set, always at current revision |
| **Specifications** | Arguably higher value than drawings. "What does the spec say about cover to reinforcement" is the real question. Currently hand-uploaded (280pp). |
| **RFIs** | Already a question + official answer pair. "Has this been asked before?" answered from the project's own history, with nobody authoring anything. |
| **Submittals** | What materials were actually approved |
| **Files / Documents** | Everything else the team filed |
| **Daily logs** | Site history: who was on site, weather, incidents |

## 2. How it plugs into what we already have

Our pipeline (verified in code): client uploads direct to Vercel Blob (`app/api/upload/token/route.ts` authorizes), then `app/api/upload/process/route.ts` pulls the bytes and indexes. Search is lexical (BM25-style) over `plan_pages` in `app/api/ask/route.ts`. No embeddings.

**A Procore drawing is just a PDF.** Once we have bytes, indexing is identical to an upload.

### Phase 0 - DONE (shipped 2026-07-19, commit 5a013e2)

Extracted the index core into `lib/indexPdf.ts`: auth-free, takes `{projectId, doc, bytes, file}`, returns a typed result. Both the upload route and any future Procore worker call the same helper.

Found and fixed a latent bug while verifying: `getDocumentProxy` posts the buffer to a pdf.js worker which **detaches** it, so `indexPdf` was consuming the caller's bytes. Invisible in the upload route (one call per request) but it would have made every Procore sync **retry** silently report a good PDF as corrupt. Now copies before parsing. Regression harness at `dev/verify-indexpdf.mts`.

### The structured-record problem (not yet solved)

`plan_pages` is PDF-page-shaped (`doc`, `page`, `npages`, `text`). RFIs, submittals and daily logs are **structured JSON records, not PDFs**. They need a second ingestion path.

Cheapest approach: add `kind` ("plan" | "spec" | "rfi" | "submittal" | "log") and `source` ("upload" | "procore") columns to `plan_pages`, and write structured records as text rows. The existing lexical search then picks them up for free, and citations can say "RFI 042" instead of "page 7". Small migration, large payoff. **This is also useful without Procore** - it lets us ingest RFIs from any source.

## 3. Access model - the real path (corrected)

**Building is free and unblocked. Touching a real customer is not.**

1. **Developer Portal signup is free and self-serve.** No approval, no payment, no need to be a Procore customer.
2. **Registering an app auto-creates a Developer Sandbox** pre-seeded with sample users, a project, **drawings, RFIs and submittals**. This is enough to build and prove the entire integration.
3. **Production access requires Procore approval - two gates:**
   - **Verify your organization** (one-time). Choose **Private Developer** (no partnership agreement required) or Marketplace Partner. Business email required.
   - **Request Production Credential Access** (per app), reviewed against the API Terms of Use.
   - Docs state plainly: _"Until your request is submitted and approved, your app cannot be installed in any customer's production environment."_
4. **Then** a customer admin installs it. No Marketplace listing needed.

### What Maree would actually do (once we're approved)

Company Admin tool → Company Settings → **App Management** → **Install App** → **Install Custom App** → paste the 36-character **App Version ID** we give her → install → select which projects we may access.

She needs **Admin permission on the Company level Directory tool**. Custom apps also skip Marketplace re-approval on every update.

**So: she cannot give us access today.** Procore has to approve us first, and the review has **no published timeline**.

### Auth: use DMSA, not Authorization Code

A **Developer Managed Service Account** (OAuth 2.0 **Client Credentials**) is the right model: a service account auto-created in the customer's directory at install, with permissions we declare in the app manifest and the admin approves as a bundle, plus the admin picking permitted projects. No per-user login, no rotating-refresh-token babysitting, doesn't break when the authorizing employee leaves. Works for custom installs, not just Marketplace.

This supersedes Rev 1's Authorization Code recommendation.

## 4. API surface (verified)

Undocumented but unauthenticated OpenAPI source, far better than scraping the SPA:
`GET https://developers.procore.com/api/v1/resource_groups` and `.../resource/{id}?version=rest_v1.0`

| Resource | Endpoints | Files |
|---|---|---|
| Drawings | `/rest/v1.0/projects/{pid}/drawing_areas`, `/drawing_areas/{id}/drawings`, `/projects/{pid}/drawing_revisions` (filter `current: true`), `/drawing_revisions/{id}/drawing_tiles` | `pdf_url` per revision |
| Specifications | `/rest/v1.0/specification_section_revisions` → `url`; v2.1 adds `/download`, `create_zip_download`, `single_pdf_download` | Yes, PDF is on the **revision** not the section |
| RFIs | `/rest/v1.0/projects/{pid}/rfis`, `/rfis/{id}`, `/rfis/{id}.pdf`, `/rfis/export` | Partial - list omits attachments, needs per-RFI Show (N+1) |
| Submittals | `/rest/v1.1/projects/{pid}/submittals`, `/{id}`, `/{id}.pdf`, `/{id}/workflow_data` | Yes, list already carries attachment URLs |
| Files / Docs | Legacy `/rest/v1.0/folders`, `/files/{id}`, `/file_versions/{id}`; new `/rest/v1.0/projects/{pid}/documents` | Yes - `file_versions[].url`, recursive folder walk |
| Photos | `/rest/v1.0/images?project_id={pid}` | Yes |
| Daily logs | No single collection - ~18 per-type resources (`work_logs`, `manpower_logs`, `accident_logs`, …) | Varies, ~10 types have none |

**Webhooks** for re-sync: `POST /rest/v1.0/webhooks/hooks` then `/hooks/{id}/triggers` with `resource_name` + `event_type`. Payload carries `resource_name`, `resource_id`, `event_type`, `project_id`, `timestamp`. Confirm in sandbox whether `drawing_revisions` is subscribable; cron-poll fallback if not.

### Gotchas that will bite

- **File URLs 302-redirect to AWS S3.** You must NOT forward the `Authorization` header past the redirect (most clients re-attach automatically). Set `followRedirects: false` and walk manually.
- **Field naming is inconsistent** (`url`, `pdf_url`, `download_url`, `prostore_file.url`). Write one normalizing adapter.
- **Rate limit 3,600 req/hr** - the real constraint given recursive folder walks plus per-RFI fetches.
- **Daily-log endpoints default to today only** if you omit a date param.
- Signed URLs expire: download immediately, never store the Procore URL for later.

## 5. Data model additions

```
procoreConnections   id, projectId, procoreCompanyId, procoreProjectId,
                     accessToken (encrypted), tokenExpires, status,
                     connectedBy, createdAt/updatedAt
procoreDocs          id, projectId, procoreType, procoreId, procoreRevisionId,
                     doc, blobPathname, indexedAt
```
`procoreDocs` gives idempotent re-sync: compare current revision ids to what we last indexed, pull only what changed. Tokens encrypted with a new `PROCORE_TOKEN_KEY`. Never log tokens.

## 6. Build phases

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | `lib/indexPdf.ts` shared indexer | **DONE** |
| 0.5 | `kind`/`source` columns so structured records are indexable | None - useful without Procore |
| 1 | Free dev signup, register app, explore the seeded sandbox | Free |
| 2 | DMSA auth + manifest permissions; pull drawings + specs → `indexPdf` | Sandbox |
| 3 | RFIs/submittals via the structured path; normalizing download adapter | Sandbox |
| 4 | Webhook (or cron-poll) re-sync; rate-limit backoff; backfill queue | Sandbox |
| 5 | Org verification + production credential request | **Procore approval, no SLA** |
| 6 | Maree installs custom app, real-data pilot | After phase 5 |

## 7. ⚠️ Terms of Use risk - resolve before deep build

Verbatim from Procore's requirements:

> "You must not use Procore data to train, fine-tune, or benchmark AI/ML models (including LLMs)."

> "You must not use Procore APIs for large-scale data extraction, bulk export, or data harvesting beyond your app's core functionality."

The training clause is probably survivable: retrieval at inference time is not training or fine-tuning, and we do no training. The **bulk-extraction clause is the real problem** - Soterra's core loop is indexing an entire project's document set, which is close to "bulk export." The saving phrase is "beyond your app's core functionality," which arguably protects us since indexing *is* the functionality.

This is genuinely ambiguous. **Get it in writing from Procore before building deeply.** Unconfirmed whether these bind custom apps or only Marketplace apps.

## 8. Validation gate - do this FIRST, and it needs no integration

The single cheapest test, available today with zero Procore involvement:

**Have Maree manually export a set of drawings, specs and RFIs from her Procore project. Upload them to Soterra by hand. Show her the answers.**

If she does not find those answers valuable, the integration is moot and we have spent nothing. If she does, we know exactly what we are buying with the integration work (removing the manual step and keeping it current) and can price it.

Alongside that, confirm: does she keep live drawings in the **Drawings** tool or in **Files**? How often do revisions land? Who has Company Directory Admin rights? Would she pay, and what for?

## 9. ⚠️ Strategic reality check - Procore competes with us directly

Procore's own AI page describes **"Contextual Intelligence"** delivering _"grounded answers, not just search results"_ by interpreting project context **across specs, RFIs and submittals**, with **answers cited back to source documents**.

That is Soterra's plan-reader value proposition in Procore's own words. Their shipped product family: **Procore Copilot** (GA globally), **Procore Agents** (18+ job-specific, incl. RFIs and submittals), **Agent Studio**, **Procore Insights**, **Datagrid**.

So "Soterra is the intelligence layer on top of Procore" means competing with a native, bundled feature, inside their house, under terms that restrict bulk extraction. That is a hard fight for a solo founder.

**Where Soterra is actually defensible:**
1. **Firms not on Procore.** Most small and mid NZ builders do not pay for Procore. They have no AI over their plans at all. Cheapest sale, no gatekeeper, no terms risk.
2. **NZ building code.** We already hold the MBIE corpus in `code_pages`. An answer citing the client's drawing *and* the NZ code clause is something a US platform will not build for a market this size. This is the moat, not the integration.
3. **Cross-system.** The layer across Procore + email + WhatsApp + camera roll, rather than one vendor's silo.

**Recommendation:** demote Procore from "the flagship" to "a distribution option." Keep the NZ code layer as the product. Start org verification early anyway (free, and the unknown review timeline is the long pole, so starting the clock costs nothing), build against the free seeded sandbox to keep it real - but do not bet the roadmap on it.

## 10. Open questions

1. Review **timeline** for org verification / production credentials (no published SLA).
2. Any **fee** on the Private Developer path (not stated).
3. Do the AI-training / bulk-extraction clauses bind **custom apps** or only Marketplace?
4. Is `drawing_revisions` a subscribable webhook resource?
5. Exact per-revision PDF field naming across resource types.
6. Should we populate `plan_pages.code/title/disc` from Procore's clean sheet metadata (currently null)? Cheap citation-quality win.
