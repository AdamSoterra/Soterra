import { pgTable, text, timestamp, boolean, uuid, index, integer, uniqueIndex, doublePrecision } from "drizzle-orm/pg-core";

// ─── Companies: the BUSINESS a site belongs to, and the boundary that pooled
//     failure history lives inside. Sites belong to a company; history and
//     insights are aggregated across a company's sites and NEVER across
//     companies. If one builder could see another's failure data the product is
//     over, so companyId is always derived server-side from the caller's
//     verified project membership (see lib/company.ts) — never from a header or
//     a request body. ───
export const companies = pgTable("companies", {
  id: text("id").primaryKey(), // app-generated uuid
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Sites (projects): the top-level container. A PM signs up, creates a site,
//     gets a join code; crew enter the code to join. Everything else (events,
//     tasks, threads, plans, usage) is scoped to a projectId. ───
export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(), // app-generated (uuid); the demo keeps "1-arthur-road"
    name: text("name").notNull(),
    code: text("code").notNull(), // invite/join code (XXXX-XXXX)
    // The owning business. Not null: a site with no company would have history
    // that belongs to nobody, and "belongs to nobody" is how it leaks.
    companyId: text("company_id").notNull(),
    creatorId: text("creator_id").notNull(), // Clerk userId of the admin/PM
    timezone: text("timezone").default("Pacific/Auckland").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byCode: uniqueIndex("projects_code_idx").on(t.code),
    byCompany: index("projects_company_idx").on(t.companyId),
  })
);

// ─── Site crew: one row per (site, user). Joining via code adds a member; the
//     creator is an admin. colorIndex drives colour-by-crew across the calendar. ───
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(), // Clerk userId
    name: text("name"), // the person's name, entered when they set up / join the site
    title: text("title"), // their job title, e.g. "Site Manager" — used for assigning by role
    role: text("role").default("member").notNull(), // admin | member (permission, not job title)
    colorIndex: integer("color_index").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byProject: index("project_members_project_idx").on(t.projectId),
    byUser: index("project_members_user_idx").on(t.userId),
    uniq: uniqueIndex("project_members_project_user_idx").on(t.projectId, t.userId),
  })
);

// ─── Calendar events: the shared site schedule (inspections, deliveries, pours)
//     and personal ones. Scoped to a project; owned by a creator; visible to the
//     whole team or just the creator; optionally assigned to a crew member. ───
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: text("project_id").notNull(),
    creatorId: text("creator_id").notNull(), // Clerk user id
    creatorName: text("creator_name"),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }), // optional end date/time
    allDay: boolean("all_day").default(false).notNull(),
    location: text("location"),
    // Optional event type — null = untyped. inspection|delivery|pour|meeting|reminder|other.
    kind: text("kind"),
    visibility: text("visibility").default("team").notNull(), // team | private
    // Optional assignee — the crew member responsible. Null = unassigned.
    assigneeId: text("assignee_id"), // Clerk user id of the assignee
    assigneeName: text("assignee_name"),
    // Optional per-item reminder. The assignee's phone schedules a native
    // LocalNotification for this instant (see /api/reminders/upcoming +
    // ReminderSync). Null = no reminder. Phone-side, so it fires offline and
    // only on the assignee's device.
    reminderAt: timestamp("reminder_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byProject: index("events_project_idx").on(t.projectId) })
);

// ─── Tasks / to-dos (Teendők): personal by default, shareable to the team,
//     assignable to a crew member. ───
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: text("project_id").notNull(),
    creatorId: text("creator_id").notNull(),
    creatorName: text("creator_name"),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }), // optional start/due date+time
    endsAt: timestamp("ends_at", { withTimezone: true }), // optional finish-by date+time
    done: boolean("done").default(false).notNull(),
    visibility: text("visibility").default("private").notNull(), // private | team
    assigneeId: text("assignee_id"), // Clerk user id of the assignee (null = unassigned)
    assigneeName: text("assignee_name"),
    // Optional per-item reminder — see events.reminderAt.
    reminderAt: timestamp("reminder_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byProject: index("tasks_project_idx").on(t.projectId) })
);

