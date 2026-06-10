import Anthropic from "@anthropic-ai/sdk";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, asc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, tasks, chatThreads, chatMessages, usageCounters, planPages } from "@/lib/schema";
import {
  PROJECT_TZ,
  zonedWallClockToUtc,
  resolveEndsAt,
  zonedDayKey,
  addOneDay,
} from "@/lib/date-tz";
import indexData from "@/data/arthur-road-index.json";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROJECT_ID = "1-arthur-road";
const PROJECT_NAME = "1 Arthur Road";
const MODEL = "claude-sonnet-4-6";
// Generous per-project daily assistant cap — invisible in normal site use, a
// backstop against a runaway/abusive/compromised account racking up Claude cost.
const DAILY_LIMIT = 300;
const KINDS = ["inspection", "delivery", "pour", "meeting", "reminder", "other"] as const;
type Kind = (typeof KINDS)[number];

// ── The project's plan/spec text index (one row per page). search_plans
//    retrieves over this. (Ported from the prototype; per-project in prod.) ──
type Page = {
  doc: string; disc: string; file: string; page: number; npages: number;
  code: string; title: string; text: string;
};
const INDEX = indexData as unknown as Page[];

// ── Retrieval: TF-IDF over the extracted text. idf kills the title-block
//    boilerplate on every sheet; synonyms map plain English to plan terms. ──
const SYN: Record<string, string[]> = {
  colour: ["color", "paint", "finish", "resene", "dulux", "schedule"],
  color: ["colour", "paint", "finish", "resene", "dulux", "schedule"],
  paint: ["colour", "resene", "dulux", "finish"],
  fire: ["frr", "fire-rated", "rated", "fhr"],
  rating: ["frr", "fire", "rated"],
  beam: ["lintel", "lvl", "span", "portal", "header", "steel"],
  lintel: ["beam", "lvl", "span", "header"],
  garage: ["carport", "basement", "ground"],
  wall: ["partition", "gib", "plasterboard", "lining", "intertenancy"],
  insulation: ["r-value", "thermal", "batts", "pink"],
  window: ["glazing", "glazed", "joinery"],
  corridor: ["lobby", "circulation", "common"],
};
function expand(q: string): string[] {
  const terms = (q.toLowerCase().match(/[a-z0-9-]+/g) || []).filter((t) => t.length > 1);
  const out = new Set(terms);
  for (const t of terms) for (const s of SYN[t] || []) out.add(s);
  return [...out];
}
function computeDf(pages: Page[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set(p.text.toLowerCase().match(/[a-z0-9-]{2,}/g) || []);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}
function retrieve(pages: Page[], df: Map<string, number>, q: string, k = 6): Page[] {
  const terms = expand(q);
  const N = pages.length || 1;
  const idf = (t: string) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  const scored = pages
    .map((p) => {
      const low = p.text.toLowerCase();
      let s = 0;
      for (const t of terms) {
        const c = (low.match(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")) || []).length;
        if (c) s += (1 + Math.log(c)) * idf(t);
      }
      return { s, p };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => x.p);
}

// The project's plan index: pages uploaded via the Upload tab (Neon plan_pages)
// plus the bundled demo set for the demo project so it stays whole. Loaded per
// call so a fresh upload shows up immediately (N is small; demo is in-memory).
async function getProjectIndex(projectId: string): Promise<{ pages: Page[]; df: Map<string, number> }> {
  const rows = await db
    .select({
      doc: planPages.doc, file: planPages.file, page: planPages.page, npages: planPages.npages,
      code: planPages.code, title: planPages.title, disc: planPages.disc, text: planPages.text,
    })
    .from(planPages)
    .where(eq(planPages.projectId, projectId));
  let pages: Page[] = rows.map((r) => ({
    doc: r.doc, disc: r.disc ?? "", file: r.file ?? "", page: r.page, npages: r.npages,
    code: r.code ?? "", title: r.title ?? "", text: r.text,
  }));
  if (projectId === PROJECT_ID) pages = [...INDEX, ...pages]; // demo keeps its bundled set
  return { pages, df: computeDf(pages) };
}
function pageLabel(p: Page): string {
  const bits = [p.doc];
  if (p.code) bits.push(p.code);
  if (p.title) bits.push(p.title);
  return bits.join(" · ") + ` · page ${p.page} of ${p.npages}`;
}

// ── Card = a compact confirmation the client renders under the reply when the
//    assistant changes the calendar/tasks (so the user sees what landed). ──
type Card = {
  id: string;
  itemType: "event" | "task";
  action: "created" | "updated" | "deleted";
  title: string;
  when: string;
  sub: string;
  kind: string | null;
  visibility: "team" | "private";
};

const dayFmt = new Intl.DateTimeFormat("en-NZ", { timeZone: PROJECT_TZ, weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-NZ", { timeZone: PROJECT_TZ, hour: "numeric", minute: "2-digit", hour12: true });
const hm24 = new Intl.DateTimeFormat("en-GB", { timeZone: PROJECT_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const ymdFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: PROJECT_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

function eventWhen(startsAt: Date, endsAt: Date | null, allDay: boolean): string {
  const day = dayFmt.format(startsAt);
  if (allDay) return `${day} · all day`;
  const t = timeFmt.format(startsAt);
  if (endsAt) {
    if (zonedDayKey(startsAt) === zonedDayKey(endsAt)) return `${day} · ${t}–${timeFmt.format(endsAt)}`;
    return `${day} ${t} → ${dayFmt.format(endsAt)} ${timeFmt.format(endsAt)}`;
  }
  return `${day} · ${t}`;
}
function taskWhen(dueAt: Date | null, endsAt: Date | null): string {
  if (!dueAt) return "no due date";
  const day = dayFmt.format(dueAt);
  if (hm24.format(dueAt) === "00:00") return `due ${day}`;
  const t = timeFmt.format(dueAt);
  if (endsAt) return `due ${day} · ${t}–${timeFmt.format(endsAt)}`;
  return `due ${day} · ${t}`;
}
function visLabel(v: string): string {
  return v === "team" ? "whole crew" : "just you";
}

// ─── Tool definitions ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: { name: string; description: string; input_schema: any }[] = [
  {
    name: "search_plans",
    description:
      "Search this project's uploaded drawings & specifications and read the matching pages. You MUST call this for ANY question about the building, drawings, specs, materials, dimensions, fire ratings, schedules, finishes, etc. — you have NO other knowledge of the plans. After it returns, answer ONLY from the page text it gives you, and finish your reply with a line 'Source: <the exact page label>'. If the pages don't contain the answer, say what's missing — never invent codes, ratings, products or numbers.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look up, in plain English (e.g. 'exterior door fire rating', 'garage beam size')." },
      },
      required: ["query"],
    },
  },
  {
    name: "create_event",
    description:
      "Add an event to the site calendar (inspection, delivery, concrete pour, meeting, reminder…). SAVE-FIRST: as soon as you have a title + date, call this immediately — do NOT ask about optional fields (time, location, type) first. Compute relative dates ('next Tuesday') yourself from today's date. Site events default to the whole crew; a personal note defaults to just-you. Set `kind` only when the type is clear — it's optional.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title, e.g. 'GIB delivery — Block C'." },
        date: { type: "string", description: "YYYY-MM-DD (project local day)." },
        time: { type: "string", description: "HH:MM 24h start. Omit for an all-day event." },
        end_date: { type: "string", description: "YYYY-MM-DD end day. Only for multi-day events." },
        end_time: { type: "string", description: "HH:MM 24h finish. Only if the user gives a duration/end." },
        kind: { type: "string", enum: [...KINDS], description: "Optional type. Omit if unclear." },
        location: { type: "string", description: "Optional, e.g. 'Block C, Level 2'." },
        visibility: { type: "string", enum: ["team", "private"], description: "'team' (whole crew) or 'private' (just the creator). Default team for site events." },
      },
      required: ["title", "date"],
    },
  },
  {
    name: "create_task",
    description:
      "Add a to-do / task. SAVE-FIRST: as soon as you have a title, call this — don't interrogate for optional fields. Tasks default to private (just the creator) unless the user clearly wants the crew to see it. Use due_time for a finish-by time ('email the engineer by 2pm').",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD; omit if no deadline." },
        due_time: { type: "string", description: "HH:MM 24h deadline time (only if the user gave one)." },
        end_date: { type: "string", description: "YYYY-MM-DD finish day (only for multi-day)." },
        end_time: { type: "string", description: "HH:MM 24h finish time (only if a duration was given)." },
        visibility: { type: "string", enum: ["team", "private"], description: "Default 'private'." },
      },
      required: ["title"],
    },
  },
  {
    name: "find_items",
    description:
      "Find existing events and tasks — call this BEFORE update/delete to get the id, or to answer 'what's on / coming up'. Two filters, combinable: `query` (title text search) and `date` (a single day, or a range with `date_to`). For a whole day use `date` and omit `query`. At least one of query/date is required.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Title text to match. Omit to get everything on a date." },
        date: { type: "string", description: "YYYY-MM-DD. With date_to → a range; alone → one day." },
        date_to: { type: "string", description: "YYYY-MM-DD inclusive range end (only with date)." },
      },
    },
  },
  {
    name: "update_event",
    description:
      "Change an existing event. Call find_items first for the id. Pass only the fields you're changing. For end_time/location an empty string '' clears that field.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        date: { type: "string" },
        time: { type: "string" },
        end_date: { type: "string" },
        end_time: { type: "string" },
        kind: { type: "string" },
        location: { type: "string" },
        visibility: { type: "string", enum: ["team", "private"] },
      },
      required: ["id"],
    },
  },
  {
    name: "update_task",
    description:
      "Change an existing task, or tick it off (status:'done') / reopen it (status:'open'). Call find_items first for the id. Pass only changed fields.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        due_date: { type: "string" },
        due_time: { type: "string" },
        end_date: { type: "string" },
        end_time: { type: "string" },
        visibility: { type: "string", enum: ["team", "private"] },
        status: { type: "string", enum: ["open", "done"] },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_event",
    description: "Delete an event. Call find_items first for the id. If the user clearly wants it gone, just delete — don't ask again.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "delete_task",
    description: "Delete a task. Call find_items first for the id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "create_events_bulk",
    description:
      "Create several events in ONE call. Use when the user lists 3+ events or asks for a recurring pattern (e.g. 'a pre-pour inspection every Friday for 4 weeks') — compute every concrete date yourself and pass them all here, instead of many create_event calls.",
    input_schema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              date: { type: "string", description: "YYYY-MM-DD" },
              time: { type: "string" },
              end_date: { type: "string" },
              end_time: { type: "string" },
              kind: { type: "string", enum: [...KINDS] },
              location: { type: "string" },
              visibility: { type: "string", enum: ["team", "private"] },
            },
            required: ["title", "date"],
          },
        },
      },
      required: ["events"],
    },
  },
  {
    name: "create_tasks_bulk",
    description: "Create several tasks in ONE call (3+ tasks or a recurring pattern). Same as create_tasks but batched.",
    input_schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              due_date: { type: "string" },
              due_time: { type: "string" },
              end_date: { type: "string" },
              end_time: { type: "string" },
              visibility: { type: "string", enum: ["team", "private"] },
            },
            required: ["title"],
          },
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "update_events_bulk",
    description:
      "Change several events in ONE call. Call find_items FIRST to get the ids. Use for 'move all the H&S meetings to 2pm', 'push next week's inspections back a day'. Each item is an id plus only the fields you're changing.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              date: { type: "string" },
              time: { type: "string" },
              end_date: { type: "string" },
              end_time: { type: "string" },
              kind: { type: "string", enum: [...KINDS] },
              location: { type: "string" },
              visibility: { type: "string", enum: ["team", "private"] },
            },
            required: ["id"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "update_tasks_bulk",
    description: "Change several tasks in ONE call. Call find_items first for the ids. Use for 'tick off all of these', 'move all these deadlines to Friday'.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              due_date: { type: "string" },
              due_time: { type: "string" },
              end_date: { type: "string" },
              end_time: { type: "string" },
              visibility: { type: "string", enum: ["team", "private"] },
              status: { type: "string", enum: ["open", "done"] },
            },
            required: ["id"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "delete_events_bulk",
    description: "Delete several events in ONE call. Call find_items first for the ids. Use for 'cancel all the H&S meetings', 'clear next week'. Only on a clear request.",
    input_schema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
    },
  },
  {
    name: "delete_tasks_bulk",
    description: "Delete several tasks in ONE call. Call find_items first for the ids.",
    input_schema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
    },
  },
];

