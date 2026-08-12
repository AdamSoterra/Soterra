import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { planPins, planPages } from "@/lib/schema";
import { resolveScope } from "@/lib/company";

export const runtime = "nodejs";

// Plan pins (Foundation 2): x,y markers on a drawing, tied to the record they
// annotate. Every request is scoped through resolveScope — a pin is only ever
// visible to members of the project it sits in, like everything else.

const RECORD_TYPES = new Set(["qa_flag", "rfi", "checklist_item"]);

// GET /api/pins?doc=<title>&page=<n>          → pins on one sheet page
// GET /api/pins?recordType=rfi&recordId=<id>  → the pins a record owns
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const url = new URL(req.url);
  const doc = url.searchParams.get("doc")?.trim();
  const pageParam = url.searchParams.get("page");
  const recordType = url.searchParams.get("recordType")?.trim();
  const recordId = url.searchParams.get("recordId")?.trim();

  if (doc) {
    const page = Number(pageParam);
    const where = pageParam == null
      ? and(eq(planPins.projectId, scope.projectId), eq(planPins.doc, doc))
      : Number.isInteger(page) && page >= 1
        ? and(eq(planPins.projectId, scope.projectId), eq(planPins.doc, doc), eq(planPins.page, page))
        : null;
    if (!where) return Response.json({ error: "Bad page" }, { status: 400 });
    const pins = await db.select().from(planPins).where(where).orderBy(planPins.createdAt);
    return Response.json({ pins });
  }

  if (recordType && recordId) {
    if (!RECORD_TYPES.has(recordType)) return Response.json({ error: "Bad recordType" }, { status: 400 });
    const pins = await db
      .select()
      .from(planPins)
      .where(and(eq(planPins.projectId, scope.projectId), eq(planPins.recordType, recordType), eq(planPins.recordId, recordId)))
      .orderBy(planPins.createdAt);
    return Response.json({ pins });
  }

  return Response.json({ error: "Pass doc (+page) or recordType+recordId" }, { status: 400 });
}

// POST /api/pins  { doc, page, x, y, recordType, recordId, label? }
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

  const doc = String(body.doc ?? "").trim();
  const page = Number(body.page);
  const x = Number(body.x);
  const y = Number(body.y);
  const recordType = String(body.recordType ?? "");
  const recordId = String(body.recordId ?? "").trim();
  const label = String(body.label ?? "").trim().slice(0, 40) || null;

  if (!doc || doc.length > 300) return Response.json({ error: "Bad doc" }, { status: 400 });
  if (!Number.isInteger(page) || page < 1) return Response.json({ error: "Bad page" }, { status: 400 });
  if (!Number.isFinite(x) || x < 0 || x > 100 || !Number.isFinite(y) || y < 0 || y > 100)
    return Response.json({ error: "x/y must be 0-100 (% of the sheet)" }, { status: 400 });
  if (!RECORD_TYPES.has(recordType)) return Response.json({ error: "Bad recordType" }, { status: 400 });
  if (!recordId || recordId.length > 80) return Response.json({ error: "Bad recordId" }, { status: 400 });

  // The pinned sheet must actually exist in THIS project — a pin on a sheet
  // the project doesn't hold is either a bug or someone probing.
  const [sheet] = await db
    .select({ id: planPages.id })
    .from(planPages)
    .where(and(eq(planPages.projectId, scope.projectId), eq(planPages.doc, doc), eq(planPages.page, page)))
    .limit(1);
  if (!sheet) return Response.json({ error: "No such sheet page on this site" }, { status: 404 });

  const [pin] = await db
    .insert(planPins)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      doc,
      page,
      x,
      y,
      recordType,
      recordId,
      label,
      createdBy: scope.userId,
    })
    .returning();
  return Response.json({ pin });
}

// DELETE /api/pins?id=<uuid>
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id")?.trim();
  // Postgres throws on a malformed uuid before the WHERE can miss, so shape-
  // check here and return a clean 400 instead of a 500.
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return Response.json({ error: "Bad id" }, { status: 400 });

  const deleted = await db
    .delete(planPins)
    .where(and(eq(planPins.id, id), eq(planPins.projectId, scope.projectId)))
    .returning({ id: planPins.id });
  if (!deleted.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