// ─── Assistant chat threads (saved conversations) + their messages. Threads are
//     PERSONAL (scoped to the Clerk user) within a project. ───
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: text("project_id").notNull(),
    creatorId: text("creator_id").notNull(), // Clerk user id
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byUser: index("chat_threads_user_idx").on(t.creatorId) })
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id").notNull(),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byThread: index("chat_messages_thread_idx").on(t.threadId) })
);

// ─── Per-project daily assistant usage counter — a race-safe runaway-cost cap. ───
export const usageCounters = pgTable(
  "usage_counters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: text("project_id").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD in the project timezone
    count: integer("count").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byProjectDay: uniqueIndex("usage_counters_project_day_idx").on(t.projectId, t.day) })
);

// ─── Free look-around trial: a per-user LIFETIME question counter (no company,
//     no project — these users have neither), and the leads the wall collects.
//     Kept deliberately outside the company boundary: a trial user has no
//     Scope, and nothing here ever joins onto company data. ───
export const trialUsage = pgTable("trial_usage", {
  userId: text("user_id").primaryKey(),
  count: integer("count").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id"),
    email: text("email").notNull(),
    name: text("name"),
    company: text("company"),
    source: text("source").default("trial_wall").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byUser: uniqueIndex("leads_user_idx").on(t.userId) })
);

// ─── Extracted plan/spec pages — the per-project searchable index built from
//     uploaded PDFs (files live in Vercel Blob; only text + metadata land here). ───
export const planPages = pgTable(
  "plan_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: text("project_id").notNull(),
    doc: text("doc").notNull(), // document display name (e.g. the filename)
    // Document class (lib/docType.ts: drawings / specs / reports / scopes /
    // other). Same value on every page of a doc. NULL = legacy/untyped, which
    // every reader treats as "drawings" — the exact pre-types behaviour.
    docType: text("doc_type"),
    file: text("file"), // Blob URL of the source PDF
    page: integer("page").notNull(),
    npages: integer("npages").notNull(),
    code: text("code"), // sheet code, best-effort (nullable)
    title: text("title"), // sheet title, best-effort (nullable)
    disc: text("disc"), // discipline, best-effort (nullable)
    text: text("text").notNull(), // extracted page text
    // Cached renders (populated lazily on first view, then reused so opening a
    // sheet is instant instead of re-rendering the PDF every time). imageUrl =
    // the full-res page; thumbUrl = a small render for the Plans preview grid.
    // Both are private Blob pathnames; null = not rendered yet.
    imageUrl: text("image_url"),
    thumbUrl: text("thumb_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byProject: index("plan_pages_project_idx").on(t.projectId) })
);

// ─── Building Code corpus — the SHARED (universal, not per-project) knowledge
//     base: extracted text from the free MBIE Acceptable Solutions / Verification
//     Methods / Handbook / guidance. The assistant's search_code runs over this. ───
export const codePages = pgTable(
  "code_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doc: text("doc").notNull(), // readable title (e.g. "E2 External Moisture — AS1")
    file: text("file").notNull(), // source pdf filename
    page: integer("page").notNull(),
    npages: integer("npages").notNull(),
    title: text("title"),
    text: text("text").notNull(),
    /** Private Blob pathname of a pre-rendered PNG of this page, so a Code
     *  citation can be opened like a manufacturer or determination one. Null
     *  means we have no image and the chip links out to building.govt.nz
     *  instead, which is the behaviour every Code citation had before. */
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// ─── Manufacturer literature. Deliberately NOT in code_pages, even though the
// shape is nearly identical, because the two carry different obligations. The
// Code corpus is Crown material under CC BY 4.0 — free to anyone, forever.
// Manufacturer literature is used under a permission we asked for in writing,
// and that permission comes with promises we made in the email:
//
//   1. only a short extract is ever reproduced  → excerpt() at answer time
//   2. every answer names the document and page → manufacturerLabel()
//   3. every answer links the CURRENT document  → sourceUrl, per document
//   4. never reproduce third-party material     → enforced at INGEST time,
//      by dropping those pages entirely, so a BRANZ appraisal page simply
//      isn't in the table to retrieve. A prompt instruction could be argued
//      around; a missing row cannot.
//
// `licence` is what makes a withdrawal survivable: a manufacturer who says no,
// or later changes their mind, is switched off with one UPDATE rather than a
// migration and a redeploy.
// ─── MBIE determinations (CC BY 4.0) — how the Building Code was actually
//     applied when someone argued about it. Kept OUT of code_pages on purpose:
//     code_pages is loaded whole into memory per warm server, and a
//     determination decides one case on its own facts, so it is guidance about
//     the Code and never the rule itself. Searched via Postgres full-text
//     (the `tsv` generated column, created in dev/migrate-determinations.mjs). ───
export const determinationPages = pgTable(
  "determination_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ref: text("ref").notNull(), // "2024/001" — always cited WITH the year, so currency is visible
    year: integer("year").notNull(),
    subject: text("subject"), // the "Regarding …" line off page 1
    file: text("file").notNull(),
    page: integer("page").notNull(),
    npages: integer("npages").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byRef: index("determination_pages_ref_idx").on(t.ref),
    byYear: index("determination_pages_year_idx").on(t.year),
  })
);