const s = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
};
const validKind = (v: unknown): Kind | null => (KINDS.includes(v as Kind) ? (v as Kind) : null);

// Read an event's existing date/time/end in project wall-clock — for partial updates.
function eventParts(row: typeof events.$inferSelect) {
  return {
    date: ymdFmt.format(row.startsAt),
    time: row.allDay ? null : hm24.format(row.startsAt),
    endDate: row.endsAt ? ymdFmt.format(row.endsAt) : null,
    endTime: row.endsAt ? hm24.format(row.endsAt) : null,
  };
}

// Build an event insert payload from tool input (shared by create + bulk).
function eventInsertFromInput(input: Record<string, unknown>, userId: string, creatorName: string | null) {
  const title = s(input.title)!;
  const date = s(input.date)!;
  const time = s(input.time);
  const startsAt = zonedWallClockToUtc(date, time);
  const endsAt = resolveEndsAt(date, time, s(input.end_date), s(input.end_time));
  const visRaw = s(input.visibility);
  return {
    projectId: PROJECT_ID,
    creatorId: userId,
    creatorName,
    title,
    startsAt,
    endsAt,
    allDay: !time,
    location: s(input.location),
    kind: validKind(input.kind),
    // Default to private — never auto-broadcast to the whole crew unless the
    // user clearly asked (the assistant passes 'team' explicitly when it sees a
    // crew/team/everyone cue). The user can flip to crew with one tap.
    visibility: visRaw === "team" ? "team" : "private",
  };
}
function taskInsertFromInput(input: Record<string, unknown>, userId: string, creatorName: string | null) {
  const title = s(input.title)!;
  const dueDate = s(input.due_date);
  const dueTime = s(input.due_time);
  const dueAt = dueDate ? zonedWallClockToUtc(dueDate, dueTime) : null;
  const endsAt = dueDate ? resolveEndsAt(dueDate, dueTime, s(input.end_date), s(input.end_time)) : null;
  const visRaw = s(input.visibility);
  return {
    projectId: PROJECT_ID,
    creatorId: userId,
    creatorName,
    title,
    dueAt,
    endsAt,
    visibility: visRaw === "team" ? "team" : "private",
  };
}

