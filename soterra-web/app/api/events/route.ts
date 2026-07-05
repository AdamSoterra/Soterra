import { auth, currentUser } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, projectMembers } from "@/lib/schema";
import { zonedWallClockToUtc, resolveEndsAt } from "@/lib/date-tz";
import { resolveProjectId } from "@/lib/project";

export const runtime = "nodejs";

const KINDS = ["inspection", "delivery", "pour", "meeting", "reminder", "other"] as const;
type Kind = (typeof KINDS)[number];

// Is this user a member of this site? (used to validate an assignee.)
async function memberName(projectId: string, userId: string): Promise<string | null | undefined> {
  const [m] = await db
    .select({ name: projectMembers.name })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return m ? m.name : undefined; // undefined = not a member
}

// ─── GET /api/events ───
// Everything the caller can see on this site: team events + their own private
// ones + anything assigned to them. Scoped to the site in the x-soterra-project
// header (membership enforced by resolveProjectId).
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.projectId, projectId),
        or(eq(events.visibility, "team"), eq(events.creatorId, userId), eq(events.assigneeId, userId))
      )
    )
    .orderBy(asc(events.startsAt));

  return Response.json({ events: rows.map(serialize) });
}

// ─── POST /api/events ───
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });

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

  // Optional assignee — must be a crew member of THIS site. Store their name too.
  let assigneeId: string | null = null;
  let assigneeName: string | null = null;
  if (body.assigneeId) {
    const nm = await memberName(projectId, String(body.assigneeId));
    if (nm !== undefined) {
      assigneeId = String(body.assigneeId);
      assigneeName = (body.assigneeName ? String(body.assigneeName) : nm) || null;
    }
  }

  const user = await currentUser();
  const creatorName =
    user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;

  const [row] = await db
    .insert(events)
    .values({
      projectId,
      creatorId: userId,
      creatorName,
      title,
      startsAt,
      endsAt,
      allDay,
      location: body.location ? String(body.location).trim() || null : null,
      kind,
      visibility,
      assigneeId,
      assigneeName,
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
    assigneeId: e.assigneeId,
    assigneeName: e.assigneeName,
  };
}

// ─── PATCH /api/events ───
// Change visibility and/or assignee — creator only. Body: { id, visibility?, assigneeId?, assigneeName? }.
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  if (!id) return Response.json({ error: "Event id is required" }, { status: 400 });

  const [existing] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.projectId, projectId)))
    .limit(1);
  if (!existing || existing.creatorId !== userId) {
    return Response.json({ error: "Event not found" }, { status: 404 });
  }

  const patch: Partial<typeof events.$inferInsert> = {};
  if (body.visibility === "team" || body.visibility === "private") patch.visibility = body.visibility;
  if ("assigneeId" in body) {
    if (!body.assigneeId) {
      patch.assigneeId = null;
      patch.assigneeName = null;
    } else {
      const nm = await memberName(projectId, String(body.assigneeId));
      if (nm !== undefined) {
        patch.assigneeId = String(body.assigneeId);
        patch.assigneeName = (body.assigneeName ? String(body.assigneeName) : nm) || null;
      }
    }
  }
  if (Object.keys(patch).length === 0) return Response.json({ error: "Nothing to update" }, { status: 400 });

  const [row] = await db.update(events).set(patch).where(eq(events.id, id)).returning();
  return Response.json({ event: serialize(row) });
}