export const manufacturerPages = pgTable(
  "manufacturer_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    manufacturer: text("manufacturer").notNull(), // "GIB" — the brand as a builder says it
    doc: text("doc").notNull(), // readable title, e.g. "GIB Site Guide 2024"
    file: text("file").notNull(), // source pdf filename
    page: integer("page").notNull(),
    npages: integer("npages").notNull(),
    title: text("title"),
    text: text("text").notNull(),
    /** The live document on the manufacturer's own site, shown with every answer. */
    sourceUrl: text("source_url"),
    /** Private Blob pathname of a pre-rendered PNG of this page, for documents
     *  whose PDFs reference fonts they don't embed (e.g. Resene's data sheets):
     *  those render blank on Vercel's Linux serverless runtime, so we render
     *  them once locally and serve the stored image. Null = render live. */
    imageUrl: text("image_url"),
    /** granted | pending | demo | withdrawn. Served set = SERVED_LICENCES in
     *  lib/manufacturerIndex.ts (granted, pending, demo). `demo` is a
     *  manufacturer's public pages held only to record a permission-seeking
     *  demo for them — promote or delete it, never let it linger. */
    licence: text("licence").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// ─── Inspection history — "The Brain", stripped back. One row per uploaded
//     inspection report, plus one row per FAILED item on it. We deliberately do
//     NOT store the passes: the product question is "what do we keep getting
//     pulled up on", and a million little pass rows only bury the answer.
//
//     companyId is denormalised onto both tables so every read can filter on it
//     directly, without having to remember to join through projects. ───
export const inspections = pgTable(
  "inspections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    doc: text("doc").notNull(), // display name (usually the filename, extension stripped)
    file: text("file"), // Blob pathname of the source PDF, when we kept it
    // council = an Auckland-Council-style statutory checklist (IPL/ICA/IF2…),
    // consultant = an engineer's / architect's site observation report.
    source: text("source").default("council").notNull(),
    inspectionCode: text("inspection_code"), // IPL, ICA, IF2… (council reports)
    inspectionType: text("inspection_type"), // readable: "Post-line", "Cavity wrap", "Fire"
    inspector: text("inspector"), // the ORGANISATION only (never a person — see anonymise())
    outcome: text("outcome").default("unknown").notNull(), // pass | partial | fail | unknown
    inspectedOn: text("inspected_on"), // YYYY-MM-DD, as printed on the report
    // Optional link back to the calendar event this inspection was booked as.
    eventId: uuid("event_id"),
    itemCount: integer("item_count").default(0).notNull(), // failed items extracted
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byCompany: index("inspections_company_idx").on(t.companyId),
    byProject: index("inspections_project_idx").on(t.projectId),
    // Re-uploading the same report replaces it rather than double-counting.
    uniqDoc: uniqueIndex("inspections_project_doc_idx").on(t.projectId, t.doc),
  })
);

