import { auth, currentUser } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { zonedWallClockToUtc, resolveEndsAt } from "@/lib/date-tz";

export const runtime = "nodejs";

// Hardcoded for now — multi-project comes later. Every query is scoped to this.
const PROJECT_ID = "1-arthur-road";

// Optional event type. null/unknown → untyped (no tag). Kept in sync with the
// EVENT_KINDS list in page.tsx and the assistant's create_event tool.
const KINDS = ["inspection", "delivery", "pour", "meeting", "reminder", "other"] as const;
type Kind = (typeof KINDS)[number];

// ─── GET /api/events ───
// Team events for the project + the caller's own private ones, ordered by start.
// Mirrors the Montázs naptar load (db.select scoped + serialize timestamps to
// ISO so the client builds Dates without timezone surprises).
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.projectId, PROJECT_ID),
        or(eq(events.visibility, "team"), eq(events.creatorId, userId))
      )
    )
    .orderBy(asc(events.startsAt));

  return Response.json({ events: rows.map(serialize) });
}

// ─── POST /api/events ───
// Create an event. creatorId/creatorName come from Clerk, never the client.
// Events default to "team" visibility (the whole crew should see the schedule).
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });

  // Client sends date + optional time fields (project wall-clock); the server
  // converts to UTC so the instant is correct regardless of where it runs.
  const date = String(body.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "A valid date is required" }, { status: 400 });
  }
  const time = /^\d{2}:\d{2}$/.test(String(body.time ?? "")) ? String(body.time) : null;
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.endDate ?? "")) ? String(body.endDate) : null;
  const endTime = /^\d{2}:\d{2}$/.test(String(body.endTime ?? "")) ? String(body.endTime) : null;

  const startsAt = zonedWallClockToUtc(date, time);
  const endsAt = resolveEndsAt(date, time, endDate, endTime);
  const allDay = !time;

  const kind: Kind | null = KINDS.includes(body.kind as Kind) ? (body.kind as Kind) : null;
  const visibility = body.visibility === "private" ? "private" : "team";

  const user = await currentUser();
  const creatorName =
    user?.firstName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    null;

  const [row] = await db
    .insert(events)
    .values({
      projectId: PROJECT_ID,
      creatorId: userId,
      creatorName,
      title,
      startsAt,
      endsAt,
      allDay,
      location: body.location ? String(body.location).trim() || null : null,
      kind,
      visibility,
    })
    .returning();

  return Response.json({ event: serialize(row) }, { status: 201 });
}

function serialize(e: typeof events.$inferSelect) {
  return {
    id: e.id,
    title: e.title,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt ? e.endsAt.toISOString() : null,
    allDay: e.allDay,
    location: e.location,
    kind: e.kind,
    visibility: e.visibility,
    creatorName: e.creatorName,
  };
}

// ─── PATCH /api/events ───
// Change an event's visibility (the "who can see this" tick-box). Restricted to
// the creator — only the person who made it can share it to the crew or pull it
// back to private. Body: { id, visibility: "team" | "private" }.
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  if (!id) return Response.json({ error: "Event id is required" }, { status: 400 });
  const visibility = body.visibility === "team" ? "team" : body.visibility === "private" ? "private" : null;
  if (!visibility) return Response.json({ error: "Nothing to update" }, { status: 400 });

  const [existing] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.projectId, PROJECT_ID)))
    .limit(1);
  if (!existing || existing.creatorId !== userId) {
    return Response.json({ error: "Event not found" }, { status: 404 });
  }

  const [row] = await db.update(events).set({ visibility }).where(eq(events.id, id)).returning();
  return Response.json({ event: serialize(row) });
}