// Partial-update field computation, shared by the single + bulk update tools so
// "move this" and "move all of these" behave identically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeEventUpdateFields(existing: typeof events.$inferSelect, input: Record<string, unknown>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields: Record<string, any> = {};
  if (input.title !== undefined) fields.title = s(input.title) ?? existing.title;
  if (input.location !== undefined) fields.location = s(input.location);
  if (input.kind !== undefined) fields.kind = validKind(input.kind);
  if (input.visibility !== undefined) fields.visibility = input.visibility === "private" ? "private" : "team";
  const dateChanged = input.date !== undefined;
  const timeChanged = input.time !== undefined;
  const endChanged = input.end_date !== undefined || input.end_time !== undefined;
  if (dateChanged || timeChanged || endChanged) {
    const cur = eventParts(existing);
    const newDate = dateChanged ? s(input.date) ?? cur.date : cur.date;
    const newTime = timeChanged ? s(input.time) : cur.time;
    if (dateChanged || timeChanged) {
      fields.startsAt = zonedWallClockToUtc(newDate, newTime);
      fields.allDay = !newTime;
    }
    const newEndDate = input.end_date !== undefined ? s(input.end_date) : cur.endDate;
    const newEndTime = input.end_time !== undefined ? s(input.end_time) : cur.endTime;
    fields.endsAt = resolveEndsAt(newDate, newTime, newEndDate, newEndTime);
  }
  return fields;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeTaskUpdateFields(existing: typeof tasks.$inferSelect, input: Record<string, unknown>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields: Record<string, any> = {};
  if (input.title !== undefined) fields.title = s(input.title) ?? existing.title;
  if (input.visibility !== undefined) fields.visibility = input.visibility === "team" ? "team" : "private";
  if (input.status === "done") fields.done = true;
  if (input.status === "open") fields.done = false;
  const dateChanged = input.due_date !== undefined;
  const timeChanged = input.due_time !== undefined;
  const endChanged = input.end_date !== undefined || input.end_time !== undefined;
  if (dateChanged || timeChanged || endChanged) {
    const curDate = existing.dueAt ? ymdFmt.format(existing.dueAt) : null;
    const curTimeRaw = existing.dueAt ? hm24.format(existing.dueAt) : null;
    const curTime = curTimeRaw === "00:00" ? null : curTimeRaw;
    const curEndDate = existing.endsAt ? ymdFmt.format(existing.endsAt) : null;
    const curEndTime = existing.endsAt ? hm24.format(existing.endsAt) : null;
    const newDate = dateChanged ? s(input.due_date) : curDate;
    const newTime = timeChanged ? s(input.due_time) : curTime;
    if (dateChanged || timeChanged) fields.dueAt = newDate ? zonedWallClockToUtc(newDate, newTime) : null;
    const newEndDate = input.end_date !== undefined ? s(input.end_date) : curEndDate;
    const newEndTime = input.end_time !== undefined ? s(input.end_time) : curEndTime;
    fields.endsAt = newDate ? resolveEndsAt(newDate, newTime, newEndDate, newEndTime) : null;
  }
  return fields;
}

