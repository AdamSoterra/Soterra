import { auth } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { del } from "@vercel/blob";
import { db } from "@/lib/db";
import { planPages } from "@/lib/schema";
import { resolveProjectId } from "@/lib/project";

export const runtime = "nodejs";

// GET /api/plans → the documents indexed for the current site (for the Upload tab).
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  const rows = await db
    .select({
      doc: planPages.doc,
      npages: sql<number>`max(${planPages.npages})::int`,
      indexed: sql<number>`count(*)::int`,
      file: sql<string>`max(${planPages.file})`,
      uploadedAt: sql<string>`max(${planPages.createdAt})`,
    })
    .from(planPages)
    .where(eq(planPages.projectId, projectId))
    .groupBy(planPages.doc)
    .orderBy(sql`max(${planPages.createdAt}) desc`);

  return Response.json({ docs: rows });
}

// DELETE /api/plans  { doc }  → remove a document's indexed pages (+ its blob) for this site.
export async function DELETE(req: Request) {
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
  const doc = String(body.doc ?? "").trim();
  if (!doc) return Response.json({ error: "doc required" }, { status: 400 });

  // Grab the blob path(s) for this doc first, then drop the rows.
  const paths = await db
    .selectDistinct({ file: planPages.file })
    .from(planPages)
    .where(and(eq(planPages.projectId, projectId), eq(planPages.doc, doc)));
  await db.delete(planPages).where(and(eq(planPages.projectId, projectId), eq(planPages.doc, doc)));

  // Best-effort blob cleanup (never block the delete on it).
  for (const p of paths) {
    if (p.file) {
      try {
        await del(p.file);
      } catch {
        /* ignore */
      }
    }
  }

  return Response.json({ ok: true });
}
