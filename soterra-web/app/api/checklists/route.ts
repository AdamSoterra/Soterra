import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { resolveScope } from "@/lib/company";
import {
  CHECKLIST_TYPES,
  FITOUT_TEMPLATE_TITLE,
  addChecklistItem,
  addChecklistPhoto,
  createChecklist,
  deleteChecklist,
  flaggedChecklistItems,
  generateChecklistItems,
  getChecklist,
  isItemStatus,
  listChecklists,
  setChecklistStatus,
  updateChecklistItem,
} from "@/lib/checklist";
import { codeName } from "@/lib/categories";
import { addUserZone, getProjectLocations } from "@/lib/locations";

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
  // Programme critiques share these tables (kind='programme') but belong to the
  // Programme tab, not the QA-checklist list — keep them out of here.
  const rows = (await listChecklists(scope, { eventId })).filter((r) => r.kind !== "programme");
  // The site-wide list also carries every flagged item, so the Internal pocket
  // can show what the crew's own pre-checks catch without a request per check.
  const flagged = eventId ? [] : await flaggedChecklistItems(scope);
  return Response.json({ checklists: rows, flagged, types: CHECKLIST_TYPES });
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

  const kind = body.kind === "ccc" ? "ccc" : body.kind === "template" ? "template" : "inspection";
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

  // Feature 4: the location this check is scoped to. The label comes from the
  // client; the DRAWINGS are always resolved server-side from the project's own
  // location cache — the client never gets to say which sheets a location owns.
  // A label the cache doesn't know (free-typed zone) is remembered as a user
  // zone for next time and scopes the prompt only.
  const locationLabel = String(body.location ?? "").trim().slice(0, 60) || null;
  let location: { label: string; drawings: string[] } | null = null;
  if (locationLabel && kind === "inspection") {
    const locs = await getProjectLocations(scope.projectId);
    const found = locs.find((l) => l.label.toLowerCase() === locationLabel.toLowerCase());
    if (found) location = { label: found.label, drawings: found.drawings };
    else {
      await addUserZone(scope.projectId, locationLabel);
      location = { label: locationLabel, drawings: [] };
    }
  }

  const baseTitle =
    String(body.title ?? "").trim() ||
    (kind === "ccc" ? "CCC evidence pack" : kind === "template" ? FITOUT_TEMPLATE_TITLE : `${codeName(inspectionCode) ?? "Inspection"} check`) ||
    eventTitle ||
    "Inspection check";
  // "Unit 1 - Fire check" — the report is titled by where it happened.
  const title = location ? `${location.label} - ${baseTitle}` : baseTitle;

  if (kind === "inspection" && !inspectionCode && !eventTitle && !String(body.title ?? "").trim()) {
    return Response.json({ error: "Pick which inspection this is for" }, { status: 400 });
  }

  const generate = body.generate !== false;
  let items: { title: string; detail: string; source: string; sourceRef: string | null; category: string }[] = [];
  if (generate) {
    const result = await generateChecklistItems(scope, {
      kind,
      inspectionCode,
      title: [eventTitle, baseTitle].filter(Boolean).join(" — "),
      location,
    });
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
    location: location?.label ?? null,
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
