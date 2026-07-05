import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, projectMembers } from "@/lib/schema";
import { listUserProjects, generateCode } from "@/lib/project";

export const runtime = "nodejs";

type Clerkish = { firstName?: string | null; username?: string | null; primaryEmailAddress?: { emailAddress?: string } | null } | null;
function displayName(user: Clerkish): string | null {
  return user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;
}

// GET /api/projects → the sites the caller belongs to (for onboarding + switcher).
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const rows = await listUserProjects(userId);
  return Response.json({ projects: rows });
}

// POST /api/projects
//   { action:"create", name }  → new site + join code, caller becomes admin
//   { action:"join",  code }   → join an existing site by its code
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const user = await currentUser();
  const name0 = displayName(user);

  // ─── Join by code ───
  if (body.action === "join") {
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!code) return Response.json({ error: "Enter a join code" }, { status: 400 });
    const [proj] = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
    if (!proj) return Response.json({ error: "That code didn't match a site — check it and try again." }, { status: 404 });

    const members = await db.select({ id: projectMembers.id }).from(projectMembers).where(eq(projectMembers.projectId, proj.id));
    await db
      .insert(projectMembers)
      .values({ projectId: proj.id, userId, name: name0, role: "member", colorIndex: members.length % 8 })
      .onConflictDoNothing();

    return Response.json({
      project: { id: proj.id, name: proj.name, code: proj.code, role: "member", timezone: proj.timezone },
    });
  }

  // ─── Create a site ───
  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ error: "Give your site a name" }, { status: 400 });

  const id = crypto.randomUUID();
  let code = generateCode();
  for (let i = 0; i < 5; i++) {
    const [clash] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, code)).limit(1);
    if (!clash) break;
    code = generateCode();
  }

  await db.insert(projects).values({ id, name, code, creatorId: userId, timezone: "Pacific/Auckland" });
  await db.insert(projectMembers).values({ projectId: id, userId, name: name0, role: "admin", colorIndex: 0 });

  return Response.json(
    { project: { id, name, code, role: "admin", timezone: "Pacific/Auckland" } },
    { status: 201 }
  );
}
