import { pgTable, text, timestamp, boolean, uuid, index, integer, uniqueIndex } from "drizzle-orm/pg-core";

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

// ─── Extracted plan/spec pages — the per-project searchable index built from
//     uploaded PDFs (files live in Vercel Blob; only text + metadata land here). ───
export const planPages = pgTable(
  "plan_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: text("project_id").notNull(),
    doc: text("doc").notNull(), // document display name (e.g. the filename)
    file: text("file"), // Blob URL of the source PDF
    page: integer("page").notNull(),
    npages: integer("npages").notNull(),
    code: text("code"), // sheet code, best-effort (nullable)
    title: text("title"), // sheet title, best-effort (nullable)
    disc: text("disc"), // discipline, best-effort (nullable)
    text: text("text").notNull(), // extracted page text
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
    status: text("status").default("pending").notNull(), // pending | ok | issue | na
    note: text("note"),
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
