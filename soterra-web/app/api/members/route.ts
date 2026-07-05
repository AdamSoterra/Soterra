import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { resolveProjectId, listMembers } from "@/lib/project";

export const runtime = "nodejs";

// GET /api/members → the crew of the current site (+ its join code), for the
// assignee dropdown and the "Crew & invite code" panel. Membership enforced.
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  const members = await listMembers(projectId);
  const [proj] = await db.select({ code: projects.code, name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1);

  return Response.json({
    members: members.map((m) => ({
      userId: m.userId,
      name: m.name || "Crew member",
      role: m.role,
      colorIndex: m.colorIndex,
      isMe: m.userId === userId,
    })),
    code: proj?.code ?? null,
    name: proj?.name ?? null,
  });
}
