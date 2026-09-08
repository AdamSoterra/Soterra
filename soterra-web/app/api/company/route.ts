import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies } from "@/lib/schema";
import { resolveScope } from "@/lib/company";
import { inboundEnabled } from "@/lib/inboundAddress";

export const runtime = "nodejs";

// The company's own settings (through the verified Scope, never a body id):
//   GET   /api/company                           → { name, externalLoginRequired, inboundEnabled }
//   PATCH /api/company { externalLoginRequired } → flip the sign-in gate on external links
// Admin-only for the write: this changes how every consultant and sub reaches
// the company's items.

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });
  const [row] = await db
    .select({ name: companies.name, externalLoginRequired: companies.externalLoginRequired })
    .from(companies)
    .where(eq(companies.id, scope.companyId))
    .limit(1);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ...row, inboundEnabled: await inboundEnabled(), role: scope.role });
}

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });
  if (scope.role !== "admin") return Response.json({ error: "Only a site admin can change this" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.externalLoginRequired !== "boolean") return Response.json({ error: "Nothing to change" }, { status: 400 });
  const [row] = await db
    .update(companies)
    .set({ externalLoginRequired: body.externalLoginRequired })
    .where(eq(companies.id, scope.companyId))
    .returning({ externalLoginRequired: companies.externalLoginRequired });
  return Response.json({ ok: true, externalLoginRequired: row.externalLoginRequired });
}
