import { auth } from "@clerk/nextjs/server";
import { resolveProjectId } from "@/lib/project";
import { getProjectLocations } from "@/lib/locations";

export const runtime = "nodejs";
// The model call can take a few seconds on a cold cache; this endpoint should be
// hit once when the check-creation picker opens (and ideally warmed at ingest).
export const maxDuration = 60;

// GET /api/locations → the physical locations a QA check can be scoped to for the
// current project, derived from its own uploaded drawing titles. Empty array =
// nothing named a place, so the UI offers free-typing.
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const projectId = await resolveProjectId(req, userId);
  if (!projectId) return Response.json({ error: "No site selected" }, { status: 403 });
  const locations = await getProjectLocations(projectId);
  return Response.json({ locations });
}
