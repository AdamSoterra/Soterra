import { auth, currentUser } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, projectMembers } from "@/lib/schema";
import { zonedWallClockToUtc, resolveEndsAt } from "@/lib/date-tz";
import { resolveProjectId } from "@/lib/project";

export const runtime = "nodejs";

async function memberName(projectId: string, userId: string): Promise<string | null | undefined> {
  const [m] = await db
    .select({ name: projectMembers.name })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return m ? m.name : undefined;
}

function serialize(t: typeof tasks.$inferSelect) {
  return {
    id: t.id,
    title: t.title,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    endsAt: t.endsAt ? t.endsAt.toISOString() : null,
    done: t.done,
    visibility: t.visibility,
    creatorName: t.creatorName,
    assigneeId: t.assigneeId,
    assigneeName: t.assigneeName,
  };
}

// ─── GET /api/tasks ───
// Team tasks + the caller's own private ones + anything assigned to them.
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        or(eq(tasks.visibility, "team"), eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId))
      )
    )
    .orderBy(asc(tasks.done), asc(tasks.dueAt), asc(tasks.createdAt));

  return Response.json({ tasks: rows.map(serialize) });
}

// ─── POST /api/tasks ───  (tasks default to "private" — personal by default)
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

  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate ?? "")) ? String(body.dueDate) : null;
  const dueTime = /^\d{2}:\d{2}$/.test(String(body.dueTime ?? "")) ? String(body.dueTime) : null;
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.endDate ?? "")) ? String(body.endDate) : null;
  const endTime = /^\d{2}:\d{2}$/.test(String(body.endTime ?? "")) ? String(body.endTime) : null;

  const dueAt = dueDate ? zonedWallClockToUtc(dueDate, dueTime) : null;
  const endsAt = dueDate ? resolveEndsAt(dueDate, dueTime, endDate, endTime) : null;

  // Assigning to someone implies at least the two of you see it — so an assigned
  // task defaults to team-visible unless explicitly kept private by the creator.
  let assigneeId: string | null = null;
  let assigneeName: string | null = null;
  if (body.assigneeId) {
    const nm = await memberName(projectId, String(body.assigneeId));
    if (nm !== undefined) {
      assigneeId = String(body.assigneeId);
      assigneeName = (body.assigneeName ? String(body.assigneeName) : nm) || null;
    }
  }
  const visibility = body.visibility === "team" ? "team" : body.visibility === "private" ? "private" : assigneeId ? "team" : "private";

  const user = await currentUser();
  const creatorName =
    user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;

  const [row] = await db
    .insert(tasks)
    .values({ projectId, creatorId: userId, creatorName, title, dueAt, endsAt, visibility, assigneeId, assigneeName })
    .returning();

  return Response.json({ task: serialize(row) }, { status: 201 });
}

// ─── PATCH /api/tasks ───
// done-toggle (team task or your own) OR visibility/assignee change (creator only).
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
  if (!id) return Response.json({ error: "Task id is required" }, { status: 400 });

  const [existing] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.projectId, projectId)))
    .limit(1);

  // Visible to the caller? team, own, or assigned to them.
  if (!existing || (existing.visibility !== "team" && existing.creatorId !== userId && existing.assigneeId !== userId)) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // Visibility / assignee changes are creator-only.
  const wantsMeta = body.visibility === "team" || body.visibility === "private" || "assigneeId" in body;
  if (wantsMeta) {
    if (existing.creatorId !== userId) return Response.json({ error: "Task not found" }, { status: 404 });
    const patch: Partial<typeof tasks.$inferInsert> = {};
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
    if (Object.keys(patch).length) {
      const [row] = await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
      return Response.json({ task: serialize(row) });
    }
  }

  // Otherwise it's a done-toggle.
  const done = typeof body.done === "boolean" ? body.done : !existing.done;
  const [row] = await db.update(tasks).set({ done }).where(eq(tasks.id, id)).returning();
  return Response.json({ task: serialize(row) });
}
