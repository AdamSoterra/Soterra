import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subs } from "@/lib/schema";
import { resolveScope } from "@/lib/company";
import { isCategory } from "@/lib/categories";

export const runtime = "nodejs";

// Subcontractor contacts — company-scoped (a builder's supply chain follows
// them across sites). Everything through resolveScope; companyId is never
// read from the client.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/subs → this company's subs, name order
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });
  const rows = await db.select().from(subs).where(eq(subs.companyId, scope.companyId)).orderBy(asc(subs.name));
  return Response.json({ subs: rows });
}

// POST /api/subs { name, email, trade? } → add one
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().slice(0, 200);
  const trade = String(body.trade ?? "").trim();
  if (!name) return Response.json({ error: "Give the sub a name" }, { status: 400 });
  if (!EMAIL_RE.test(email)) return Response.json({ error: "That email doesn't look right" }, { status: 400 });

  const [row] = await db
    .insert(subs)
    .values({ companyId: scope.companyId, name, email, trade: isCategory(trade) ? trade : null, createdBy: scope.userId })
    .returning();
  return Response.json({ sub: row }, { status: 201 });
}

// PATCH /api/subs { id, name?, email?, trade? } → edit one
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return Response.json({ error: "Bad id" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = {};
  if (body.name !== undefined) {
    const name = String(body.name ?? "").trim().slice(0, 120);
    if (!name) return Response.json({ error: "Give the sub a name" }, { status: 400 });
    set.name = name;
  }
  if (body.email !== undefined) {
    const email = String(body.email ?? "").trim().slice(0, 200);
    if (!EMAIL_RE.test(email)) return Response.json({ error: "That email doesn't look right" }, { status: 400 });
    set.email = email;
  }
  if (body.trade !== undefined) {
    const trade = String(body.trade ?? "").trim();
    set.trade = isCategory(trade) ? trade : null;
  }
  if (!Object.keys(set).length) return Response.json({ error: "Nothing to change" }, { status: 400 });

  const [row] = await db
    .update(subs)
    .set(set)
    .where(and(eq(subs.id, id), eq(subs.companyId, scope.companyId)))
    .returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ sub: row });
}

// DELETE /api/subs?id=<uuid>
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return Response.json({ error: "Bad id" }, { status: 400 });

  const deleted = await db
    .delete(subs)
    .where(and(eq(subs.id, id), eq(subs.companyId, scope.companyId)))
    .returning({ id: subs.id });
  if (!deleted.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
