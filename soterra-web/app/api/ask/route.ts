import Anthropic from "@anthropic-ai/sdk";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, asc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, tasks, chatThreads, chatMessages, usageCounters, planPages, codePages, projects } from "@/lib/schema";
import {
  PROJECT_TZ,
  zonedWallClockToUtc,
  resolveEndsAt,
  zonedDayKey,
  addOneDay,
} from "@/lib/date-tz";
import { resolveProjectId, listMembers } from "@/lib/project";
import { excerpt, expand, retrieve } from "@/lib/retrieve";
import { DEMO_ID, getProjectIndex, type Page } from "@/lib/projectIndex";
import { codeLabel, getCodeIndex } from "@/lib/codeIndex";
import { getManufacturerIndex, manufacturerLabel } from "@/lib/manufacturerIndex";
import { companyIdForProject, type Scope } from "@/lib/company";
import { searchHistory } from "@/lib/history";
import { orderForPrompt } from "@/lib/inspectionOrder";

export const runtime = "nodejs";
// 180, not 60: Montázs measured a ~50-item update_events_bulk streaming ~2000
// tokens of JSON and brushing the 60s cap. Bulk writes here are non-transactional
// Promise.all, so a timeout means partial writes with nothing surfaced to the
// user — the exact bulk failure mode we're trying to kill.
export const maxDuration = 180;

const MODEL = "claude-sonnet-4-6";
const DAILY_LIMIT = 300;
const KINDS = ["inspection", "delivery", "pour", "meeting", "reminder", "other"] as const;
type Kind = (typeof KINDS)[number];

type Member = { userId: string; name: string | null; title: string | null };

// ── Retrieval index shapes. Both plan pages and code pages carry `.text`, so the
//    TF-IDF retrieval below is generic over anything with text. ──

function pageLabel(p: Page): string {
  const bits = [p.doc];
  if (p.code) bits.push(p.code);
  if (p.title) bits.push(p.title);
  let label = bits.join(" · ") + ` · page ${p.page} of ${p.npages}`;
  if (p.uploadedAt) label += ` · uploaded ${ymdFmt.format(new Date(p.uploadedAt))}`;
  return label;
}

// The shared Building Code corpus now lives in lib/codeIndex.ts, so the
// checklist generator searches the same index rather than a second copy of it.