// Execute one tool. Returns the JSON string the model sees + any client cards.
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  creatorName: string | null
): Promise<{ content: string; cards: Card[] }> {
  const evVisible = or(eq(events.visibility, "team"), eq(events.creatorId, userId));
  const tkVisible = or(eq(tasks.visibility, "team"), eq(tasks.creatorId, userId));
  try {
    switch (name) {
      case "search_plans": {
        const q = s(input.query) ?? "";
        if (!q) return { content: JSON.stringify({ error: "query required" }), cards: [] };
        const { pages, df } = await getProjectIndex(PROJECT_ID);
        const top = retrieve(pages, df, q, 6);
        if (top.length === 0) {
          return { content: JSON.stringify({ pages: [], note: "Nothing matched in this project's uploaded plans." }), cards: [] };
        }
        return {
          content: JSON.stringify({
            pages: top.map((p) => ({ label: pageLabel(p), text: p.text.slice(0, 2800) })),
          }),
          cards: [],
        };
      }

      case "create_event": {
        const vals = eventInsertFromInput(input, userId, creatorName);
        const [row] = await db.insert(events).values(vals).returning();
        return {
          content: JSON.stringify({ ok: true, id: row.id, created: "event", title: row.title, visibility: row.visibility }),
          cards: [card("event", "created", row)],
        };
      }

      case "create_task": {
        const vals = taskInsertFromInput(input, userId, creatorName);
        const [row] = await db.insert(tasks).values(vals).returning();
        return {
          content: JSON.stringify({ ok: true, id: row.id, created: "task", title: row.title, visibility: row.visibility }),
          cards: [card("task", "created", row)],
        };
      }

      case "create_events_bulk": {
        const items = Array.isArray(input.events) ? (input.events as Record<string, unknown>[]) : [];
        if (!items.length) return { content: JSON.stringify({ ok: false, error: "empty list" }), cards: [] };
        const rows = items.map((it) => eventInsertFromInput(it, userId, creatorName));
        const inserted = await db.insert(events).values(rows).returning();
        return {
          content: JSON.stringify({ ok: true, created: "events", count: inserted.length, ids: inserted.map((e) => e.id) }),
          cards: inserted.map((r) => card("event", "created", r)),
        };
      }

      case "create_tasks_bulk": {
        const items = Array.isArray(input.tasks) ? (input.tasks as Record<string, unknown>[]) : [];
        if (!items.length) return { content: JSON.stringify({ ok: false, error: "empty list" }), cards: [] };
        const rows = items.map((it) => taskInsertFromInput(it, userId, creatorName));
        const inserted = await db.insert(tasks).values(rows).returning();
        return {
          content: JSON.stringify({ ok: true, created: "tasks", count: inserted.length, ids: inserted.map((t) => t.id) }),
          cards: inserted.map((r) => card("task", "created", r)),
        };
      }

      case "find_items": {
        const query = s(input.query);
        const date = s(input.date);
        const dateTo = s(input.date_to);
        if (!query && !date) {
          return { content: JSON.stringify({ error: "Provide query or date.", events: [], tasks: [] }), cards: [] };
        }
        const dayStart = date ? zonedWallClockToUtc(date, "00:00") : null;
        const dayEnd = date ? zonedWallClockToUtc(addOneDay(dateTo || date), "00:00") : null;
        const FIND_LIMIT = 100;
        // Build the WHERE once, reuse it for the 100-row fetch AND an exact count
        // so we can tell the user the real total instead of silently dropping
        // everything past 100 (the Montázs bug).
        const evWhere = and(
          eq(events.projectId, PROJECT_ID),
          evVisible,
          query ? ilike(events.title, `%${query}%`) : undefined,
          dayStart ? gte(events.startsAt, dayStart) : undefined,
          dayEnd ? lt(events.startsAt, dayEnd) : undefined,
        );
        const tkWhere = and(
          eq(tasks.projectId, PROJECT_ID),
          tkVisible,
          query ? ilike(tasks.title, `%${query}%`) : undefined,
          dayStart ? gte(tasks.dueAt, dayStart) : undefined,
          dayEnd ? lt(tasks.dueAt, dayEnd) : undefined,
        );
        const [foundEvents, foundTasks, evCount, tkCount] = await Promise.all([
          db.select().from(events).where(evWhere).orderBy(asc(events.startsAt)).limit(FIND_LIMIT),
          db.select().from(tasks).where(tkWhere).orderBy(asc(tasks.dueAt)).limit(FIND_LIMIT),
          db.select({ n: sql<number>`count(*)::int` }).from(events).where(evWhere),
          db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(tkWhere),
        ]);
        const eventsTotal = evCount[0]?.n ?? foundEvents.length;
        const tasksTotal = tkCount[0]?.n ?? foundTasks.length;
        return {
          content: JSON.stringify({
            events: foundEvents.map((e) => ({ id: e.id, title: e.title, when: eventWhen(e.startsAt, e.endsAt, e.allDay), kind: e.kind, location: e.location, visibility: e.visibility })),
            tasks: foundTasks.map((t) => ({ id: t.id, title: t.title, when: taskWhen(t.dueAt, t.endsAt), done: t.done, visibility: t.visibility })),
            events_total: eventsTotal,
            events_truncated: eventsTotal > FIND_LIMIT,
            tasks_total: tasksTotal,
            tasks_truncated: tasksTotal > FIND_LIMIT,
          }),
          cards: [],
        };
      }

      case "update_event": {
        const id = s(input.id);
        if (!id) return { content: JSON.stringify({ ok: false, error: "id required" }), cards: [] };
        const [existing] = await db.select().from(events).where(and(eq(events.id, id), eq(events.projectId, PROJECT_ID))).limit(1);
        if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId)) {
          return { content: JSON.stringify({ ok: false, error: "not found" }), cards: [] };
        }
        await db.update(events).set(computeEventUpdateFields(existing, input)).where(eq(events.id, id));
        const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
        return {
          content: JSON.stringify({ ok: true, message: "Event updated." }),
          cards: [card("event", "updated", row)],
        };
      }

      case "update_task": {
        const id = s(input.id);
        if (!id) return { content: JSON.stringify({ ok: false, error: "id required" }), cards: [] };
        const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.projectId, PROJECT_ID))).limit(1);
        if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId)) {
          return { content: JSON.stringify({ ok: false, error: "not found" }), cards: [] };
        }
        await db.update(tasks).set(computeTaskUpdateFields(existing, input)).where(eq(tasks.id, id));
        const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
        return {
          content: JSON.stringify({ ok: true, message: "Task updated." }),
          cards: [card("task", "updated", row)],
        };
      }

      case "delete_event": {
        const id = s(input.id);
        if (!id) return { content: JSON.stringify({ ok: false, error: "id required" }), cards: [] };
        const [existing] = await db.select().from(events).where(and(eq(events.id, id), eq(events.projectId, PROJECT_ID))).limit(1);
        if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId)) {
          return { content: JSON.stringify({ ok: false, error: "not found" }), cards: [] };
        }
        await db.delete(events).where(eq(events.id, id));
        return { content: JSON.stringify({ ok: true, message: "Event deleted." }), cards: [card("event", "deleted", existing)] };
      }

      case "delete_task": {
        const id = s(input.id);
        if (!id) return { content: JSON.stringify({ ok: false, error: "id required" }), cards: [] };
        const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.projectId, PROJECT_ID))).limit(1);
        if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId)) {
          return { content: JSON.stringify({ ok: false, error: "not found" }), cards: [] };
        }
        await db.delete(tasks).where(eq(tasks.id, id));
        return { content: JSON.stringify({ ok: true, message: "Task deleted." }), cards: [card("task", "deleted", existing)] };
      }

      // ─── Bulk update / delete — one round-trip for "move/cancel all of these".
      // One SELECT for all ids (scoped to project + visible-to-caller), then the
      // per-row updates run together. Delete is a single scoped statement.
      case "update_events_bulk": {
        const updates = Array.isArray(input.updates) ? (input.updates as Record<string, unknown>[]) : [];
        if (!updates.length) return { content: JSON.stringify({ ok: false, error: "empty updates" }), cards: [] };
        const ids = updates.map((u) => s(u.id)).filter((x): x is string => !!x);
        const rows = ids.length
          ? await db.select().from(events).where(and(eq(events.projectId, PROJECT_ID), inArray(events.id, ids), evVisible))
          : [];
        const byId = new Map(rows.map((e) => [e.id, e]));
        let updated = 0;
        await Promise.all(
          updates.map(async (u) => {
            const id = s(u.id);
            const existing = id ? byId.get(id) : undefined;
            if (!id || !existing) return;
            try {
              await db.update(events).set(computeEventUpdateFields(existing, u)).where(eq(events.id, id));
              updated++;
            } catch {
              /* skip the bad one, keep the rest */
            }
          })
        );
        return { content: JSON.stringify({ ok: true, updated, total: updates.length }), cards: [] };
      }

      case "update_tasks_bulk": {
        const updates = Array.isArray(input.updates) ? (input.updates as Record<string, unknown>[]) : [];
        if (!updates.length) return { content: JSON.stringify({ ok: false, error: "empty updates" }), cards: [] };
        const ids = updates.map((u) => s(u.id)).filter((x): x is string => !!x);
        const rows = ids.length
          ? await db.select().from(tasks).where(and(eq(tasks.projectId, PROJECT_ID), inArray(tasks.id, ids), tkVisible))
          : [];
        const byId = new Map(rows.map((t) => [t.id, t]));
        let updated = 0;
        await Promise.all(
          updates.map(async (u) => {
            const id = s(u.id);
            const existing = id ? byId.get(id) : undefined;
            if (!id || !existing) return;
            try {
              await db.update(tasks).set(computeTaskUpdateFields(existing, u)).where(eq(tasks.id, id));
              updated++;
            } catch {
              /* skip */
            }
          })
        );
        return { content: JSON.stringify({ ok: true, updated, total: updates.length }), cards: [] };
      }

      case "delete_events_bulk": {
        const ids = (Array.isArray(input.ids) ? input.ids : []).map((x) => s(x)).filter((x): x is string => !!x);
        if (!ids.length) return { content: JSON.stringify({ ok: false, error: "empty ids" }), cards: [] };
        const res = await db
          .delete(events)
          .where(and(eq(events.projectId, PROJECT_ID), inArray(events.id, ids), evVisible))
          .returning({ id: events.id });
        return { content: JSON.stringify({ ok: true, deleted: res.length, requested: ids.length }), cards: [] };
      }

      case "delete_tasks_bulk": {
        const ids = (Array.isArray(input.ids) ? input.ids : []).map((x) => s(x)).filter((x): x is string => !!x);
        if (!ids.length) return { content: JSON.stringify({ ok: false, error: "empty ids" }), cards: [] };
        const res = await db
          .delete(tasks)
          .where(and(eq(tasks.projectId, PROJECT_ID), inArray(tasks.id, ids), tkVisible))
          .returning({ id: tasks.id });
        return { content: JSON.stringify({ ok: true, deleted: res.length, requested: ids.length }), cards: [] };
      }

      default:
        return { content: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }), cards: [] };
    }
  } catch (err) {
    return { content: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "error" }), cards: [] };
  }
}

