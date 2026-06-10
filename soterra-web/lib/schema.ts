import { pgTable, text, timestamp, boolean, uuid, index } from "drizzle-orm/pg-core";

// ─── Calendar events: the shared site schedule (inspections, deliveries, pours)
//     and personal ones. Scoped to a project; owned by a creator; visible to the
//     whole team or just the creator. Ported/adapted from the Montázs calendar. ───
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
    // Optional event type — null = untyped (no tag shown). When set, one of:
    // inspection | delivery | pour | meeting | reminder | other. Nullable so the
    // type can be left blank (Adam: "make it optional"); kept as free text so new
    // types can be added without a migration.
    kind: text("kind"),
    visibility: text("visibility").default("team").notNull(), // team | private
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byProject: index("events_project_idx").on(t.projectId) })
);

// ─── Tasks / to-dos (Teendők): personal by default, shareable to the team. ───
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byProject: index("tasks_project_idx").on(t.projectId) })
);

// ─── Assistant chat threads (saved conversations) + their messages. Threads are
//     PERSONAL (scoped to the Clerk user) within a project — your own chat
//     history, shown in the assistant sidebar. ───
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

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type ChatThread = typeof chatThreads.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
