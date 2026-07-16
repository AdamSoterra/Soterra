import { pgTable, text, timestamp, boolean, uuid, index, integer, uniqueIndex } from "drizzle-orm/pg-core";

// ─── Sites (projects): the top-level container. A PM signs up, creates a site,
//     gets a join code; crew enter the code to join. Everything else (events,
//     tasks, threads, plans, usage) is scoped to a projectId. ───
export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(), // app-generated (uuid); the demo keeps "1-arthur-road"
    name: text("name").notNull(),
    code: text("code").notNull(), // invite/join code (XXXX-XXXX)
    creatorId: text("creator_id").notNull(), // Clerk userId of the admin/PM
    timezone: text("timezone").default("Pacific/Auckland").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byCode: uniqueIndex("projects_code_idx").on(t.code) })
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

export type Project = typeof projects.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type ChatThread = typeof chatThreads.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type CodePage = typeof codePages.$inferSelect;
