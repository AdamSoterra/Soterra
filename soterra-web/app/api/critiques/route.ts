import { auth, currentUser } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { resolveScope } from "@/lib/company";
import { createChecklist, deleteChecklist, getChecklist, listChecklists } from "@/lib/checklist";
import { generateProgrammeCritique, type BuildType } from "@/lib/programmeCritique";

// Programme critique: reads an uploaded construction programme (build schedule /
// Gantt) from private Blob and critiques it against this project's scope, plans,
// Code and the council inspection order. Stored as a checklists row with
// kind='programme'; its findings are checklist_items with finding_type + severity.
export const runtime = "nodejs";
// Opus reads the whole programme visually + the project context, then writes
// cited findings. Same envelope as the checklist route.
export const maxDuration = 300;

type Clerkish = { firstName?: string | null; username?: string | null; primaryEmailAddress?: { emailAddress?: string } | null } | null;
function displayName(user: Clerkish): string | null {
  return user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;
}

// GET /api/critiques        → this site's programme critiques (newest last)
// GET /api/critiques?id=…   → one critique, its findings
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const found = await getChecklist(scope, id);
    if (!found || found.checklist.kind !== "programme") return Response.json({ error: "Critique not found" }, { status: 404 });
    return Response.json(found);
  }

  const rows = (await listChecklists(scope)).filter((r) => r.kind === "programme");
  return Response.json({ critiques: rows });
}

// POST /api/critiques  { pathname, filename?, buildType? }
//   pathname = the private Blob path returned by the client upload(), already
//   namespaced to this site. buildType scopes which hold-point rules apply.
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

  // Never trust a cross-site path: the blob must live under "<projectId>/…".
  const pathname = String(body.pathname ?? "").trim();
  const filename = String(body.filename ?? "programme.pdf").trim() || "programme.pdf";
  if (!pathname || !pathname.startsWith(`${scope.projectId}/`)) {
    return Response.json({ error: "A valid uploaded-file path is required" }, { status: 400 });
  }
  const bt = String(body.buildType ?? "").trim().toLowerCase();
  const buildType: BuildType = bt === "residential" || bt === "commercial" ? bt : "unknown";

  // Pull the private blob back as bytes.
  let buf: Uint8Array;
  try {
    const got = await get(pathname, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) {
      return Response.json({ error: "Couldn't fetch the uploaded programme" }, { status: 502 });
    }
    const ab = await new Response(got.stream).arrayBuffer();
    buf = new Uint8Array(ab);
  } catch (e) {
    console.error("blob get error:", e);
    return Response.json({ error: "Couldn't fetch the uploaded programme" }, { status: 502 });
  }

  const result = await generateProgrammeCritique(scope, { pdfBytes: buf, filename, buildType });
  if (!result.ok) {
    // 503 when the assistant itself is down (retryable), 422 when there was
    // genuinely nothing to flag / the file couldn't be read.
    return Response.json({ error: result.message }, { status: result.reason === "failed" ? 503 : 422 });
  }

  const user = await currentUser();
  const title = `${filename.replace(/\.pdf$/i, "")} — critique`.slice(0, 120);
  const row = await createChecklist(scope, {
    kind: "programme",
    title,
    createdByName: displayName(user),
    items: result.findings.map((f) => ({
      title: f.title,
      // Fold the programme task the finding points at into the detail — there's
      // no dedicated activity column, and it's the "where on the schedule" the
      // reader needs.
      detail: f.activity && f.activity !== "—" ? `${f.detail}\n\nProgramme activity: ${f.activity}` : f.detail,
      source: f.source,
      sourceRef: f.sourceRef,
      category: null,
      findingType: f.findingType,
      severity: f.severity,
    })),
  });

  const full = await getChecklist(scope, row.id);
  return Response.json(full, { status: 201 });
}

// DELETE /api/critiques?id=…
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const ok = await deleteChecklist(scope, id);
  if (!ok) return Response.json({ error: "Critique not found" }, { status: 404 });
  return Response.json({ ok: true });
}