function cap(x: string): string {
  return x.charAt(0).toUpperCase() + x.slice(1);
}

// Build a confirmation Card (with id + visibility for the client's tick-box)
// from a freshly read DB row.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function card(itemType: "event" | "task", action: Card["action"], row: any): Card {
  if (itemType === "event") {
    return {
      id: row.id,
      itemType,
      action,
      title: row.title,
      when: eventWhen(row.startsAt, row.endsAt, row.allDay),
      sub: [row.kind ? cap(row.kind) : null, row.location].filter(Boolean).join(" · "),
      kind: row.kind ?? null,
      visibility: row.visibility,
    };
  }
  return {
    id: row.id,
    itemType,
    action,
    title: row.title,
    when: taskWhen(row.dueAt, row.endsAt),
    sub: row.done ? "done" : "",
    kind: null,
    visibility: row.visibility,
  };
}

// Build the dynamic context block: today + the project's upcoming events and
// open tasks the caller can see (team + their own private). Keeps the assistant
// grounded so "what's coming up?" works without a tool call.
async function buildContext(userId: string): Promise<string> {
  const now = new Date();
  const todayIso = ymdFmt.format(now);
  const nowHM = timeFmt.format(now);
  const yearAhead = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const [upcoming, openTasks] = await Promise.all([
    db.select().from(events).where(and(eq(events.projectId, PROJECT_ID), or(eq(events.visibility, "team"), eq(events.creatorId, userId)), gte(events.startsAt, new Date(now.getTime() - 12 * 3600 * 1000)), lt(events.startsAt, yearAhead))).orderBy(asc(events.startsAt)).limit(60),
    db.select().from(tasks).where(and(eq(tasks.projectId, PROJECT_ID), or(eq(tasks.visibility, "team"), eq(tasks.creatorId, userId)), eq(tasks.done, false))).orderBy(asc(tasks.dueAt)).limit(60),
  ]);
  const evList = upcoming.length
    ? upcoming.map((e) => `- ${eventWhen(e.startsAt, e.endsAt, e.allDay)} — ${e.title}${e.kind ? ` [${e.kind}]` : ""}${e.location ? ` @ ${e.location}` : ""} (${visLabel(e.visibility)})`).join("\n")
    : "(nothing booked)";
  const tkList = openTasks.length
    ? openTasks.map((t) => `- ${taskWhen(t.dueAt, t.endsAt)} — ${t.title} (${visLabel(t.visibility)})`).join("\n")
    : "(no open tasks)";
  return `CONTEXT (today: ${todayIso}, now: ${nowHM} ${PROJECT_TZ} time):

Project: ${PROJECT_NAME}

Upcoming events (next 12 months, that you can see):
${evList}

Open tasks:
${tkList}`;
}