export const inspectionItems = pgTable(
  "inspection_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    inspectionId: uuid("inspection_id").notNull(),
    category: text("category").notNull(), // one of CATEGORIES (lib/categories.ts)
    title: text("title").notNull(), // short label, e.g. "Passive fire stopping incomplete"
    detail: text("detail"), // the report's own wording
    location: text("location"), // "Level 2, unit 2/4" — when the report says
    inspectionCode: text("inspection_code"), // denormalised from the parent, for grouping
    inspectedOn: text("inspected_on"), // denormalised, for "last 12 months" filters
    // Feature 6: the extracted failed items are a live worklist, not just a
    // record. not_done | in_progress | done.
    workStatus: text("work_status").default("not_done").notNull(), // LEGACY track, kept for the worklist UI
    // And they can be emailed to the responsible sub (same rails as QA flags):
    sentTo: text("sent_to"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentStatus: text("sent_status"), // sent | recorded (see checklist_items)
    // ── Close-out loop (added by dev/migrate-qa-closeout). Same loop as qa_flags,
    //    PLUS the consultant leg: an item off a CONSULTANT report (parent
    //    inspections.source = 'consultant') runs open -> sent -> ready ->
    //    submitted -> closed, forwarded to the consultant to sign off. An item
    //    off a COUNCIL report runs the internal loop (no consultant), same as a
    //    flag. work_status above is the legacy worklist track; closeout_status
    //    is the loop's own (kept in step only at close: closed => work_status done).
    closeoutStatus: text("closeout_status").default("open").notNull(), // open | sent | ready | submitted | closed
    subToken: text("sub_token"), // secret in the sub's "Mark it fixed" link (partial unique idx in the migration)
    consultantToken: text("consultant_token"), // secret in the consultant's "Sign it off" link (partial unique idx)
    senderEmail: text("sender_email"), // whoever pressed Send - where the notices go
    // The consultant a defect is forwarded to. The parent inspection only keeps
    // the inspector ORG (anonymised), never a person or an address, so the MC
    // types these when forwarding and they live on the item.
    consultantName: text("consultant_name"),
    consultantEmail: text("consultant_email"),
    readyAt: timestamp("ready_at", { withTimezone: true }), // the sub marked it fixed
    submittedAt: timestamp("submitted_at", { withTimezone: true }), // forwarded to the consultant
    closedAt: timestamp("closed_at", { withTimezone: true }), // signed off (MC internal, or consultant)
    fixPhoto: text("fix_photo"), // Blob pathname of the sub's photo of the fix (private)
    subNote: text("sub_note"), // the sub's note when they marked it fixed
    reviewNote: text("review_note"), // the MC / consultant note on close or bounce-back
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byCompany: index("inspection_items_company_idx").on(t.companyId),
    byInspection: index("inspection_items_inspection_idx").on(t.inspectionId),
    byCompanyCategory: index("inspection_items_company_category_idx").on(t.companyId, t.category),
  })
);