type Card = {
  id: string;
  itemType: "event" | "task";
  action: "created" | "updated" | "deleted";
  title: string;
  when: string;
  sub: string;
  kind: string | null;
  visibility: "team" | "private";
  assigneeName?: string | null;
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

// Resolve a plain-English assignee to a crew member — by NAME ("Jon") or by
// TITLE ("the site manager"). Exact → prefix → contains, name then title.
function resolveAssignee(input: Record<string, unknown>, members: Member[]): { assigneeId: string | null; assigneeName: string | null } {
  const q = s(input.assignee);
  if (!q) return { assigneeId: null, assigneeName: null };
  const low = q.toLowerCase();
  const nm = (x: Member) => (x.name || "").toLowerCase();
  const ti = (x: Member) => (x.title || "").toLowerCase();
  const m =
    members.find((x) => nm(x) === low || ti(x) === low) ||
    members.find((x) => nm(x).startsWith(low) || ti(x).startsWith(low)) ||
    members.find((x) => low.length >= 2 && (nm(x).includes(low) || ti(x).includes(low)));
  return m ? { assigneeId: m.userId, assigneeName: m.name } : { assigneeId: null, assigneeName: null };
}

// ─── Tool definitions ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: { name: string; description: string; input_schema: any }[] = [
  {
    name: "search_plans",
    description:
      "Search THIS SITE's uploaded drawings & specifications and read the matching pages. You MUST call this for ANY question about this project's building, drawings, specs, materials, dimensions, fire ratings, schedules, finishes — you have NO other knowledge of the plans. After it returns, answer ONLY from the page text it gives you, and finish with a line 'Source: <the exact page label>'. If the pages don't contain the answer, say what's missing — never invent codes, ratings, products or numbers.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look up, in plain English." } },
      required: ["query"],
    },
  },
  {
    name: "review_plans",
    description:
      "Read ACROSS THE WHOLE uploaded plan set at once. Use this INSTEAD of search_plans whenever a question needs completeness rather than a single fact: 'are there any clashes or discrepancies worth an RFI?', 'is anything missing or contradictory across the drawings?', 'do the schedules match the details?', 'check the set before we order/line/fabricate'. search_plans only returns the few pages matching a keyword, so it can miss a clash that lives in two documents it didn't rank; review_plans returns the FULL text of every page (optionally narrowed with `focus`) so you can cross-compare and catch inconsistencies no keyword search would surface. It reads more, so it costs more — use it only when the question genuinely needs the whole picture, and use search_plans for a specific lookup. Cite every finding with its 'Source: <page label>'. If the set is too big to read in one pass it tells you what it left out; then narrow with `focus` and call again, and never claim the review is complete when it isn't.",
    input_schema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Optional topic to narrow the review to the relevant documents (e.g. 'doors and door hardware', 'wet area lining', 'windows and glazing', 'fire rating'). Omit to read the ENTIRE set — do that for an open 'any clashes anywhere?' question.",
        },
      },
    },
  },
  {
    name: "search_code",
    description:
      "Search the NEW ZEALAND BUILDING CODE (the free MBIE Acceptable Solutions, Verification Methods, the Code Handbook, and MBIE guidance) and read the matching pages. Call this for any question about what the Building Code REQUIRES or how to comply — clause requirements (B1, C/AS1, E2, G12…), acceptable solutions, minimum dimensions/ratings the code sets, weathertightness, egress, etc. This is the universal code, NOT this project's plans. After it returns, answer from the page text, state that it's general Building-Code guidance (not project-specific), finish with 'Source: <the exact page label>', and remind the user to confirm against the current official document / their designer for anything safety-critical. Never invent a clause number or figure.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "The code question in plain English (e.g. 'minimum stair riser height', 'E2 cavity requirement for direct-fixed cladding')." } },
      required: ["query"],
    },
  },
  {
    name: "search_manufacturer",
    description:
      "Search MANUFACTURERS' OWN technical literature — the installation manuals, system manuals, specification guides and site guides published by the makers of the products actually being installed (currently GIB / Winstone Wallboards). Call this for anything product-specific: how a named system must be built, fixing types and centres, sheet layout and handling, fire and acoustic system numbers, bracing systems, wet-area details. This answers 'how does the MAKER say to install it', which is a different question from what the Code requires (search_code) and from what this project's drawings show (search_plans). Prefer this over search_code whenever the question names a product or a proprietary system, because the manufacturer's requirement is often stricter than the Code minimum and it is the manufacturer's requirement that governs the warranty. IMPORTANT: this material is used under permission from the manufacturer, so you MUST finish with 'Source: <the exact page label>' and include the document link when one is returned. Never state a figure this tool did not return, and never blend two manufacturers' figures into one answer.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The product question (e.g. 'GIB Aqualine fixing centres in a wet area', 'intertenancy barrier system for terrace homes')." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_history",
    description:
      "Search THIS COMPANY's own past inspection results — every failed item from every inspection report filed across all of this builder's sites. Call it for anything about what they have been pulled up on before: 'what failed on the last cavity wrap?', 'do we keep failing passive fire?', 'what did the council pick up at pre-line?'. Results are the company's own history, never anyone else's. Answer from the rows it returns, say how many times each thing came up, and name the site and date when it helps. NEVER use this for RFI drafting — a past answer may sit under a different plan revision or a different engineer's requirement, and surfacing it there is dangerous.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in plain English (e.g. 'cavity wrap flashings', 'passive fire penetrations')." },
        code: { type: "string", description: "Optional council inspection code to limit to: IFO ISF IFG ICA ICL ITK IDT IPP IPB IPL IF1 IF2." },
        category: { type: "string", description: "Optional category filter: Structural, Weathertightness / Cladding, Fire, Electrical, Plumbing & Drainage, Mechanical, Interior / Linings, Access & Barriers, Site / External, Acoustic, Seismic, Architect." },
      },
      required: ["query"],
    },
  },
  {
    name: "create_event",
    description:
      "Add an event to the site calendar (inspection, delivery, pour, meeting, reminder…). SAVE-FIRST: as soon as you have a title + date, call this immediately. Compute relative dates yourself. Set `assignee` to a crew member's name when the user books something FOR a specific person ('book a delivery for the site manager'). Set `kind` only when the type is clear. Set `reminder` in this SAME call when they ask to be reminded — do not create then update.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD (project local day)." },
        time: { type: "string", description: "HH:MM 24h start. Omit for all-day." },
        end_date: { type: "string" },
        end_time: { type: "string" },
        kind: { type: "string", enum: [...KINDS] },
        location: { type: "string" },
        assignee: { type: "string", description: "A crew member's name to make responsible (from the CREW list). Omit if not for a specific person." },
        reminder: { type: "string", description: "Phone reminder, 'YYYY-MM-DD HH:MM' in project local time (or just 'HH:MM' for the same day). Set it whenever the user asks to be reminded/notified/alerted. It fires ONLY on the assignee's phone, so also set `assignee` — if omitted the speaker is auto-assigned." },
        visibility: { type: "string", enum: ["team", "private"], description: "'team' (whole crew) or 'private' (just the creator)." },
      },
      required: ["title", "date"],
    },
  },
  {
    name: "create_task",
    description:
      "Add a to-do / task. SAVE-FIRST. Tasks default to private unless clearly for the crew. Set `assignee` to a crew member's name when it's a job FOR someone ('get the site manager to order the timber'). Use due_time for a finish-by time.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_date: { type: "string" },
        due_time: { type: "string" },
        end_date: { type: "string" },
        end_time: { type: "string" },
        assignee: { type: "string", description: "A crew member's name to assign it to (from the CREW list)." },
        reminder: { type: "string", description: "Phone reminder, 'YYYY-MM-DD HH:MM' in project local time (or just 'HH:MM' for the same day). Set it whenever the user asks to be reminded/notified/alerted. It fires ONLY on the assignee's phone, so also set `assignee` — if omitted the speaker is auto-assigned." },
        visibility: { type: "string", enum: ["team", "private"] },
      },
      required: ["title"],
    },
  },
  {
    name: "find_items",
    description:
      "Find existing events and tasks — call this BEFORE update/delete to get the id, or to answer 'what's on / coming up'. Filters (combinable): `query` (title text) and `date` (single day, or a range with `date_to`). At least one is required.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        date: { type: "string" },
        date_to: { type: "string" },
      },
    },
  },
  {
    name: "update_event",
    description: "Change an existing event. find_items first for the id. Pass only changed fields. `assignee` sets the responsible crew member; empty string '' unassigns. '' clears end_time/location. `reminder` sets a phone reminder ('YYYY-MM-DD HH:MM', project local time) — it fires ONLY on the assignee's phone, so the event must be assigned to whoever should be reminded; '' clears it.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" }, title: { type: "string" }, date: { type: "string" }, time: { type: "string" },
        end_date: { type: "string" }, end_time: { type: "string" }, kind: { type: "string" }, location: { type: "string" },
        assignee: { type: "string" }, visibility: { type: "string", enum: ["team", "private"] },
        reminder: { type: "string", description: "YYYY-MM-DD HH:MM in project local time; '' clears the reminder." },
      },
      required: ["id"],
    },
  },
  {
    name: "update_task",
    description: "Change an existing task, tick it off (status:'done') / reopen (status:'open'), or reassign (`assignee`). find_items first for the id. `reminder` sets a phone reminder ('YYYY-MM-DD HH:MM', project local time) — it fires ONLY on the assignee's phone, so the task must be assigned to whoever should be reminded; '' clears it.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" }, title: { type: "string" }, due_date: { type: "string" }, due_time: { type: "string" },
        end_date: { type: "string" }, end_time: { type: "string" }, assignee: { type: "string" },
        visibility: { type: "string", enum: ["team", "private"] }, status: { type: "string", enum: ["open", "done"] },
        reminder: { type: "string", description: "YYYY-MM-DD HH:MM in project local time; '' clears the reminder." },
      },
      required: ["id"],
    },
  },
  { name: "delete_event", description: "Delete an event. find_items first for the id.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "delete_task", description: "Delete a task. find_items first for the id.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  {
    name: "create_events_bulk",
    description: "Create several events in ONE call (3+ events or a recurring pattern). Compute every date yourself. Each item may carry an `assignee` name.",
    input_schema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" }, date: { type: "string" }, time: { type: "string" }, end_date: { type: "string" },
              end_time: { type: "string" }, kind: { type: "string", enum: [...KINDS] }, location: { type: "string" },
              assignee: { type: "string" }, visibility: { type: "string", enum: ["team", "private"] },
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
    description: "Create several tasks in ONE call (3+ tasks or a recurring pattern).",
    input_schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" }, due_date: { type: "string" }, due_time: { type: "string" },
              end_date: { type: "string" }, end_time: { type: "string" }, assignee: { type: "string" },
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
    description: "Change several events in ONE call. find_items FIRST for the ids. Each item = an id plus only the changed fields.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" }, title: { type: "string" }, date: { type: "string" }, time: { type: "string" },
              end_date: { type: "string" }, end_time: { type: "string" }, kind: { type: "string", enum: [...KINDS] },
              location: { type: "string" }, assignee: { type: "string" }, visibility: { type: "string", enum: ["team", "private"] },
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
    description: "Change several tasks in ONE call. find_items first for the ids.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" }, title: { type: "string" }, due_date: { type: "string" }, due_time: { type: "string" },
              end_date: { type: "string" }, end_time: { type: "string" }, assignee: { type: "string" },
              visibility: { type: "string", enum: ["team", "private"] }, status: { type: "string", enum: ["open", "done"] },
            },
            required: ["id"],
          },
        },
      },
      required: ["updates"],
    },
  },
  { name: "delete_events_bulk", description: "Delete several events in ONE call. find_items first for the ids.", input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] } },
  { name: "delete_tasks_bulk", description: "Delete several tasks in ONE call. find_items first for the ids.", input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] } },
];

