import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { projectMembers, projects } from "./schema";

// Resolve + AUTHORIZE the project for a request. The client sends the current
// site id in the `x-soterra-project` header; we confirm the caller is a member.
// Returns the projectId if the user belongs to it, else null (→ 403).
export async function resolveProjectId(req: Request, userId: string): Promise<string | null> {
  const pid = req.headers.get("x-soterra-project");
  if (!pid) return null;
  const [m] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, pid), eq(projectMembers.userId, userId)))
    .limit(1);
  return m ? pid : null;
}

// The projects a user belongs to (for the switcher).
export async function listUserProjects(userId: string) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      timezone: projects.timezone,
      role: projectMembers.role,
      creatorId: projects.creatorId,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.userId, userId));
}

// The crew of a site (for the assignment dropdown + colour-by-crew).
export async function listMembers(projectId: string) {
  return db
    .select({
      userId: projectMembers.userId,
      name: projectMembers.name,
      title: projectMembers.title,
      role: projectMembers.role,
      colorIndex: projectMembers.colorIndex,
    })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.createdAt);
}

// A short, unambiguous join code: XXXX-XXXX from a no-look-alike alphabet.
export function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  const block = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${block()}-${block()}`;
}
