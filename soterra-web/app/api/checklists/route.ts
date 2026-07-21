import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { resolveScope } from "@/lib/company";
import {
  CHECKLIST_CODES,
  addChecklistItem,
  addChecklistPhoto,
  createChecklist,
  deleteChecklist,
  generateChecklistItems,
  getChecklist,
  isItemStatus,
  listChecklists,
  setChecklistStatus,
  updateChecklistItem,
} from "@/lib/checklist";
import { codeName } from "@/lib/categories";

export const runtime = "nodejs";
// Generation reads the drawings, the Code and the company's history, then
// writes 10-20 cited items. Measured at 30-60s on a big set.
export const maxDuration = 300;

type Clerkish = { firstName?: string | null; username?: string | null; primaryEmailAddress?: { emailAddress?: string } | null } | null;
function displayName(user: Clerkish): string | null {
  return user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;
}

// GET /api/checklists              → this site's checklists (with done/total)
// GET /api/checklists?eventId=…    → the checklists on one calendar event
// GET /api/checklists?id=…         → one checklist, its items and their photos
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const found = await getChecklist(scope, id);
    if (!found) return Response.json({ error: "Checklist not found" }, { status: 404 });
    return Response.json(found);
  }

  const eventId = url.searchParams.get("eventId");
  const rows = await listChecklists(scope, { eventId });
  return Response.json({ checklists: rows, codes: CHECKLIST_CODES });
}

// POST /api/checklists
//   { eventId?, kind?, inspectionCode?, title?, generate? }
// generate defaults to true — the whole point is that the assistant writes it.
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

  const kind = body.kind === "ccc" ? "ccc" : "inspection";
  const inspectionCode = String(body.inspectionCode ?? "").trim().toUpperCase() || null;
  const eventId = String(body.eventId ?? "").trim() || null;

  // A checklist can hang off a calendar event — but only one on THIS site, and
  // only one the caller is allowed to see.
  let eventTitle: string | null = null;
  if (eventId) {
    const [ev] = await db
      .select({ id: events.id, title: events.title, visibility: events.visibility, creatorId: events.creatorId, assigneeId: events.assigneeId })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.projectId, scope.projectId)))
      .limit(1);
    if (!ev || (ev.visibility !== "team" && ev.creatorId !== userId && ev.assigneeId !== userId)) {
      return Response.json({ error: "Event not found" }, { status: 404 });
    }
    eventTitle = ev.title;
  }

  const title =
    String(body.title ?? "").trim() ||
    (kind === "ccc" ? "CCC evidence pack" : `${codeName(inspectionCode) ?? "Inspection"} check`) ||
    eventTitle ||
    "Inspection check";

  if (kind === "inspection" && !inspectionCode && !eventTitle && !String(body.title ?? "").trim()) {
    return Response.json({ error: "Pick which inspection this is for" }, { status: 400 });
  }

  const generate = body.generate !== false;
  let items: { title: string; detail: string; source: string; sourceRef: string | null; category: string }[] = [];
  if (generate) {
    const result = await generateChecklistItems(scope, { kind, inspectionCode, title: [eventTitle, title].filter(Boolean).join(" — ") });
    if (!result.ok) {
      // 503 when the assistant itself is down (retryable), 422 when the sources
      // genuinely had nothing (retrying won't help).
      return Response.json({ error: result.message }, { status: result.reason === "failed" ? 503 : 422 });
    }
    items = result.items;
  }

  const user = await currentUser();
  const row = await createChecklist(scope, {
    eventId,
    kind,
    title,
    inspectionCode,
    createdByName: displayName(user),
    items,
  });

  const full = await getChecklist(scope, row.id);
  return Response.json(full, { status: 201 });
}

// PATCH /api/checklists
//   { itemId, status?, note? }        → tick an item / record what you found
//   { checklistId, status }           → close or reopen the whole checklist
//   { checklistId, addItem: { … } }   → add an item by hand
//   { itemId, photo: { url, caption } } → attach a photo already uploaded to Blob
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

  const itemId = String(body.itemId ?? "").trim();
  const checklistId = String(body.checklistId ?? "").trim();

  if (itemId && body.photo && typeof body.photo === "object") {
    const p = body.photo as Record<string, unknown>;
    const url = String(p.url ?? "").trim();
    if (!url || !url.startsWith(`${scope.projectId}/checklists/`)) {
      return Response.json({ error: "A valid uploaded-photo path is required" }, { status: 400 });
    }
    const row = await addChecklistPhoto(scope, itemId, url, String(p.caption ?? "").trim() || null);
    if (!row) return Response.json({ error: "Checklist item not found" }, { status: 404 });
    return Response.json({ photo: row });
  }

  if (itemId) {
    const status = body.status;
    if (status !== undefined && !isItemStatus(status)) {
      return Response.json({ error: "Status must be pending, ok, issue or na" }, { status: 400 });
    }
    const user = await currentUser();
    const row = await updateChecklistItem(scope, itemId, {
      status: isItemStatus(status) ? status : undefined,
      note: body.note !== undefined ? String(body.note ?? "").trim() || null : undefined,
      checkedByName: displayName(user),
    });
    if (!row) return Response.json({ error: "Checklist item not found" }, { status: 404 });
    return Response.json({ item: row });
  }

  if (checklistId && body.addItem && typeof body.addItem === "object") {
    const a = body.addItem as Record<string, unknown>;
    const title = String(a.title ?? "").trim();
    if (!title) return Response.json({ error: "Give the item a name" }, { status: 400 });
    const row = await addChecklistItem(scope, checklistId, {
      title,
      detail: String(a.detail ?? "").trim() || null,
      category: String(a.category ?? "").trim() || null,
    });
    if (!row) return Response.json({ error: "Checklist not found" }, { status: 404 });
    return Response.json({ item: row });
  }

  if (checklistId && (body.status === "open" || body.status === "done")) {
    const row = await setChecklistStatus(scope, checklistId, body.status);
    if (!row) return Response.json({ error: "Checklist not found" }, { status: 404 });
    return Response.json({ checklist: row });
  }

  return Response.json({ error: "Nothing to update" }, { status: 400 });
}

// DELETE /api/checklists?id=…
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const ok = await deleteChecklist(scope, id);
  if (!ok) return Response.json({ error: "Checklist not found" }, { status: 404 });
  return Response.json({ ok: true });
}
