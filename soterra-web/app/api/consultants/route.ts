import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { consultants } from "@/lib/schema";
import { resolveScope } from "@/lib/company";
import { DISCIPLINES } from "@/lib/rfi";

export const runtime = "nodejs";

// Consultant contacts - the other half of the address book (subs are the
// first). Company-scoped like subs: an engineer answers RFIs across every
// site the builder runs. Everything through resolveScope; companyId is never
// read from the client.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isDiscipline = (v: string) => (DISCIPLINES as readonly string[]).includes(v);

// GET /api/consultants → this company's consultants, newest first
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });
  const rows = await db.select().from(consultants).where(eq(consultants.companyId, scope.companyId)).orderBy(desc(consultants.createdAt));
  return Response.json({ consultants: rows });
}

// POST /api/consultants { email, name?, company?, discipline? } → add one
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

  // Lowercased on store - the unique index on (company_id, email) is what
  // makes "saved once, ever" true, and it only works if case never varies.
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const company = String(body.company ?? "").trim().slice(0, 120);
  const discipline = String(body.discipline ?? "").trim();
  if (!EMAIL_RE.test(email)) return Response.json({ error: "That email doesn't look right" }, { status: 400 });

  // Adding an email that exists just refreshes that row - a duplicate in the
  // Directory would be worse than a silently merged add.
  const [row] = await db
    .insert(consultants)
    .values({
      companyId: scope.companyId,
      name: name || null,
      company: company || null,
      discipline: isDiscipline(discipline) ? discipline : null,
      email,
      createdBy: scope.userId,
    })
    .onConflictDoUpdate({
      target: [consultants.companyId, consultants.email],
      set: {
        name: name || null,
        company: company || null,
        discipline: isDiscipline(discipline) ? discipline : null,
      },
    })
    .returning();
  return Response.json({ consultant: row }, { status: 201 });
}

// PATCH /api/consultants { id, name?, company?, discipline?, email? } → edit one
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
  if (body.name !== undefined) set.name = String(body.name ?? "").trim().slice(0, 120) || null;
  if (body.company !== undefined) set.company = String(body.company ?? "").trim().slice(0, 120) || null;
  if (body.discipline !== undefined) {
    const discipline = String(body.discipline ?? "").trim();
    set.discipline = isDiscipline(discipline) ? discipline : null;
  }
  if (body.email !== undefined) {
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
    if (!EMAIL_RE.test(email)) return Response.json({ error: "That email doesn't look right" }, { status: 400 });
    set.email = email;
  }
  if (!Object.keys(set).length) return Response.json({ error: "Nothing to change" }, { status: 400 });

  let row;
  try {
    [row] = await db
      .update(consultants)
      .set(set)
      .where(and(eq(consultants.id, id), eq(consultants.companyId, scope.companyId)))
      .returning();
  } catch (e) {
    // The unique index: editing this row's email onto another saved
    // consultant's would silently merge two people — refuse it instead.
    const s = String((e as { code?: string })?.code ?? "") + " " + String(e);
    if (s.includes("23505") || /duplicate key/i.test(s)) {
      return Response.json({ error: "That email is already in the directory" }, { status: 409 });
    }
    throw e;
  }
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ consultant: row });
}

// DELETE /api/consultants?id=<uuid>
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return Response.json({ error: "Bad id" }, { status: 400 });

  const deleted = await db
    .delete(consultants)
    .where(and(eq(consultants.id, id), eq(consultants.companyId, scope.companyId)))
    .returning({ id: consultants.id });
  if (!deleted.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
