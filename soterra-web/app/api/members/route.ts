import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { projectMembers, projects } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { generateCode, resolveProjectId, listMembers } from "@/lib/project";

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
      title: m.title || null,
      role: m.role,
      colorIndex: m.colorIndex,
      isMe: m.userId === userId,
    })),
    code: proj?.code ?? null,
    name: proj?.name ?? null,
  });
}

// ─── Mutations. All admin-only, all scoped to the caller's own site. ───
//
// This route was GET-only for a long time, which meant a per-seat product had
// no way to remove a seat: anyone who ever held the join code was in
// permanently, and the code itself could never be changed. On a construction
// site, where subbies rotate off every few weeks, that isn't a missing nicety,
// it's the first question a council procurement person asks ("how do you
// revoke access?") answered wrongly.

/** The caller's membership row on this site, or null. The admin check every
 *  mutation below starts from. */
async function callerMembership(projectId: string, userId: string) {
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** True if removing/demoting `targetUserId` would leave the site with no
 *  admin. A site with no admin can never again manage its own crew, so the
 *  last admin is immovable until another admin exists. */
async function wouldOrphanSite(projectId: string, targetUserId: string): Promise<boolean> {
  const admins = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, "admin")));
  return admins.length === 1 && admins[0].userId === targetUserId;
}

// PATCH /api/members  { userId, role: "admin" | "member" } → change a role
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const target = String(body.userId ?? "").trim();
  const role = String(body.role ?? "").trim();
  if (!target || !["admin", "member"].includes(role)) return Response.json({ error: "userId and a valid role are required." }, { status: 400 });

  const me = await callerMembership(projectId, userId);
  if (me?.role !== "admin") {
    // Orphan recovery, the one exception to admin-only. The last-admin guard
    // below is a check-then-act (Neon's HTTP driver has no transactions), so
    // two admins demoting each other at the same moment can still strand a
    // site with zero admins. Rather than pretending that can't happen, make
    // the state recoverable: on a site with NO admin at all, any member may
    // promote THEMSELVES. It grants nothing on a healthy site — the moment an
    // admin exists, this path is closed.
    const orphanRecovery = role === "admin" && target === userId && me && !(await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, "admin")))
      .limit(1)).length;
    if (!orphanRecovery) return Response.json({ error: "Only a site admin can change roles." }, { status: 403 });
  }

  if (role === "member" && (await wouldOrphanSite(projectId, target))) {
    return Response.json({ error: "This is the site's only admin. Make someone else an admin first." }, { status: 409 });
  }

  const res = await db
    .update(projectMembers)
    .set({ role })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, target)))
    .returning({ id: projectMembers.id });
  if (res.length === 0) return Response.json({ error: "That person isn't on this site." }, { status: 404 });
  return Response.json({ ok: true });
}

// DELETE /api/members?userId=X → remove a person from this site.
//
// Deliberately does NOT touch their past work: events they created, items they
// ticked and photos they took keep their name. Removing a subbie should revoke
// access, not rewrite the site's history.
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  const me = await callerMembership(projectId, userId);
  if (me?.role !== "admin") return Response.json({ error: "Only a site admin can remove someone." }, { status: 403 });

  const target = new URL(req.url).searchParams.get("userId")?.trim();
  if (!target) return Response.json({ error: "userId required" }, { status: 400 });

  if (await wouldOrphanSite(projectId, target)) {
    return Response.json({ error: "This is the site's only admin. Make someone else an admin first." }, { status: 409 });
  }

  const res = await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, target)))
    .returning({ id: projectMembers.id });
  if (res.length === 0) return Response.json({ error: "That person isn't on this site." }, { status: 404 });
  return Response.json({ ok: true });
}

// POST /api/members  { action: "rotate-code" } → new join code for this site.
//
// The old code stops working the moment this returns, which is the point: it
// is the only remedy when a code has been passed around beyond the crew.
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  const me = await callerMembership(projectId, userId);
  if (me?.role !== "admin") return Response.json({ error: "Only a site admin can change the invite code." }, { status: 403 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  if (body.action !== "rotate-code") return Response.json({ error: "Unknown action" }, { status: 400 });

  // The code column is unique across all sites; retry on the (unlikely)
  // collision rather than surfacing a 500 for a lottery loss.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const code = generateCode();
      await db.update(projects).set({ code }).where(eq(projects.id, projectId));
      return Response.json({ ok: true, code });
    } catch {
      /* collision — try another */
    }
  }
  return Response.json({ error: "Couldn't generate a new code, try again." }, { status: 500 });
}
