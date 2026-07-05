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