// ─── Checklists — an inspection IS a calendar event, so a checklist hangs off
//     one. The assistant generates the items from this site's drawings, the
//     Building Code and this company's own failure history; the crew ticks
//     them off on a phone with photos, and it stays on the event forever. ───
export const checklists = pgTable(
  "checklists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    eventId: uuid("event_id"), // the calendar event it belongs to (null = standalone)
    kind: text("kind").default("inspection").notNull(), // inspection | ccc
    title: text("title").notNull(),
    // What the checklist is FOR: an inspection code (ICA, IPL…) or a CCC pack.
    inspectionCode: text("inspection_code"),
    // WHERE it's scoped: a QA location label ("Unit 1", "Level 3", a user
    // zone). Null = whole job (and every checklist made before Feature 4).
    location: text("location"),
    status: text("status").default("open").notNull(), // open | done
    createdBy: text("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byCompany: index("checklists_company_idx").on(t.companyId),
    byProject: index("checklists_project_idx").on(t.projectId),
    byEvent: index("checklists_event_idx").on(t.eventId),
  })
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    checklistId: uuid("checklist_id").notNull(),
    ord: integer("ord").default(0).notNull(),
    category: text("category"),
    title: text("title").notNull(),
    detail: text("detail"), // what "good" looks like / the figure to check
    // Where the item came from, and the citation that backs it. An item with no
    // source is a guess, and a guess on a checklist is worse than no item.
    source: text("source").default("manual").notNull(), // plans | code | history | ccc | manual
    sourceRef: text("source_ref"), // the exact page label / determination / count
    // Only set on a programme critique (checklists.kind = 'programme'): which of
    // the four flag types this finding is, and how serious. Null on every
    // normal QA item.
    findingType: text("finding_type"), // missing_scope | out_of_sequence | unrealistic_duration | missing_hold_point
    severity: text("severity"), // high | medium | low (programme critique only)
    status: text("status").default("pending").notNull(), // pending | ok | issue | na
    note: text("note"),
    // Feature 4: set when this item's fix was emailed to a sub — the "sent and
    // recorded" state the checklist shows. Cleared never; resend updates it.
    sentTo: text("sent_to"), // the sub's name at send time
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // "sent" = the provider accepted it. "recorded" = composed + logged but
    // NOT transmitted (record-only mode). The UI must never show a recorded
    // send as a delivered one — that distinction is this column.
    sentStatus: text("sent_status"),
    checkedBy: text("checked_by"),
    checkedByName: text("checked_by_name"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byChecklist: index("checklist_items_checklist_idx").on(t.checklistId),
    byCompany: index("checklist_items_company_idx").on(t.companyId),
  })
);

// Site photos attached to a checklist item. Kept in their own table because one
// item routinely needs three or four shots (the junction, the label, the wide).
export const checklistPhotos = pgTable(
  "checklist_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    checklistId: uuid("checklist_id").notNull(),
    itemId: uuid("item_id").notNull(),
    url: text("url").notNull(), // Blob pathname (private — served through /api/checklists/photo)
    caption: text("caption"),
    takenBy: text("taken_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byItem: index("checklist_photos_item_idx").on(t.itemId),
    byChecklist: index("checklist_photos_checklist_idx").on(t.checklistId),
  })
);

// ─── Outbound email log — every email Soterra sends, recorded BEFORE it is
//     transmitted. The row is the product's memory of the send: the RFI
//     analytics, the QA record and the EOT evidence pack all read this table,
//     never the provider. status tells the story:
//       recorded → composed + stored, not transmitted (no RESEND_API_KEY yet,
//                  or record-only mode) — flips to real sending the moment the
//                  key exists, with zero data difference
//       sent     → accepted by Resend; providerId holds their message id
//       failed   → provider rejected it; error says why (the record remains)
//     One email can carry several records (three flags to the same sub), so
//     recordIds is a JSON array. ───
export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    kind: text("kind").notNull(), // qa_flags | rfi | inspection_items | test
    recordType: text("record_type"), // qa_flag | rfi | inspection_item
    recordIds: text("record_ids"), // JSON array of record ids this email carries
    toName: text("to_name"),
    toEmail: text("to_email").notNull(),
    cc: text("cc"), // JSON array of cc emails
    fromEmail: text("from_email").notNull(), // e.g. kauri-tower@send.soterra.co.nz
    replyTo: text("reply_to"), // the sender's real inbox — replies skip Soterra
    subject: text("subject").notNull(),
    html: text("html").notNull(), // the exact body sent — the evidentiary record
    // JSON array of {filename, bytes} — what evidence rode along (photos, the
    // pinned drawing snapshot). Content lives with the send, not the log.
    attachments: text("attachments"),
    status: text("status").default("recorded").notNull(), // recorded | sent | failed
    providerId: text("provider_id"), // Resend message id (for reply threading later)
    error: text("error"),
    sentBy: text("sent_by"), // Clerk user id of who pressed Send
    sentByName: text("sent_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => ({
    byProject: index("email_log_project_idx").on(t.projectId),
    byCompany: index("email_log_company_idx").on(t.companyId),
  })
);

