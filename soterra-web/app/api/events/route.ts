import { auth, currentUser } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";

export const runtime = "nodejs";

// Hardcoded for now — multi-project comes later. Every query is scoped to this.
const PROJECT_ID = "1-arthur-road";

const KINDS = ["inspection", "delivery", "pour", "reminder", "event"] as const;
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

  return Response.json({
    events: rows.map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt ? e.endsAt.toISOString() : null,
      allDay: e.allDay,
      location: e.location,
      kind: e.kind,
      visibility: e.visibility,
      creatorName: e.creatorName,
    })),
  });
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

  // startsAt must be a parseable date/datetime string. The client sends an ISO
  // string built from the date + time inputs (see page.tsx).
  const startsRaw = String(body.startsAt ?? "");
  const startsAt = new Date(startsRaw);
  if (!startsRaw || isNaN(startsAt.getTime())) {
    return Response.json({ error: "A valid date is required" }, { status: 400 });
  }

  let endsAt: Date | null = null;
  if (body.endsAt) {
    const e = new Date(String(body.endsAt));
    if (!isNaN(e.getTime())) endsAt = e;
  }

  const kind: Kind = KINDS.includes(body.kind as Kind)
    ? (body.kind as Kind)
    : "inspection";
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
      allDay: Boolean(body.allDay),
      location: body.location ? String(body.location).trim() || null : null,
      kind,
      visibility,
    })
    .returning();

  return Response.json(
    {
      event: {
        id: row.id,
        title: row.title,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt ? row.endsAt.toISOString() : null,
        allDay: row.allDay,
        location: row.location,
        kind: row.kind,
        visibility: row.visibility,
        creatorName: row.creatorName,
      },
    },
    { status: 201 }
  );
}
