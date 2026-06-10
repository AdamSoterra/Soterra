import { auth, currentUser } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks } from "@/lib/schema";
import { zonedWallClockToUtc, resolveEndsAt } from "@/lib/date-tz";

export const runtime = "nodejs";

// Hardcoded for now — multi-project comes later. Every query is scoped to this.
const PROJECT_ID = "1-arthur-road";

function serialize(t: typeof tasks.$inferSelect) {
  return {
    id: t.id,
    title: t.title,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    endsAt: t.endsAt ? t.endsAt.toISOString() : null,
    done: t.done,
    visibility: t.visibility,
    creatorName: t.creatorName,
  };
}

// ─── GET /api/tasks ───
// Team tasks for the project + the caller's own private ones. Open tasks first
// (oldest due first), so the list reads like a to-do queue.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, PROJECT_ID),
        or(eq(tasks.visibility, "team"), eq(tasks.creatorId, userId))
      )
    )
    .orderBy(asc(tasks.done), asc(tasks.dueAt), asc(tasks.createdAt));

  return Response.json({ tasks: rows.map(serialize) });
}

// ─── POST /api/tasks ───
// Create a task. Tasks default to "private" (Just me) — personal by default,
// shareable to the crew (mirrors the Montázs Teendők default).
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

  // Optional due date + time and an optional finish-by end date/time, all in the
  // project wall-clock and converted server-side. A date with no time anchors at
  // 00:00 (date-only "by this day"); the end fields populate tasks.endsAt.
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate ?? "")) ? String(body.dueDate) : null;
  const dueTime = /^\d{2}:\d{2}$/.test(String(body.dueTime ?? "")) ? String(body.dueTime) : null;
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.endDate ?? "")) ? String(body.endDate) : null;
  const endTime = /^\d{2}:\d{2}$/.test(String(body.endTime ?? "")) ? String(body.endTime) : null;

  const dueAt = dueDate ? zonedWallClockToUtc(dueDate, dueTime) : null;
  const endsAt = dueDate ? resolveEndsAt(dueDate, dueTime, endDate, endTime) : null;

  const visibility = body.visibility === "team" ? "team" : "private";

  const user = await currentUser();
  const creatorName =
    user?.firstName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    null;

  const [row] = await db
    .insert(tasks)
    .values({
      projectId: PROJECT_ID,
      creatorId: userId,
      creatorName,
      title,
      dueAt,
      endsAt,
      visibility,
    })
    .returning();

  return Response.json({ task: serialize(row) }, { status: 201 });
}

// ─── PATCH /api/tasks ───
// Toggle (or set) a task's done state. Scoped to the project AND ownership:
// you can only toggle a team task or your own. Body: { id, done }.
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
  if (!id) return Response.json({ error: "Task id is required" }, { status: 400 });

  const [existing] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.projectId, PROJECT_ID)))
    .limit(1);

  if (
    !existing ||
    (existing.visibility !== "team" && existing.creatorId !== userId)
  ) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // Visibility change (the card tick-box) is creator-only — only the person who
  // made the task can share it to the crew or pull it back to private.
  if (body.visibility === "team" || body.visibility === "private") {
    if (existing.creatorId !== userId) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }
    const [row] = await db
      .update(tasks)
      .set({ visibility: body.visibility })
      .where(eq(tasks.id, id))
      .returning();
    return Response.json({ task: serialize(row) });
  }

  // Otherwise it's a done-toggle (allowed for a team task or your own).
  // Explicit done if provided, otherwise flip.
  const done = typeof body.done === "boolean" ? body.done : !existing.done;

  const [row] = await db
    .update(tasks)
    .set({ done })
    .where(eq(tasks.id, id))
    .returning();

  return Response.json({ task: serialize(row) });
}