const s = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
};
const validKind = (v: unknown): Kind | null => (KINDS.includes(v as Kind) ? (v as Kind) : null);

function eventParts(row: typeof events.$inferSelect) {
  return {
    date: ymdFmt.format(row.startsAt),
    time: row.allDay ? null : hm24.format(row.startsAt),
    endDate: row.endsAt ? ymdFmt.format(row.endsAt) : null,
    endTime: row.endsAt ? hm24.format(row.endsAt) : null,
  };
}

type Ctx = { userId: string; creatorName: string | null; projectId: string; members: Member[]; scope: Scope | null };

function eventInsertFromInput(input: Record<string, unknown>, ctx: Ctx) {
  const title = s(input.title)!;
  const date = s(input.date)!;
  const time = s(input.time);
  const startsAt = zonedWallClockToUtc(date, time);
  const endsAt = resolveEndsAt(date, time, s(input.end_date), s(input.end_time));
  const { assigneeId, assigneeName } = resolveAssignee(input, ctx.members);
  const visRaw = s(input.visibility);
  const rem = reminderFromInput(input, date);
  return {
    projectId: ctx.projectId,
    creatorId: ctx.userId,
    creatorName: ctx.creatorName,
    title,
    startsAt,
    endsAt,
    allDay: !time,
    location: s(input.location),
    kind: validKind(input.kind),
    assigneeId,
    assigneeName,
    // Default private (never auto-broadcast); but assigning to someone means it's
    // shared with at least them, so an assigned item defaults to team-visible.
    visibility: visRaw === "team" ? "team" : visRaw === "private" ? "private" : assigneeId ? "team" : "private",
    // Set at creation so "book the inspection Tuesday and remind me an hour
    // before" is ONE tool call. Previously `reminder` existed only on
    // update_event, so the assistant had to create then update — two calls, and
    // it often didn't bother, silently dropping the reminder the user asked for.
    reminderAt: rem,
    // A reminder fires ONLY on the assignee's phone, so an unassigned reminder
    // reminds nobody, silently, forever. The update path already guards this
    // (computeEventUpdateFields); creation needs the same guard. NB: visibility
    // above is deliberately computed from the EXPLICIT assignee, so a private
    // self-reminder doesn't get broadcast to the crew by this fallback.
    ...(rem && !assigneeId ? { assigneeId: ctx.userId, assigneeName: ctx.creatorName ?? null } : {}),
  };
}
// A reminder fires only on the assignee's phone, so the item must be assigned —
// the route already auto-assigns the speaker when a reminder is set on an
// unassigned item. This just parses the value.
function reminderFromInput(input: Record<string, unknown>, fallbackDate?: string | null): Date | null {
  const r = s(input.reminder);
  if (!r) return null;
  const m = r.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
  if (m) return zonedWallClockToUtc(m[1], m[2]);
  // Tolerate a bare "HH:MM" by pinning it to the item's own day.
  const t = r.match(/^(\d{2}:\d{2})$/);
  if (t && fallbackDate) return zonedWallClockToUtc(fallbackDate, t[1]);
  return null;
}
function taskInsertFromInput(input: Record<string, unknown>, ctx: Ctx) {
  const title = s(input.title)!;
  const dueDate = s(input.due_date);
  const dueTime = s(input.due_time);
  const dueAt = dueDate ? zonedWallClockToUtc(dueDate, dueTime) : null;
  const endsAt = dueDate ? resolveEndsAt(dueDate, dueTime, s(input.end_date), s(input.end_time)) : null;
  const { assigneeId, assigneeName } = resolveAssignee(input, ctx.members);
  const visRaw = s(input.visibility);
  const taskRem = reminderFromInput(input, dueDate);
  return {
    projectId: ctx.projectId,
    creatorId: ctx.userId,
    creatorName: ctx.creatorName,
    title,
    dueAt,
    endsAt,
    assigneeId,
    assigneeName,
    visibility: visRaw === "team" ? "team" : visRaw === "private" ? "private" : assigneeId ? "team" : "private",
    reminderAt: taskRem,
    // Same unassigned-reminder guard as events — see eventInsertFromInput.
    ...(taskRem && !assigneeId ? { assigneeId: ctx.userId, assigneeName: ctx.creatorName ?? null } : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// "YYYY-MM-DD HH:MM" (or with a T) in project-local wall clock → UTC instant.
// Empty/missing clears the reminder. The assignee's phone turns this into a
// native notification via /api/reminders/upcoming + ReminderSync.
function parseReminder(raw: unknown): Date | null {
  const v = s(raw);
  if (!v) return null;
  const [d, t] = v.replace("T", " ").trim().split(/\s+/);
  if (!d) return null;
  return zonedWallClockToUtc(d, t || "09:00");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeEventUpdateFields(existing: typeof events.$inferSelect, input: Record<string, unknown>, members: Member[], speakerId: string): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields: Record<string, any> = {};
  if (input.title !== undefined) fields.title = s(input.title) ?? existing.title;
  if (input.location !== undefined) fields.location = s(input.location);
  if (input.kind !== undefined) fields.kind = validKind(input.kind);
  if (input.visibility !== undefined) fields.visibility = input.visibility === "private" ? "private" : "team";
  if (input.assignee !== undefined) {
    if (!s(input.assignee)) { fields.assigneeId = null; fields.assigneeName = null; }
    else { const r = resolveAssignee(input, members); if (r.assigneeId) { fields.assigneeId = r.assigneeId; fields.assigneeName = r.assigneeName; } }
  }
  if (input.reminder !== undefined) {
    fields.reminderAt = parseReminder(input.reminder);
    // Silent-fail guard: reminders only fire on the ASSIGNEE's phone. Setting one
    // on an unassigned item writes the row and then reminds nobody, forever, with
    // no error. If nothing is assigned, fall back to the person asking.
    if (fields.reminderAt && !fields.assigneeId && !existing.assigneeId) {
      fields.assigneeId = speakerId;
      fields.assigneeName = members.find((m) => m.userId === speakerId)?.name ?? null;
      if (existing.visibility !== "team") fields.visibility = "team";
    }
  }
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
function computeTaskUpdateFields(existing: typeof tasks.$inferSelect, input: Record<string, unknown>, members: Member[], speakerId: string): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields: Record<string, any> = {};
  if (input.title !== undefined) fields.title = s(input.title) ?? existing.title;
  if (input.visibility !== undefined) fields.visibility = input.visibility === "team" ? "team" : "private";
  if (input.assignee !== undefined) {
    if (!s(input.assignee)) { fields.assigneeId = null; fields.assigneeName = null; }
    else { const r = resolveAssignee(input, members); if (r.assigneeId) { fields.assigneeId = r.assigneeId; fields.assigneeName = r.assigneeName; } }
  }
  if (input.status === "done") fields.done = true;
  if (input.status === "open") fields.done = false;
  if (input.reminder !== undefined) {
    fields.reminderAt = parseReminder(input.reminder);
    // Same silent-fail guard as events: an unassigned reminder pings nobody.
    if (fields.reminderAt && !fields.assigneeId && !existing.assigneeId) {
      fields.assigneeId = speakerId;
      fields.assigneeName = members.find((m) => m.userId === speakerId)?.name ?? null;
      if (existing.visibility !== "team") fields.visibility = "team";
    }
  }
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

async function executeTool(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<{ content: string; cards: Card[] }> {
  const { userId, projectId, members } = ctx;
  // Visible to the caller = team OR their own OR assigned to them.
  const evVisible = or(eq(events.visibility, "team"), eq(events.creatorId, userId), eq(events.assigneeId, userId));
  const tkVisible = or(eq(tasks.visibility, "team"), eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId));
  try {
    switch (name) {
      case "search_plans": {
        const q = s(input.query) ?? "";
        if (!q) return { content: JSON.stringify({ error: "query required" }), cards: [] };
        const { pages, df } = await getProjectIndex(projectId);
        // Pull a few extra so older + newer revisions of the same detail both
        // surface — the model then answers from the latest (label carries the date).
        const top = retrieve(pages, df, q, 8);
        if (top.length === 0) return { content: JSON.stringify({ pages: [], note: "Nothing matched in this site's uploaded plans." }), cards: [] };
        return { content: JSON.stringify({ note: "If the same detail differs between pages, the one with the LATEST 'uploaded' date is the current revision — use it.", pages: top.map((p) => ({ label: pageLabel(p), text: excerpt(p.text, q, 2800) })) }), cards: [] };
      }

      case "review_plans": {
        const focus = s(input.focus) ?? "";
        const { pages } = await getProjectIndex(projectId);
        if (pages.length === 0) return { content: JSON.stringify({ pages: [], note: "No plans are uploaded for this site yet." }), cards: [] };

        // Narrow to the focus if given (match on document name OR page text, with
        // the same synonym expansion search uses), else read the whole set. A
        // focus that matches nothing falls back to everything rather than
        // answering from an empty set.
        let selected = pages;
        if (focus) {
          // Drop stopwords/short words so a focus like "doors and door hardware"
          // narrows on "door"/"hardware" and doesn't match every page via "and".
          const STOP = new Set(["and", "the", "for", "with", "from", "this", "that", "these", "those", "all", "any", "are", "was", "were", "our", "your", "have"]);
          const terms = expand(focus).filter((t) => t.length >= 3 && !STOP.has(t));
          const hit = terms.length === 0 ? [] : pages.filter((p) => {
            const hay = ((p.doc || "") + " " + p.text).toLowerCase();
            return terms.some((t) => hay.includes(t));
          });
          if (hit.length) selected = hit;
        }

        // Read pages in full, up to a budget that leaves room for the prompt,
        // the conversation and the answer inside the model's context window. A
        // single very dense sheet is capped so it can't crowd out the rest.
        const CHAR_BUDGET = 420_000; // ~105k tokens of page text
        const PER_PAGE_CAP = 9_000;
        const out: { label: string; text: string }[] = [];
        let used = 0;
        let dropped = 0;
        for (const p of selected) {
          const t = p.text.length > PER_PAGE_CAP ? p.text.slice(0, PER_PAGE_CAP) + " …[page truncated]" : p.text;
          if (used + t.length > CHAR_BUDGET) { dropped++; continue; }
          out.push({ label: pageLabel(p), text: t });
          used += t.length;
        }

        const scope = focus ? `the documents matching "${focus}"` : "the uploaded set";
        const note = dropped > 0
          ? `Read ${out.length} of ${selected.length} pages of ${scope}. ${dropped} pages did NOT fit in one pass. Answer only for what you read here, tell the user which part you covered, and suggest narrowing with a 'focus' (by discipline or topic) to cover the rest. Do NOT imply the review was complete.`
          : `Complete pass: read ALL ${out.length} pages of ${scope} in full. You have the whole ${focus ? "subset" : "set"} — cross-compare freely.`;
        return { content: JSON.stringify({ note, pages: out }), cards: [] };
      }

      case "search_code": {
        const q = s(input.query) ?? "";
        if (!q) return { content: JSON.stringify({ error: "query required" }), cards: [] };
        const { pages, df } = await getCodeIndex();
        if (pages.length === 0) return { content: JSON.stringify({ pages: [], note: "The Building Code index isn't loaded yet." }), cards: [] };
        const top = retrieve(pages, df, q, 6);
        if (top.length === 0) return { content: JSON.stringify({ pages: [], note: "Nothing matched in the Building Code corpus." }), cards: [] };
        return { content: JSON.stringify({ pages: top.map((p) => ({ label: codeLabel(p), text: excerpt(p.text, q, 2800) })) }), cards: [] };
      }

      case "search_manufacturer": {
        const q = s(input.query) ?? "";
        if (!q) return { content: JSON.stringify({ error: "query required" }), cards: [] };
        const { pages, df } = await getManufacturerIndex();
        if (pages.length === 0) return { content: JSON.stringify({ pages: [], note: "No manufacturer literature is loaded yet." }), cards: [] };
        const top = retrieve(pages, df, q, 6);
        if (top.length === 0) return { content: JSON.stringify({ pages: [], note: "Nothing matched in the manufacturer literature we hold." }), cards: [] };
        return {
          content: JSON.stringify({
            // Spelled out for the model rather than left implied: the excerpt is
            // a fragment of a licensed document, and the citation plus link is
            // the condition we're using it under, not a formatting preference.
            note: "This is the manufacturer's own published literature, used with permission. Quote only what you need. End your answer with exactly one line: 'Source: <the exact label>' — copy the label verbatim, including the manufacturer, document name and 'page N of M'. Do NOT paste the document URL in your answer; the app adds the in-app page view and the verify link itself from that label.",
            pages: top.map((p) => ({ label: manufacturerLabel(p), link: p.sourceUrl, text: excerpt(p.text, q, 2800) })),
          }),
          cards: [],
        };
      }

      case "search_history": {
        const q = s(input.query) ?? "";
        if (!q) return { content: JSON.stringify({ error: "query required" }), cards: [] };
        // ctx.scope carries the companyId derived from the caller's verified
        // project. No scope (a legacy project with no company) → no history,
        // rather than an unscoped query that could read across companies.
        if (!ctx.scope) return { content: JSON.stringify({ items: [], note: "No inspection history is set up for this site yet." }), cards: [] };
        const rows = await searchHistory(ctx.scope, q, { code: s(input.code), category: s(input.category), limit: 20 });
        if (rows.length === 0) return { content: JSON.stringify({ items: [], note: "Nothing in this company's filed inspection history matched." }), cards: [] };
        return {
          content: JSON.stringify({
            note: "These are THIS company's own past failed inspection items, across all its sites.",
            items: rows.map((r) => ({ item: r.title, detail: r.detail, where: r.location, category: r.category, inspection: r.inspectionCode, date: r.inspectedOn, site: r.projectName })),
          }),
          cards: [],
        };
      }

      case "create_event": {
        const [row] = await db.insert(events).values(eventInsertFromInput(input, ctx)).returning();
        return { content: JSON.stringify({ ok: true, id: row.id, created: "event", title: row.title, visibility: row.visibility, assignee: row.assigneeName }), cards: [card("event", "created", row)] };
      }
      case "create_task": {
        const [row] = await db.insert(tasks).values(taskInsertFromInput(input, ctx)).returning();
        return { content: JSON.stringify({ ok: true, id: row.id, created: "task", title: row.title, visibility: row.visibility, assignee: row.assigneeName }), cards: [card("task", "created", row)] };
      }
      case "create_events_bulk": {
        const items = Array.isArray(input.events) ? (input.events as Record<string, unknown>[]) : [];
        if (!items.length) return { content: JSON.stringify({ ok: false, error: "empty list" }), cards: [] };
        const inserted = await db.insert(events).values(items.map((it) => eventInsertFromInput(it, ctx))).returning();
        return { content: JSON.stringify({ ok: true, created: "events", count: inserted.length, ids: inserted.map((e) => e.id) }), cards: inserted.map((r) => card("event", "created", r)) };
      }
      case "create_tasks_bulk": {
        const items = Array.isArray(input.tasks) ? (input.tasks as Record<string, unknown>[]) : [];
        if (!items.length) return { content: JSON.stringify({ ok: false, error: "empty list" }), cards: [] };
        const inserted = await db.insert(tasks).values(items.map((it) => taskInsertFromInput(it, ctx))).returning();
        return { content: JSON.stringify({ ok: true, created: "tasks", count: inserted.length, ids: inserted.map((t) => t.id) }), cards: inserted.map((r) => card("task", "created", r)) };
      }

      case "find_items": {
        const query = s(input.query);
        const date = s(input.date);
        const dateTo = s(input.date_to);
        if (!query && !date) return { content: JSON.stringify({ error: "Provide query or date.", events: [], tasks: [] }), cards: [] };
        const dayStart = date ? zonedWallClockToUtc(date, "00:00") : null;
        const dayEnd = date ? zonedWallClockToUtc(addOneDay(dateTo || date), "00:00") : null;
        const FIND_LIMIT = 100;
        const evWhere = and(eq(events.projectId, projectId), evVisible, query ? ilike(events.title, `%${query}%`) : undefined, dayStart ? gte(events.startsAt, dayStart) : undefined, dayEnd ? lt(events.startsAt, dayEnd) : undefined);
        const tkWhere = and(eq(tasks.projectId, projectId), tkVisible, query ? ilike(tasks.title, `%${query}%`) : undefined, dayStart ? gte(tasks.dueAt, dayStart) : undefined, dayEnd ? lt(tasks.dueAt, dayEnd) : undefined);
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
            events: foundEvents.map((e) => ({ id: e.id, title: e.title, when: eventWhen(e.startsAt, e.endsAt, e.allDay), kind: e.kind, location: e.location, visibility: e.visibility, assignee: e.assigneeName })),
            tasks: foundTasks.map((t) => ({ id: t.id, title: t.title, when: taskWhen(t.dueAt, t.endsAt), done: t.done, visibility: t.visibility, assignee: t.assigneeName })),
            events_total: eventsTotal, events_truncated: eventsTotal > FIND_LIMIT,
            tasks_total: tasksTotal, tasks_truncated: tasksTotal > FIND_LIMIT,
          }),
          cards: [],
        };
      }

      case "update_event": {
        const id = s(input.id);
        if (!id) return { content: JSON.stringify({ ok: false, error: "id required" }), cards: [] };
        const [existing] = await db.select().from(events).where(and(eq(events.id, id), eq(events.projectId, projectId))).limit(1);
        if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId && existing.assigneeId !== userId)) return { content: JSON.stringify({ ok: false, error: "not found" }), cards: [] };
        await db.update(events).set(computeEventUpdateFields(existing, input, members, userId)).where(eq(events.id, id));
        const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
        return { content: JSON.stringify({ ok: true, message: "Event updated." }), cards: [card("event", "updated", row)] };
      }
      case "update_task": {
        const id = s(input.id);
        if (!id) return { content: JSON.stringify({ ok: false, error: "id required" }), cards: [] };
        const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.projectId, projectId))).limit(1);
        if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId && existing.assigneeId !== userId)) return { content: JSON.stringify({ ok: false, error: "not found" }), cards: [] };
        await db.update(tasks).set(computeTaskUpdateFields(existing, input, members, userId)).where(eq(tasks.id, id));
        const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
        return { content: JSON.stringify({ ok: true, message: "Task updated." }), cards: [card("task", "updated", row)] };
      }
      case "delete_event": {
        const id = s(input.id);
        if (!id) return { content: JSON.stringify({ ok: false, error: "id required" }), cards: [] };
        const [existing] = await db.select().from(events).where(and(eq(events.id, id), eq(events.projectId, projectId))).limit(1);
        if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId && existing.assigneeId !== userId)) return { content: JSON.stringify({ ok: false, error: "not found" }), cards: [] };
        await db.delete(events).where(eq(events.id, id));
        return { content: JSON.stringify({ ok: true, message: "Event deleted." }), cards: [card("event", "deleted", existing)] };
      }
      case "delete_task": {
        const id = s(input.id);
        if (!id) return { content: JSON.stringify({ ok: false, error: "id required" }), cards: [] };
        const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.projectId, projectId))).limit(1);
        if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId && existing.assigneeId !== userId)) return { content: JSON.stringify({ ok: false, error: "not found" }), cards: [] };
        await db.delete(tasks).where(eq(tasks.id, id));
        return { content: JSON.stringify({ ok: true, message: "Task deleted." }), cards: [card("task", "deleted", existing)] };
      }

      case "update_events_bulk": {
        const updates = Array.isArray(input.updates) ? (input.updates as Record<string, unknown>[]) : [];
        if (!updates.length) return { content: JSON.stringify({ ok: false, error: "empty updates" }), cards: [] };
        const ids = updates.map((u) => s(u.id)).filter((x): x is string => !!x);
        const rows = ids.length ? await db.select().from(events).where(and(eq(events.projectId, projectId), inArray(events.id, ids), evVisible)) : [];
        const byId = new Map(rows.map((e) => [e.id, e]));
        // Report EVERY row's outcome. Previously failures were swallowed and only
        // a success count returned, so a 40-item reschedule with 12 failures was
        // reported to the user as "done".
        const results = await Promise.all(updates.map(async (u) => {
          const id = s(u.id); const existing = id ? byId.get(id) : undefined;
          if (!id) return { id: "", ok: false, error: "missing id" };
          if (!existing) return { id, ok: false, error: "not found" };
          try {
            await db.update(events).set(computeEventUpdateFields(existing, u, members, userId)).where(eq(events.id, id));
            return { id, ok: true };
          } catch (e) {
            return { id, ok: false, error: e instanceof Error ? e.message : "update failed" };
          }
        }));
        const updated = results.filter((r) => r.ok).length;
        const failed = results.filter((r) => !r.ok);
        return { content: JSON.stringify({ ok: failed.length === 0, updated, total: updates.length, failed }), cards: [] };
      }
      case "update_tasks_bulk": {
        const updates = Array.isArray(input.updates) ? (input.updates as Record<string, unknown>[]) : [];
        if (!updates.length) return { content: JSON.stringify({ ok: false, error: "empty updates" }), cards: [] };
        const ids = updates.map((u) => s(u.id)).filter((x): x is string => !!x);
        const rows = ids.length ? await db.select().from(tasks).where(and(eq(tasks.projectId, projectId), inArray(tasks.id, ids), tkVisible)) : [];
        const byId = new Map(rows.map((t) => [t.id, t]));
        const results = await Promise.all(updates.map(async (u) => {
          const id = s(u.id); const existing = id ? byId.get(id) : undefined;
          if (!id) return { id: "", ok: false, error: "missing id" };
          if (!existing) return { id, ok: false, error: "not found" };
          try {
            await db.update(tasks).set(computeTaskUpdateFields(existing, u, members, userId)).where(eq(tasks.id, id));
            return { id, ok: true };
          } catch (e) {
            return { id, ok: false, error: e instanceof Error ? e.message : "update failed" };
          }
        }));
        const updated = results.filter((r) => r.ok).length;
        const failed = results.filter((r) => !r.ok);
        return { content: JSON.stringify({ ok: failed.length === 0, updated, total: updates.length, failed }), cards: [] };
      }
      case "delete_events_bulk": {
        const ids = (Array.isArray(input.ids) ? input.ids : []).map((x) => s(x)).filter((x): x is string => !!x);
        if (!ids.length) return { content: JSON.stringify({ ok: false, error: "empty ids" }), cards: [] };
        const res = await db.delete(events).where(and(eq(events.projectId, projectId), inArray(events.id, ids), evVisible)).returning({ id: events.id });
        return { content: JSON.stringify({ ok: true, deleted: res.length, requested: ids.length }), cards: [] };
      }
      case "delete_tasks_bulk": {
        const ids = (Array.isArray(input.ids) ? input.ids : []).map((x) => s(x)).filter((x): x is string => !!x);
        if (!ids.length) return { content: JSON.stringify({ ok: false, error: "empty ids" }), cards: [] };
        const res = await db.delete(tasks).where(and(eq(tasks.projectId, projectId), inArray(tasks.id, ids), tkVisible)).returning({ id: tasks.id });
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function card(itemType: "event" | "task", action: Card["action"], row: any): Card {
  if (itemType === "event") {
    return {
      id: row.id, itemType, action, title: row.title,
      when: eventWhen(row.startsAt, row.endsAt, row.allDay),
      sub: [row.kind ? cap(row.kind) : null, row.location, row.assigneeName ? `→ ${row.assigneeName}` : null].filter(Boolean).join(" · "),
      kind: row.kind ?? null, visibility: row.visibility, assigneeName: row.assigneeName ?? null,
    };
  }
  return {
    id: row.id, itemType, action, title: row.title,
    when: taskWhen(row.dueAt, row.endsAt),
    sub: [row.done ? "done" : null, row.assigneeName ? `→ ${row.assigneeName}` : null].filter(Boolean).join(" · "),
    kind: null, visibility: row.visibility, assigneeName: row.assigneeName ?? null,
  };
}

// Dynamic context: today + this site's crew + upcoming events + open tasks the
// caller can see (team + their own + assigned to them).
async function buildContext(userId: string, projectId: string, projectName: string, members: Member[]): Promise<string> {
  const now = new Date();
  const todayIso = ymdFmt.format(now);
  const nowHM = timeFmt.format(now);
  const yearAhead = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const visEv = or(eq(events.visibility, "team"), eq(events.creatorId, userId), eq(events.assigneeId, userId));
  const visTk = or(eq(tasks.visibility, "team"), eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId));
  const [upcoming, openTasks] = await Promise.all([
    db.select().from(events).where(and(eq(events.projectId, projectId), visEv, gte(events.startsAt, new Date(now.getTime() - 12 * 3600 * 1000)), lt(events.startsAt, yearAhead))).orderBy(asc(events.startsAt)).limit(60),
    db.select().from(tasks).where(and(eq(tasks.projectId, projectId), visTk, eq(tasks.done, false))).orderBy(asc(tasks.dueAt)).limit(60),
  ]);
  const crew = members.length
    ? members.map((m) => `${m.name || "Crew member"}${m.title ? ` (${m.title})` : ""}`).join(", ")
    : "(just you so far)";
  const evList = upcoming.length
    ? upcoming.map((e) => `- ${eventWhen(e.startsAt, e.endsAt, e.allDay)} — ${e.title}${e.kind ? ` [${e.kind}]` : ""}${e.location ? ` @ ${e.location}` : ""}${e.assigneeName ? ` → ${e.assigneeName}` : ""} (${visLabel(e.visibility)})`).join("\n")
    : "(nothing booked)";
  const tkList = openTasks.length
    ? openTasks.map((t) => `- ${taskWhen(t.dueAt, t.endsAt)} — ${t.title}${t.assigneeName ? ` → ${t.assigneeName}` : ""} (${visLabel(t.visibility)})`).join("\n")
    : "(no open tasks)";
  return `CONTEXT (today: ${todayIso}, now: ${nowHM} ${PROJECT_TZ} time):

Site: ${projectName}
Crew on this site (names you can assign to): ${crew}

Upcoming events (next 12 months, that you can see):
${evList}

Open tasks:
${tkList}`;
}