// ─── Subcontractor contacts (Feature 4+): who a flag / failed item gets
//     emailed to. COMPANY-scoped, not project-scoped — a builder's supply
//     chain follows them from site to site. trade uses the same CATEGORIES
//     vocabulary as checklist/inspection items, so the right sub is
//     auto-suggested for an item by its category. ───
export const subs = pgTable(
  "subs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    name: text("name").notNull(), // "Fire Protection Ltd"
    email: text("email").notNull(),
    trade: text("trade"), // one of CATEGORIES (nullable = general)
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byCompany: index("subs_company_idx").on(t.companyId) })
);

// The consultant directory — the other half of the address book. Company-wide
// like subs: an engineer answers RFIs across every site the builder runs.
// Saved automatically on every RFI send (upsert by email) and editable in the
// Directory screen, so details are typed once, ever.
export const consultants = pgTable(
  "consultants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    name: text("name"), // the person: "Jane Smith"
    company: text("company"), // the firm: "Holmes Structural"
    discipline: text("discipline"), // one of DISCIPLINES (nullable = general)
    // Stored LOWERCASED by every writer - the unique index below is what makes
    // the directory's "saved once, ever" true, and it needs case to never vary.
    email: text("email").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byCompany: index("consultants_company_idx").on(t.companyId),
    oncePerCompany: uniqueIndex("consultants_company_email_uq").on(t.companyId, t.email),
  })
);