const STATIC_PROMPT = `You are Soterra's site assistant for the construction project "${PROJECT_NAME}" — a sharp, experienced construction professional. You help the crew three ways:
1) PLAN-READER — answer questions about THIS project's drawings & specifications. For any question about the uploaded plans/specs (this project's materials, dimensions, fire ratings, schedules, finishes, "what does our spec say…") you MUST call search_plans, then answer ONLY from the page text it returns, finishing with a line: "Source: <the exact page label>". Never invent codes, ratings, products or numbers from the plans. If the answer isn't in the pages, say what's missing and which drawing set might have it.
2) CONSTRUCTION EXPERT — answer general construction questions from your own knowledge: methods, sequencing, materials, detailing, terminology, building-code awareness, health & safety, and best practice. This is general expertise, NOT from the user's plans, so do NOT add a "Source:" line for it. When current or specific detail matters (a specific code clause, the latest standard, a product spec, manufacturer data), use web_search to get it right rather than answering from memory.
   GUARDRAIL: when you give general or code-related guidance, make clear it's general advice; for code clauses or safety-critical numbers, tell them to confirm against the current standard or their engineer, and don't state a specific code number as fact unless web_search backs it up. Soterra's whole value is that it never bluffs.
3) CALENDAR & TASKS — create, find, change and delete events and to-dos using the tools.

If the user attaches a photo or PDF, read it and answer about it — and if it relates to this project's drawings or specs, you can still call search_plans to cross-check.

STAY ON CONSTRUCTION: cover anything construction/site/building-related broadly and generously. Politely decline genuinely unrelated topics (sport, politics, celebrities, general trivia) and steer back to the project.

Talk like a sharp, helpful site engineer: warm, concise (1–4 sentences), plain English. State resolved dates explicitly ("Tuesday 16 June"), not just "Tuesday".

SAVE-FIRST: when the user wants to book an event (you have a title + date) or add a task (you have a title), call the create tool RIGHT AWAY. Do not ask about optional fields (time, location, type, visibility) before saving — save first, then you may offer to add detail.

VISIBILITY — read the wording, do NOT assume from the event type:
- Always set the visibility field when creating an event or task.
- "my calendar", "for me", "I have", "remind me", "just me", "mine", "book me" → 'private' (just the creator) — even for an inspection or delivery.
- "the crew", "the team", "everyone", "all of us", "the lads", "site-wide", "put it on the team calendar", "tell everyone" → 'team' (whole crew).
- If NEITHER is signalled, default to 'private'. NEVER put something on the whole crew's calendar unless the user clearly asked. Don't ask about it — save it private and move on; the user can share it to the crew with one tap on the card.

TYPE is optional: set kind only when the type is obvious (a "GIB delivery" → delivery, "pre-line inspection" → inspection, "site meeting" → meeting, "slab pour" → pour). Leave it unset otherwise.

RELATIVE DATES & TIME ARITHMETIC: compute dates/times yourself from today's date, step by step in your head. NEVER show the calculation or any intermediate numbers in your reply — only the final result and what you did ("Booked the GIB delivery for Tuesday 16 June, 1:00pm ✅").

BULK / RECURRING — do it in ONE call, never one-by-one:
- 3+ items in one message, OR a recurring pattern ("an H&S meeting every Monday for the next 20 weeks", "weekly toolbox talk till August") → work out all the dates yourself and use create_events_bulk / create_tasks_bulk in a SINGLE call. NEVER fire 20 separate create_event calls.
- Changing many at once ("move every H&S meeting to 2pm", "push next week's inspections back a day") → call find_items first for the ids, then update_events_bulk / update_tasks_bulk in ONE call.
- Deleting many ("cancel all the H&S meetings", "clear next week") → find_items for the ids, then delete_events_bulk / delete_tasks_bulk in ONE call.
- 1–2 items: just use the single create/update/delete tools.
- After a bulk action, confirm with the COUNT ("Booked 20 H&S meetings — every Monday 9am ✅"). Don't list all 20 unless asked.

ID MEMORY — don't re-search what you just made: after a create_*_bulk the tool result already gave you every new id. If the user immediately tweaks or cancels those same items, reuse those ids in update_*_bulk / delete_*_bulk — do NOT call find_items again.

TRUNCATION: if find_items returns events_truncated or tasks_truncated = true, you only got the first 100 of events_total / tasks_total. Tell the user the real total and ask how to narrow it (a date range, a tighter search). Never act on just the 100, and never tell the user to do it by hand.

For "what's on / coming up" use the CONTEXT below if it's there, or call find_items for a specific search. To change or delete something, call find_items first to get its id (unless you already have the id from a create you just did).`;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  let question = "";
  let reqThreadId: string | null = null;
  let attachment: { kind: "image" | "pdf"; mediaType: string; data: string } | null = null;
  try {
    const body = await req.json();
    question = String(body.question ?? "").trim();
    if (typeof body.threadId === "string" && body.threadId) reqThreadId = body.threadId;
    if (body.attachment && typeof body.attachment === "object") {
      const a = body.attachment as Record<string, unknown>;
      const kind = a.kind === "pdf" ? "pdf" : a.kind === "image" ? "image" : null;
      const data = typeof a.data === "string" ? a.data : "";
      const mediaType = typeof a.mediaType === "string" ? a.mediaType : "";
      // Only forward media types Claude accepts — never pass untrusted strings through.
      const IMG = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      const okType = kind === "pdf" ? mediaType === "application/pdf" : IMG.includes(mediaType);
      if (kind && data && okType) attachment = { kind, mediaType, data };
    }
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!question) return Response.json({ error: "Empty question" }, { status: 400 });

  // Runaway-cost cap: atomically bump today's per-project counter (one statement,
  // race-safe) and reject once it exceeds the daily limit. Day = project tz.
  const today = zonedDayKey(new Date());
  const [usage] = await db
    .insert(usageCounters)
    .values({ projectId: PROJECT_ID, day: today, count: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.projectId, usageCounters.day],
      set: { count: sql`${usageCounters.count} + 1`, updatedAt: new Date() },
    })
    .returning({ count: usageCounters.count });
  if (usage && usage.count > DAILY_LIMIT) {
    return Response.json(
      { error: `You've reached today's assistant limit (${DAILY_LIMIT} messages on this project). It resets tomorrow.`, dailyLimited: true },
      { status: 429 }
    );
  }

  const user = await currentUser();
  const creatorName =
    user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;

  // Resolve (or create) the thread — personal to this user + project. An unknown
  // threadId (e.g. someone else's) falls through to a fresh thread.
  let threadId = reqThreadId;
  let threadNew = false;
  if (threadId) {
    const [existing] = await db
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(and(eq(chatThreads.id, threadId), eq(chatThreads.creatorId, userId)))
      .limit(1);
    if (!existing) threadId = null;
  }
  if (!threadId) {
    const [created] = await db
      .insert(chatThreads)
      .values({ projectId: PROJECT_ID, creatorId: userId, title: question.slice(0, 80) })
      .returning();
    threadId = created.id;
    threadNew = true;
  }

  // Persist the user message, then load the whole thread as the model's history.
  await db.insert(chatMessages).values({ threadId, role: "user", content: question });
  const historyRows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.createdAt));

  // Cap how much history we replay to the model so a long thread doesn't balloon
  // input tokens every turn. Keep the most recent N, and make sure the window
  // starts on a user turn (the current question is always the last row).
  const MODEL_HISTORY = 24;
  let recent = historyRows.slice(-MODEL_HISTORY);
  while (recent.length && recent[0].role === "assistant") recent = recent.slice(1);

  const dynamicContext = await buildContext(userId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = recent.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  // Attach the photo/PDF to the current (last) user turn so Claude can read it.
  // The attachment itself isn't persisted — it's a one-shot for this question.
  if (attachment && messages.length) {
    const block =
      attachment.kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: attachment.mediaType, data: attachment.data } }
        : { type: "image", source: { type: "base64", media_type: attachment.mediaType, data: attachment.data } };
    messages[messages.length - 1].content = [{ type: "text", text: question }, block];
  }

  const allCards: Card[] = [];
  const anthropic = new Anthropic({ maxRetries: 3 });
  const MAX_ROUNDS = 10;

  try {
    let answer = "";
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        // 8192 (not 4096): a bulk call serialises its whole array INTO the
        // model's output tokens — a 50-item create_events_bulk is ~2k tokens of
        // JSON, and a lower cap truncates the tool call mid-emit (the Montázs
        // "1 week worked, 2 weeks didn't" cliff).
        max_tokens: 8192,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        system: [
          { type: "text", text: STATIC_PROMPT, cache_control: { type: "ephemeral" } },
          { type: "text", text: dynamicContext },
        ] as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [
          ...TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t)),
          // Anthropic server-side web search → the assistant can pull current
          // info (latest codes, product specs, standards) past its training cutoff.
          { type: "web_search_20260209", name: "web_search", max_uses: 5 },
        ] as any,
        messages,
      });

      messages.push({ role: "assistant", content: resp.content });

      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (text) answer = text;

      // Server-side web_search hit its internal iteration limit mid-turn —
      // re-send (assistant content already appended) so the server resumes.
      if (resp.stop_reason === "pause_turn") continue;
      if (resp.stop_reason !== "tool_use") break;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolUses = (resp.content as any[]).filter((b) => b.type === "tool_use");
      const results = [];
      for (const tu of toolUses) {
        const { content, cards } = await executeTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, userId, creatorName);
        allCards.push(...cards);
        results.push({ type: "tool_result", tool_use_id: tu.id, content });
      }
      messages.push({ role: "user", content: results });
    }

    const finalAnswer = answer || "Done.";
    // Persist the assistant's reply and bump the thread so it sorts to the top.
    await db.insert(chatMessages).values({ threadId, role: "assistant", content: finalAnswer });
    await db.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, threadId));
    return Response.json({ answer: finalAnswer, cards: allCards, threadId, threadNew });
  } catch (e) {
    console.error("assistant error:", e);
    const overloaded =
      e instanceof Anthropic.APIConnectionError ||
      (e instanceof Anthropic.APIError && (e.status === 429 || e.status === 529 || (e.status ?? 0) >= 500));
    const msg = overloaded
      ? "The assistant is busy — give it a moment and try again."
      : "Something went wrong on that one — give it another go.";
    // Persist a placeholder reply so reopening the thread doesn't show a hanging
    // question, and the next turn doesn't replay an orphaned user message.
    try {
      await db.insert(chatMessages).values({ threadId, role: "assistant", content: msg });
      await db.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, threadId));
    } catch {
      /* best-effort — don't mask the original error */
    }
    return Response.json({ error: msg }, { status: 503 });
  }
}