const STATIC_PROMPT = `You are Soterra's site assistant — a sharp, experienced construction professional helping the crew on a specific construction SITE. You help five ways:
1) PLAN-READER — answer questions about THIS site's uploaded drawings & specifications. For any question about this project's plans/specs (materials, dimensions, fire ratings, schedules, finishes, "what does our spec say…") you MUST call search_plans, then answer ONLY from the page text it returns, finishing with a line: "Source: <the exact page label>". Never invent codes, ratings, products or numbers. If the answer isn't in the pages, say what's missing and which drawing set might have it. REVISIONS — the plans may hold more than one revision of the same sheet; each page label carries an "uploaded" date. The most recently uploaded page is the CURRENT revision. If two pages give different values for the same thing (e.g. a fire rating that was 30 min in an older upload and 60 min in a newer one), ALWAYS use the value from the latest-uploaded page, cite that page as the Source, and note that it supersedes the older figure. Never present a superseded value as current, and never average them. CHOOSING THE RIGHT TOOL BY BREADTH — this matters for both accuracy and cost. For a SPECIFIC lookup (one fact, one detail: "door handle height?", "beam over grid 3?", "what's the wall type to the bathroom?") use search_plans — it's targeted and cheap, and you can call it a few times with different wording. For a WHOLE-SET question that needs completeness — "any clashes or discrepancies worth an RFI?", "is anything missing or contradictory?", "do the schedules agree with the details?", "review the drawings before we order/line/fabricate" — you MUST use review_plans instead, because search_plans only returns the pages matching a keyword and will MISS a clash sitting in two documents it didn't happen to rank. review_plans reads every page so you can cross-compare. Judge the breadth of the question yourself and pick accordingly; do not run a whole-set audit through keyword searches, and do not read the entire set for a single fact. If review_plans says it couldn't fit the whole set in one pass, tell the user which part you covered and offer to continue with a narrower focus — never imply a complete audit you didn't do.
2) BUILDING-CODE — answer what the NZ Building Code REQUIRES by calling search_code (the free MBIE Acceptable Solutions, Verification Methods, Handbook, guidance). Use this for "what does the code require for…", clause requirements, acceptable solutions, minimum figures, weathertightness, egress, etc. Answer from the returned pages, make clear it's general Building-Code guidance (not this project's plans), finish with "Source: <page label>", and remind them to confirm against the current official document / their designer for anything safety-critical. Never invent a clause or number. (search_plans = THIS project's drawings; search_code = the universal Code. Pick the right one; for "does our design meet the code?" you may use both.)
3) MANUFACTURER LITERATURE — answer what the PRODUCT MAKER requires by calling search_manufacturer (currently GIB / Winstone Wallboards: the Site Guide, Fire Rated, Noise Control, Intertenancy Barrier, Aqualine wet area, EzyBrace bracing and Weatherline manuals). Use it whenever the question names a product or a proprietary system, or asks how something must be fixed, laid out, sealed or built. This is a DIFFERENT question from the Code: the maker's requirement is frequently stricter than the Code minimum, and it is the maker's requirement that governs the warranty and the producer statement, so where they differ say so and lead with the manufacturer's figure. Finish with "Source: <page label>" and give the link the tool returns, so the user can open the current document themselves — that citation is a condition of the permission we hold, not a style choice. Two hard rules: never state a figure the tool did not return, and never merge two manufacturers' numbers into one answer, because near-identical tables from different makers are exactly how someone ends up building to the wrong spec. If the corpus doesn't cover it, say so plainly and point them at the manufacturer's technical line rather than filling the gap from memory.
4) CONSTRUCTION EXPERT — general construction knowledge (methods, sequencing, materials, detailing, terminology, H&S, best practice) from your own expertise — no "Source:" line. Use web_search for current/specific external detail (latest product specs, standards) rather than guessing.
5) INSPECTION HISTORY — answer "what have we been pulled up on before?" by calling search_history. It searches THIS COMPANY's own filed inspection reports (all their sites, council and consultant). Use it for "what failed on the last cavity wrap?", "do we keep failing passive fire?", "what did the inspector pick up at pre-line last time?", and whenever someone is preparing for an inspection. Answer from the rows it returns — say how many times a thing has come up and when it last did, because the repeat count is the point. It is this builder's own data, so be direct about it. Never present it as a code requirement; it's what happened.
6) CALENDAR & TASKS — create, find, change, delete events and to-dos using the tools.

If the user attaches a photo or PDF, read it and answer about it.

STAY ON CONSTRUCTION: cover anything construction/site/building-related broadly. Politely decline unrelated topics (sport, politics, trivia) and steer back.

Talk like a sharp, helpful site engineer: warm, concise (1–4 sentences), plain English. State resolved dates explicitly ("Tuesday 16 June").

SAVE-FIRST: when the user wants an event (title + date) or a task (title), call the create tool RIGHT AWAY — don't ask about optional fields first.

VISIBILITY — read the wording, don't assume from type. Always set visibility:
- "my calendar", "for me", "remind me", "just me", "mine" → 'private'.
- "the crew", "the team", "everyone", "site-wide", "tell everyone" → 'team'.
- If neither is signalled AND it's not assigned to someone, default 'private'. Never broadcast to the crew unless asked; the user can share with one tap.

ASSIGNING TO CREW: when the user books/creates something FOR a specific person ("book a delivery for the site manager", "get Jon to order the timber"), set the assignee to that crew member — you can use their NAME or their TITLE (the CREW list shows each as "Name (Title)"), so "the site manager" matches whoever's title is Site Manager. Assigning to someone shares it with them (defaults to team-visible so it lands on their calendar). If nobody in the crew list matches, say they need to join the site with the invite code first (and set their name + title), and add it unassigned for now.

TYPE is optional: set kind only when obvious. RELATIVE DATES: compute yourself, never show the arithmetic — only the final result.

BULK / RECURRING — ONE call: 3+ items or a recurring pattern → work out every date and use create_events_bulk / create_tasks_bulk in a SINGLE call (never 20 separate calls). Changing/deleting many → find_items first for the ids, then update_*_bulk / delete_*_bulk in ONE call. Confirm with the COUNT.

RFIs — you draft and review them, and it's a core job. NEVER call search_history while drafting or reviewing an RFI, and never tell the user "we asked something like this before". An RFI goes to the consultant, and a previous answer may sit under a different plan revision or a different engineer's requirement — surfacing it there quietly steers people to the wrong answer. Asked to write one: search_plans for what the drawings actually show (and search_code if compliance is in question) BEFORE drafting, so the RFI cites real sheets, not guesses. Structure it: Subject · Reference (sheet + revision) · Background (what the documents show today, cited) · The question (ONE specific, closed question the consultant can answer) · Proposed solution / contractor's suggestion if you have a defensible one · Impact (programme/cost, only if the documents support it) · Response required by. Keep it short and factual — an RFI is a request, not an argument. NEVER invent a sheet number, revision, clause or dimension: if the drawings don't cover it, say so plainly, because that gap IS the reason for the RFI. Reviewing one: check it names a specific reference, asks one answerable question, and isn't already answered in the plans or code — say so if it is.

REMINDERS — the 'reminder' field sets a real notification on a phone. It is available on create_event, create_task, update_event AND update_task, so when someone books something and asks to be reminded, set BOTH in the SAME create call — never create then update. "remind me an hour before" → work out the absolute time yourself and pass 'YYYY-MM-DD HH:MM' in site local time. It fires ONLY on the ASSIGNEE's phone; if you set a reminder without an assignee the speaker is auto-assigned so it still reaches someone. When you set one, say so plainly and say WHOSE phone it'll ring on. '' clears it.

ID MEMORY: after a create_*_bulk you already have every new id — reuse them for immediate tweaks/cancels, don't re-find.

TRUNCATION: if find_items returns *_truncated = true, you only got the first 100 of *_total — tell the user the real total and ask how to narrow. Never act on just the 100.

For "what's on / coming up" use the CONTEXT below, or find_items for a specific search.

INSPECTION ORDER — you know the sequence below by heart, so answer "what comes next?", "can I book pre-line yet?" and "what order do these go in?" straight away, without a search. When someone is about to book an inspection that has a hard dependency, SAY SO before anything else and quote the council's wording: an inspection the council turns up to and can't approve is a wasted fee and a re-book. This is Auckland Council's typical order — other councils and reclad regimes differ, so say that when it's relevant, and never present it as the Building Code.

${orderForPrompt()}`;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

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
      const IMG = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      const okType = kind === "pdf" ? mediaType === "application/pdf" : IMG.includes(mediaType);
      if (kind && data && okType) attachment = { kind, mediaType, data };
    }
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!question) return Response.json({ error: "Empty question" }, { status: 400 });

  // Runaway-cost cap: atomic per-site daily counter.
  const today = zonedDayKey(new Date());
  const [usage] = await db
    .insert(usageCounters)
    .values({ projectId, day: today, count: 1 })
    .onConflictDoUpdate({ target: [usageCounters.projectId, usageCounters.day], set: { count: sql`${usageCounters.count} + 1`, updatedAt: new Date() } })
    .returning({ count: usageCounters.count });
  if (usage && usage.count > DAILY_LIMIT) {
    return Response.json({ error: `You've reached today's assistant limit (${DAILY_LIMIT} messages on this site). It resets tomorrow.`, dailyLimited: true }, { status: 429 });
  }

  const user = await currentUser();
  const creatorName = user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;

  // The site's name + crew (for assignment + context).
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const projectName = proj?.name ?? "this site";
  const memberRows = await listMembers(projectId);
  const members: Member[] = memberRows.map((m) => ({ userId: m.userId, name: m.name, title: m.title }));
  // The company boundary for search_history. Derived from the project we just
  // verified the caller belongs to — never from the request.
  const companyId = await companyIdForProject(projectId, userId);
  const scope: Scope | null = companyId ? { projectId, companyId, userId, role: "member" } : null;
  const ctx: Ctx = { userId, creatorName, projectId, members, scope };

  // Resolve (or create) the thread — personal to this user + this site.
  let threadId = reqThreadId;
  let threadNew = false;
  if (threadId) {
    const [existing] = await db.select({ id: chatThreads.id }).from(chatThreads).where(and(eq(chatThreads.id, threadId), eq(chatThreads.creatorId, userId), eq(chatThreads.projectId, projectId))).limit(1);
    if (!existing) threadId = null;
  }
  if (!threadId) {
    const [created] = await db.insert(chatThreads).values({ projectId, creatorId: userId, title: question.slice(0, 80) }).returning();
    threadId = created.id;
    threadNew = true;
  }

  await db.insert(chatMessages).values({ threadId, role: "user", content: question });
  const historyRows = await db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).orderBy(asc(chatMessages.createdAt));

  const MODEL_HISTORY = 24;
  let recent = historyRows.slice(-MODEL_HISTORY);
  while (recent.length && recent[0].role === "assistant") recent = recent.slice(1);

  const dynamicContext = await buildContext(userId, projectId, projectName, members);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = recent.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

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
    let ranOut = true; // cleared when the model stops of its own accord
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        system: [
          { type: "text", text: STATIC_PROMPT, cache_control: { type: "ephemeral" } },
          { type: "text", text: dynamicContext },
        ] as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [
          ...TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t)),
          { type: "web_search_20260209", name: "web_search", max_uses: 5 },
        ] as any,
        messages,
      });

      messages.push({ role: "assistant", content: resp.content });

      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
      if (text) answer = text;

      if (resp.stop_reason === "pause_turn") continue;
      if (resp.stop_reason !== "tool_use") { ranOut = false; break; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolUses = (resp.content as any[]).filter((b) => b.type === "tool_use");
      const results = [];
      for (const tu of toolUses) {
        const { content, cards } = await executeTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, ctx);
        allCards.push(...cards);
        results.push({ type: "tool_result", tool_use_id: tu.id, content });
      }
      messages.push({ role: "user", content: results });
    }

    // If we burned every round still searching, `answer` holds whatever text came
    // with the last tool call — usually a dangling "Let me search more
    // specifically…", or nothing at all (which used to surface as a bare "Done."
    // in reply to a Building-Code question). Force one tool-free turn so the model
    // has to actually answer from what it already found, or say it couldn't.
    if (ranOut) {
      try {
        const wrap = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 8192,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          system: [
            { type: "text", text: STATIC_PROMPT, cache_control: { type: "ephemeral" } },
            { type: "text", text: dynamicContext },
          ] as any,
          messages: [
            ...messages,
            { role: "user", content: "You've run out of search attempts. Answer now using only what you already found above, with the same citation rules. If it isn't enough to answer safely, say plainly what you couldn't confirm and what to check — never guess a clause, figure or product." },
          ],
        });
        const t = wrap.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
        if (t) answer = t;
      } catch (e) {
        console.error("wrap-up call failed:", e);
      }
    }

    const finalAnswer = answer || "I couldn't get to an answer on that one — try rephrasing it, or narrow it to a specific sheet or clause.";
    await db.insert(chatMessages).values({ threadId, role: "assistant", content: finalAnswer });
    await db.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, threadId));
    return Response.json({ answer: finalAnswer, cards: allCards, threadId, threadNew });
  } catch (e) {
    console.error("assistant error:", e);
    const overloaded = e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && (e.status === 429 || e.status === 529 || (e.status ?? 0) >= 500));
    const msg = overloaded ? "The assistant is busy — give it a moment and try again." : "Something went wrong on that one — give it another go.";
    try {
      await db.insert(chatMessages).values({ threadId, role: "assistant", content: msg });
      await db.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, threadId));
    } catch { /* best-effort */ }
    return Response.json({ error: msg }, { status: 503 });
  }
}
