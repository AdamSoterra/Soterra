import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectMembers } from "@/lib/schema";
import { planPageImage } from "@/lib/planRender";

export const runtime = "nodejs";
export const maxDuration = 60;

// A small cached render of a plan page for the Plans preview grid. Same private
// gating as /api/plan-page (membership re-checked; the <img> sends the session
// cookie same-origin). Defaults to page 1 — the sheet's cover.
//
//   GET /api/plan-thumb?project=<id>&doc=<title>&p=1  →  image/png
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });

  const url = new URL(req.url);
  const project = url.searchParams.get("project")?.trim();
  const doc = url.searchParams.get("doc")?.trim();
  const p = Number(url.searchParams.get("p") ?? "1");
  if (!project || !doc || !Number.isInteger(p) || p < 1) return new Response("Bad request", { status: 400 });

  const [member] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, project), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!member) return new Response("Forbidden", { status: 403 });

  const buf = await planPageImage(project, doc, p, { thumb: true });
  if (!buf) return new Response("Not found", { status: 404 });

  return new Response(buf, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