// ─── Location cache — Foundation 3. One row per project: the QA-scope
//     locations extracted from its drawing titles, keyed on a fingerprint of
//     those titles so the picker is a table read, never a model round-trip.
//     userZones holds zones people typed in themselves; on a label clash the
//     user's zone wins over the extracted one. Extraction re-runs only when
//     the fingerprint stops matching (plans added/removed). ───
export const projectLocations = pgTable("project_locations", {
  projectId: text("project_id").primaryKey(),
  fingerprint: text("fingerprint").notNull(), // sha1 of the sorted titles extraction ran on
  locations: text("locations").notNull(), // JSON QaLocation[] — the extracted set
  userZones: text("user_zones"), // JSON QaLocation[] — user-added, survives re-extraction
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Plan pins — Foundation 2. An x,y marker on one page of one uploaded
//     drawing, tied to the record it annotates (a QA flag, an RFI, or a
//     checklist item). x/y are % of the sheet (0-100), so they hold at any
//     zoom and any render size. The sheet is addressed the way the whole app
//     addresses sheets: projectId + doc title + page. A revised sheet uploads
//     as its own doc (lib/sheetRev.ts), so pins stay with the revision they
//     were dropped on — which is exactly what an evidentiary record wants. ───
export const planPins = pgTable(
  "plan_pins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    doc: text("doc").notNull(), // plan_pages.doc of the sheet pinned on
    page: integer("page").notNull(),
    x: doublePrecision("x").notNull(), // % of sheet width, 0-100
    y: doublePrecision("y").notNull(), // % of sheet height, 0-100
    recordType: text("record_type").notNull(), // qa_flag | rfi | checklist_item
    recordId: text("record_id").notNull(),
    label: text("label"), // short marker text, e.g. "1" or "RFI-014"
    createdBy: text("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    bySheet: index("plan_pins_sheet_idx").on(t.projectId, t.doc, t.page),
    byRecord: index("plan_pins_record_idx").on(t.recordType, t.recordId),
    byCompany: index("plan_pins_company_idx").on(t.companyId),
  })
);

// ─── QA flags — Feature 7 (the light sibling of an RFI). Pin a mistake on a
//     drawing, note it, email the sub, record it. n is the flag's number ON
//     ITS SHEET (what the pin displays); the pin itself lives on plan_pins
//     with recordType "qa_flag". ───
export const qaFlags = pgTable(
  "qa_flags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    doc: text("doc").notNull(),
    page: integer("page").notNull(),
    n: integer("n").notNull(), // display number on this sheet
    title: text("title").notNull(),
    trade: text("trade"), // CATEGORIES vocabulary
    note: text("note"),
    status: text("status").default("open").notNull(), // open | sent | done  (LEGACY track, kept for the existing sheet UI)
    subName: text("sub_name"), // who it's assigned/sent to
    subEmail: text("sub_email"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentStatus: text("sent_status"), // sent | recorded
    fixedAt: timestamp("fixed_at", { withTimezone: true }),
    // ── Close-out loop (added by dev/migrate-qa-closeout). A qa_flag is an
    //    INTERNAL defect, so its loop never reaches a consultant: it runs
    //    open -> sent -> ready -> closed, and the MC closes it directly. The
    //    legacy status column above is left for the sheet screens; closeout_status
    //    is the loop's own track (kept in step only at close: closed => done).
    closeoutStatus: text("closeout_status").default("open").notNull(), // open | sent | ready | closed
    subToken: text("sub_token"), // secret in the sub's "Mark it fixed" link (partial unique idx in the migration)
    senderEmail: text("sender_email"), // whoever pressed Send - where the "marked fixed" notice goes
    readyAt: timestamp("ready_at", { withTimezone: true }), // the sub marked it fixed
    closedAt: timestamp("closed_at", { withTimezone: true }), // the MC signed it off
    fixPhoto: text("fix_photo"), // Blob pathname of the sub's photo of the fix (private)
    subNote: text("sub_note"), // the sub's note when they marked it fixed
    reviewNote: text("review_note"), // the MC's note on close or bounce-back
    createdBy: text("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    bySheet: index("qa_flags_sheet_idx").on(t.projectId, t.doc, t.page),
    byCompany: index("qa_flags_company_idx").on(t.companyId),
  })
);

// ─── RFIs — Feature 5 (design: RFI-BUILD-SPEC.md + rfi-mock.html). The whole
//     conversation lives here; Soterra sends the email; the analytics read
//     ONLY these tables (never the provider). Project-scoped like everything
//     else; the consultant fields are plain text + email because consultants
//     don't hold Soterra accounts — accountability keys off consultantCompany. ───
export const rfis = pgTable(
  "rfis",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    // Register number, assigned ON SEND (a draft burns nothing): "RFI-014".
    number: integer("number"),
    revision: integer("revision").default(0).notNull(),
    subject: text("subject").notNull(),
    discipline: text("discipline"), // Architectural | Structural | … (spec list)
    status: text("status").default("draft").notNull(), // draft | open | answered | closed | void
    // Who holds the ball: "consultant" | "us" | "client" | "none" — plus the
    // consultant's name when they do. Derived on every transition.
    ballParty: text("ball_party").default("us").notNull(),
    priority: text("priority").default("normal").notNull(), // normal | high | critical
    location: text("location"),
    question: text("question").notNull(),
    proposedSolution: text("proposed_solution"),
    codeRefs: text("code_refs"), // JSON array of strings ("NZS 3604 cl 8.6")
    attachments: text("attachments"), // JSON array of {filename} listed on the RFI
    costImpact: text("cost_impact").default("unknown").notNull(), // none | unknown | yes
    costEstimate: text("cost_estimate"),
    programmeImpact: text("programme_impact").default("unknown").notNull(), // none | unknown | yes
    programmeDays: integer("programme_days"),
    criticalPath: boolean("critical_path").default(false).notNull(),
    raisedBy: text("raised_by"), // Clerk user id
    raisedByName: text("raised_by_name"),
    consultantName: text("consultant_name"), // the person: "Jane Smith"
    consultantCompany: text("consultant_company"), // the accountability key: "Holmes Structural"
    consultantEmail: text("consultant_email"),
    cc: text("cc"), // JSON array of emails
    dateRaised: timestamp("date_raised", { withTimezone: true }), // set on send
    dateRequiredBy: timestamp("date_required_by", { withTimezone: true }),
    dateAnswered: timestamp("date_answered", { withTimezone: true }),
    dateClosed: timestamp("date_closed", { withTimezone: true }),
    resultingCiId: uuid("resulting_ci_id"),
    emailLogId: uuid("email_log_id"), // the outbound send record (Foundation 1)
    // The secret in the consultant's "Answer this RFI online" link. Minted on
    // send; holding it proves you were sent THIS RFI, which is what authorises
    // the public answer page (no account, no login). NEVER send this field to
    // the browser - lib/rfi.ts publicRfi() strips it from every payload.
    // In prod it carries a PARTIAL unique index (rfis_answer_token_idx,
    // WHERE answer_token IS NOT NULL) created by dev/migrate-rfi-answer-token
    // - partial indexes aren't declarable here, so the migration is the truth.
    answerToken: text("answer_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byProject: index("rfis_project_idx").on(t.projectId),
    byCompany: index("rfis_company_idx").on(t.companyId),
    byNumber: index("rfis_project_number_idx").on(t.projectId, t.number),
  })
);

