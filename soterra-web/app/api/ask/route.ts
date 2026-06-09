import Anthropic from "@anthropic-ai/sdk";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, asc, eq, gte, ilike, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, tasks } from "@/lib/schema";
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
let DF: Map<string, number> | null = null;
function getDf(index: Page[]): Map<string, number> {
  if (!DF) {
    DF = new Map();
    for (const p of index) {
      const seen = new Set(p.text.toLowerCase().match(/[a-z0-9-]{2,}/g) || []);
      for (const t of seen) DF.set(t, (DF.get(t) || 0) + 1);
    }
  }
  return DF;
}
function retrieve(index: Page[], q: string, k = 6): Page[] {
  const terms = expand(q);
  const df = getDf(index);
  const N = index.length;
  const idf = (t: string) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  const scored = index
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
function pageLabel(p: Page): string {
  const bits = [p.doc];
  if (p.code) bits.push(p.code);
  if (p.title) bits.push(p.title);
  return bits.join(" · ") + ` · page ${p.page} of ${p.npages}`;
}

// ── Card = a compact confirmation the client renders under the reply when the
//    assistant changes the calendar/tasks (so the user sees what landed). ──
type Card = {
  itemType: "event" | "task";
  action: "created" | "updated" | "deleted";
  title: string;
  when: string;
  sub: string;
  kind: string | null;
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
    visibility: visRaw === "private" ? "private" : "team",
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
        const top = retrieve(INDEX, q, 6);
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
          content: JSON.stringify({ ok: true, id: row.id, created: "event", title: row.title }),
          cards: [{ itemType: "event", action: "created", title: row.title, when: eventWhen(row.startsAt, row.endsAt, row.allDay), sub: [row.kind ? cap(row.kind) : null, visLabel(row.visibility), row.location].filter(Boolean).join(" · "), kind: row.kind }],
        };
      }

      case "create_task": {
        const vals = taskInsertFromInput(input, userId, creatorName);
        const [row] = await db.insert(tasks).values(vals).returning();
        return {
          content: JSON.stringify({ ok: true, id: row.id, created: "task", title: row.title }),
          cards: [{ itemType: "task", action: "created", title: row.title, when: taskWhen(row.dueAt, row.endsAt), sub: visLabel(row.visibility), kind: null }],
        };
      }

      case "create_events_bulk": {
        const items = Array.isArray(input.events) ? (input.events as Record<string, unknown>[]) : [];
        if (!items.length) return { content: JSON.stringify({ ok: false, error: "empty list" }), cards: [] };
        const rows = items.map((it) => eventInsertFromInput(it, userId, creatorName));
        const inserted = await db.insert(events).values(rows).returning();
        return {
          content: JSON.stringify({ ok: true, created: "events", count: inserted.length, ids: inserted.map((e) => e.id) }),
          cards: inserted.map((r) => ({ itemType: "event" as const, action: "created" as const, title: r.title, when: eventWhen(r.startsAt, r.endsAt, r.allDay), sub: [r.kind ? cap(r.kind) : null, visLabel(r.visibility), r.location].filter(Boolean).join(" · "), kind: r.kind })),
        };
      }

      case "create_tasks_bulk": {
        const items = Array.isArray(input.tasks) ? (input.tasks as Record<string, unknown>[]) : [];
        if (!items.length) return { content: JSON.stringify({ ok: false, error: "empty list" }), cards: [] };
        const rows = items.map((it) => taskInsertFromInput(it, userId, creatorName));
        const inserted = await db.insert(tasks).values(rows).returning();
        return {
          content: JSON.stringify({ ok: true, created: "tasks", count: inserted.length, ids: inserted.map((t) => t.id) }),
          cards: inserted.map((r) => ({ itemType: "task" as const, action: "created" as const, title: r.title, when: taskWhen(r.dueAt, r.endsAt), sub: visLabel(r.visibility), kind: null })),
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
        const [foundEvents, foundTasks] = await Promise.all([
          db.select().from(events).where(and(
            eq(events.projectId, PROJECT_ID),
            evVisible,
            query ? ilike(events.title, `%${query}%`) : undefined,
            dayStart ? gte(events.startsAt, dayStart) : undefined,
            dayEnd ? lt(events.startsAt, dayEnd) : undefined,
          )).orderBy(asc(events.startsAt)).limit(100),
          db.select().from(tasks).where(and(
            eq(tasks.projectId, PROJECT_ID),
            tkVisible,
            query ? ilike(tasks.title, `%${query}%`) : undefined,
            dayStart ? gte(tasks.dueAt, dayStart) : undefined,
            dayEnd ? lt(tasks.dueAt, dayEnd) : undefined,
          )).orderBy(asc(tasks.dueAt)).limit(100),
        ]);
        return {
          content: JSON.stringify({
            events: foundEvents.map((e) => ({ id: e.id, title: e.title, when: eventWhen(e.startsAt, e.endsAt, e.allDay), kind: e.kind, location: e.location, visibility: e.visibility })),
            tasks: foundTasks.map((t) => ({ id: t.id, title: t.title, when: taskWhen(t.dueAt, t.endsAt), done: t.done, visibility: t.visibility })),
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
        await db.update(events).set(fields).where(eq(events.id, id));
        const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
        return {
          content: JSON.stringify({ ok: true, message: "Event updated." }),
          cards: [{ itemType: "event", action: "updated", title: row.title, when: eventWhen(row.startsAt, row.endsAt, row.allDay), sub: [row.kind ? cap(row.kind) : null, visLabel(row.visibility), row.location].filter(Boolean).join(" · "), kind: row.kind }],
        };
      }

      case "update_task": {
        const id = s(input.id);
        if (!id) return { content: JSON.stringify({ ok: false, error: "id required" }), cards: [] };
        const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.projectId, PROJECT_ID))).limit(1);
        if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId)) {
          return { content: JSON.stringify({ ok: false, error: "not found" }), cards: [] };
        }
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
        await db.update(tasks).set(fields).where(eq(tasks.id, id));
        const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
        return {
          content: JSON.stringify({ ok: true, message: "Task updated." }),
          cards: [{ itemType: "task", action: "updated", title: row.title, when: taskWhen(row.dueAt, row.endsAt), sub: [row.done ? "done" : null, visLabel(row.visibility)].filter(Boolean).join(" · "), kind: null }],
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
        return { content: JSON.stringify({ ok: true, message: "Event deleted." }), cards: [{ itemType: "event", action: "deleted", title: existing.title, when: eventWhen(existing.startsAt, existing.endsAt, existing.allDay), sub: "removed", kind: existing.kind }] };
      }

      case "delete_task": {
        const id = s(input.id);
        if (!id) return { content: JSON.stringify({ ok: false, error: "id required" }), cards: [] };
        const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.projectId, PROJECT_ID))).limit(1);
        if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId)) {
          return { content: JSON.stringify({ ok: false, error: "not found" }), cards: [] };
        }
        await db.delete(tasks).where(eq(tasks.id, id));
        return { content: JSON.stringify({ ok: true, message: "Task deleted." }), cards: [{ itemType: "task", action: "deleted", title: existing.title, when: taskWhen(existing.dueAt, existing.endsAt), sub: "removed", kind: null }] };
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

