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
      companyId: projects.companyId,
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
// crypto randomness, not Math.random(): this code is the sole credential the
// join flow authorises on, and V8's Math.random is predictable from a few
// observed outputs. The keyspace is fine (31^8); the generator was the gap.
export function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const ch = (b: number) => alphabet[b % alphabet.length];
  const s = Array.from(bytes, ch).join("");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