// The thread: the original question, ONE official answer, follow-ups, and
// system lines (sent / status changed). Immutable once written.
export const rfiMessages = pgTable(
  "rfi_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    rfiId: uuid("rfi_id").notNull(),
    type: text("type").notNull(), // question | official_answer | followup | system
    authorSide: text("author_side").default("contractor").notNull(), // contractor | consultant | client
    authorName: text("author_name"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byRfi: index("rfi_messages_rfi_idx").on(t.rfiId) })
);

// The immutable audit — the evidentiary core the EOT pack stands on. One row
// per transition, including the ball hand-off, so "who held it, when, for how
// long" is provable line by line.
export const rfiTransitions = pgTable(
  "rfi_transitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    rfiId: uuid("rfi_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    ballFrom: text("ball_from"),
    ballTo: text("ball_to"),
    byUser: text("by_user"),
    byName: text("by_name"),
    comment: text("comment"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byRfi: index("rfi_transitions_rfi_idx").on(t.rfiId) })
);

// Contract instructions spawned from an answered RFI. The link that lets the
// assistant treat the CI as governing the drawing it amends.
export const contractInstructions = pgTable(
  "contract_instructions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(), // CI-001, its own sequence per project
    title: text("title").notNull(),
    sourceRfiId: uuid("source_rfi_id"),
    amendsDrawings: text("amends_drawings"), // JSON array of {doc, fromRev, toRev}
    cost: text("cost"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byProject: index("cis_project_idx").on(t.projectId) })
);

export type Company = typeof companies.$inferSelect;
export type Inspection = typeof inspections.$inferSelect;
export type InspectionItem = typeof inspectionItems.$inferSelect;
export type Checklist = typeof checklists.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type ChecklistPhoto = typeof checklistPhotos.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type ChatThread = typeof chatThreads.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type CodePage = typeof codePages.$inferSelect;
export type EmailLog = typeof emailLog.$inferSelect;
export type PlanPin = typeof planPins.$inferSelect;
export type Rfi = typeof rfis.$inferSelect;
export type QaFlag = typeof qaFlags.$inferSelect;
export type RfiMessage = typeof rfiMessages.$inferSelect;
export type RfiTransition = typeof rfiTransitions.$inferSelect;
export type ContractInstruction = typeof contractInstructions.$inferSelect;
