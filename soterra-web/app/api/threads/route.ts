import { auth } from "@clerk/nextjs/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatThreads, chatMessages } from "@/lib/schema";
import { resolveProjectId } from "@/lib/project";

export const runtime = "nodejs";

// ─── GET /api/threads ───        → list the caller's saved conversations (this site)
// ─── GET /api/threads?id=<id> ── → load one thread's messages (ownership checked)
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    const [thread] = await db
      .select()
      .from(chatThreads)
      .where(and(eq(chatThreads.id, id), eq(chatThreads.creatorId, userId), eq(chatThreads.projectId, projectId)))
      .limit(1);
    if (!thread) return Response.json({ error: "Thread not found" }, { status: 404 });

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, id))
      .orderBy(asc(chatMessages.createdAt));

    return Response.json({
      thread: { id: thread.id, title: thread.title },
      messages: rows.map((m) => ({ role: m.role, content: m.content })),
    });
  }

  const rows = await db
    .select({ id: chatThreads.id, title: chatThreads.title, updatedAt: chatThreads.updatedAt })
    .from(chatThreads)
    .where(and(eq(chatThreads.creatorId, userId), eq(chatThreads.projectId, projectId)))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(50);

  return Response.json({
    threads: rows.map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt.toISOString() })),
  });
}

// ─── DELETE /api/threads?id=<id> ── delete one saved conversation
// ─── DELETE /api/threads?all=1 ──── delete every conversation on this site
//
// Scoped by creatorId AND projectId, exactly like the reads above, so this can
// only ever remove the caller's own conversations on the site they are in. A
// thread that isn't theirs simply isn't matched, and reports 404 rather than
// telling them it exists.
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const all = url.searchParams.get("all") === "1";
  if (!id && !all) return Response.json({ error: "id or all=1 required" }, { status: 400 });

  const mine = and(eq(chatThreads.creatorId, userId), eq(chatThreads.projectId, projectId));
  const targets = await db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(id ? and(mine, eq(chatThreads.id, id)) : mine);
  if (targets.length === 0) return Response.json({ error: "Thread not found" }, { status: 404 });

  // Messages first: chat_messages has no cascade, so deleting the thread alone
  // would strand its rows.
  for (const t of targets) {
    await db.delete(chatMessages).where(eq(chatMessages.threadId, t.id));
    await db.delete(chatThreads).where(eq(chatThreads.id, t.id));
  }
  return Response.json({ ok: true, deleted: targets.length });
}