const STATIC_PROMPT = `You are Soterra's site assistant for the construction project "${PROJECT_NAME}". You help the whole crew two ways:
1) PLAN-READER — answer questions about the project's drawings & specifications. For ANY such question (materials, dimensions, fire ratings, schedules, finishes, "what does the spec say…") you MUST call search_plans, then answer ONLY from the page text it returns, finishing with a line: "Source: <the exact page label>". Never invent codes, ratings, products or numbers. If the answer isn't in the pages, say what's missing and which drawing set might have it.
2) CALENDAR & TASKS — create, find, change and delete events and to-dos using the tools.

Talk like a sharp, helpful site engineer: warm, concise (1–4 sentences), plain English. State resolved dates explicitly ("Tuesday 16 June"), not just "Tuesday".

SAVE-FIRST: when the user wants to book an event (you have a title + date) or add a task (you have a title), call the create tool RIGHT AWAY. Do not ask about optional fields (time, location, type, visibility) before saving — save first, then you may offer to add detail.

VISIBILITY: site events (inspections, deliveries, pours, meetings) default to the whole crew (visibility 'team'). A personal to-do defaults to 'private' (just the creator). If it's genuinely unclear whether something is for the whole team or just the user, you may ask — but default sensibly rather than stalling.

TYPE is optional: set kind only when the type is obvious (a "GIB delivery" → delivery, "pre-line inspection" → inspection, "site meeting" → meeting, "slab pour" → pour). Leave it unset otherwise.

RELATIVE DATES & TIME ARITHMETIC: compute dates/times yourself from today's date, step by step in your head. NEVER show the calculation or any intermediate numbers in your reply — only the final result and what you did ("Booked the GIB delivery for Tuesday 16 June, 1:00pm ✅").

For "what's on / coming up" use the CONTEXT below if it's there, or call find_items for a specific search. To change or delete something, call find_items first to get its id (unless you already have the id from a create you just did).`;

type HistoryMsg = { role: "user" | "assistant"; text: string };

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  let question = "";
  let history: HistoryMsg[] = [];
  try {
    const body = await req.json();
    question = String(body.question ?? "").trim();
    if (Array.isArray(body.history)) {
      history = body.history
        .filter((m: unknown): m is HistoryMsg => !!m && typeof (m as HistoryMsg).text === "string")
        .slice(-12)
        .map((m: HistoryMsg) => ({ role: m.role === "assistant" ? "assistant" : "user", text: m.text }));
    }
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!question) return Response.json({ error: "Empty question" }, { status: 400 });

  const user = await currentUser();
  const creatorName =
    user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;

  const dynamicContext = await buildContext(userId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    ...history.map((m) => ({ role: m.role, content: m.text })),
    { role: "user", content: question },
  ];

  const allCards: Card[] = [];
  const anthropic = new Anthropic({ maxRetries: 3 });
  const MAX_ROUNDS = 8;

  try {
    let answer = "";
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        system: [
          { type: "text", text: STATIC_PROMPT, cache_control: { type: "ephemeral" } },
          { type: "text", text: dynamicContext },
        ] as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t)) as any,
        messages,
      });

      messages.push({ role: "assistant", content: resp.content });

      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (text) answer = text;

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

    return Response.json({ answer: answer || "Done.", cards: allCards });
  } catch (e) {
    console.error("assistant error:", e);
    const overloaded =
      e instanceof Anthropic.APIConnectionError ||
      (e instanceof Anthropic.APIError && (e.status === 429 || e.status === 529 || (e.status ?? 0) >= 500));
    return Response.json(
      { error: overloaded ? "The assistant is busy — give it a moment and try again." : "Something went wrong — try again." },
      { status: 503 }
    );
  }
}
