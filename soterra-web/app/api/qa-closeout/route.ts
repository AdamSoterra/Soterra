import { auth } from "@clerk/nextjs/server";
import { resolveScope } from "@/lib/company";
import { analytics } from "@/lib/qaCloseout";

// The QA close-out scorecard for the selected site: defect tiles + a
// worst-first subcontractor scorecard. The engine already computes it; this
// route only serves it. Company/project scope comes from resolveScope (the
// x-soterra-project header), never from the client, so the numbers are always
// this site's own.
export const runtime = "nodejs";

// GET /api/qa-closeout → { slaWd, tiles, scorecard }
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });
  return Response.json(await analytics(scope));
}
