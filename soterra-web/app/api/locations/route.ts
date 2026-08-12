import { auth } from "@clerk/nextjs/server";
import { resolveProjectId } from "@/lib/project";
import { addUserZone, getProjectLocations, removeUserZone, type LocationKind } from "@/lib/locations";

export const runtime = "nodejs";
// Normally a table read (the cache persists on project_locations); the model
// only runs on a refresh or when the plan set changed under a stale cache.
export const maxDuration = 60;

// GET /api/locations → the physical locations a QA check can be scoped to for the
// current project. Served from the per-project cache; self-heals if the plan set
// changed since the last extraction. Empty array = nothing named a place, so the
// UI offers free-typing.
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });
  const locations = await getProjectLocations(projectId);
  return Response.json({ locations });
}

// POST /api/locations
//   { action: "refresh" }        → re-extract now (fired at the end of an
//                                  upload/delete batch, so the picker is warm)
//   { label, kind? }             → add a user-typed zone ("East corridor")
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "refresh") {
    const locations = await getProjectLocations(projectId, { refresh: true });
    return Response.json({ locations });
  }

  const label = String(body.label ?? "").trim();
  if (!label) return Response.json({ error: "Missing label" }, { status: 400 });
  const locations = await addUserZone(projectId, label, body.kind as LocationKind);
  return Response.json({ locations });
}

// DELETE /api/locations?label=… → remove a user-typed zone
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });
  const label = new URL(req.url).searchParams.get("label")?.trim();
  if (!label) return Response.json({ error: "Missing label" }, { status: 400 });
  const locations = await removeUserZone(projectId, label);
  return Response.json({ locations });
}
