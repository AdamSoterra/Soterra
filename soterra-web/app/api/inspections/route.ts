import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { extractText, getDocumentProxy } from "unpdf";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/schema";
import { resolveScope } from "@/lib/company";
import { extractInspection, hasUsableText, sameJob } from "@/lib/inspectionExtract";
import { deleteInspection, listInspections, saveInspection, inspectionDetail, isWorkStatus, setItemWorkStatus } from "@/lib/history";

// Inspection reports in → this COMPANY's failure history out. Same upload
// mechanics as the plan indexer (client uploads straight to private Blob, then
// posts the pathname here), but the destination is completely different: plans
// become searchable pages, inspections become counted failures.
export const runtime = "nodejs";
export const maxDuration = 300; // a 23-page report is ~20s to extract + read

// GET /api/inspections            → this company's inspections, newest first
// GET /api/inspections?id=<uuid>  → one inspection + its failed items
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const detail = await inspectionDetail(scope, id);
    if (!detail) return Response.json({ error: "Inspection not found" }, { status: 404 });
    return Response.json(detail);
  }

  const projectOnly = url.searchParams.get("scope") === "project";
  const inspections = await listInspections(scope, { projectOnly });
  return Response.json({ inspections });
}

// POST /api/inspections { pathname, filename, eventId? } → read + file the report
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

  const pathname = String(body.pathname ?? "").trim();
  const filename = String(body.filename ?? "report.pdf").trim() || "report.pdf";
  const eventId = String(body.eventId ?? "").trim() || null;
  // Same rule as the plan indexer: never trust a cross-site blob path.
  if (!pathname || !pathname.startsWith(`${scope.projectId}/`)) {
    return Response.json({ error: "A valid uploaded-file path is required" }, { status: 400 });
  }

  let buf: Uint8Array;
  try {
    const got = await get(pathname, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) {
      return Response.json({ error: "Couldn't fetch the uploaded file" }, { status: 502 });
    }
    buf = new Uint8Array(await new Response(got.stream).arrayBuffer());
  } catch (e) {
    console.error("blob get error:", e);
    return Response.json({ error: "Couldn't fetch the uploaded file" }, { status: 502 });
  }

  let text = "";
  let pages = 0;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const out = await extractText(pdf, { mergePages: true });
    pages = out.totalPages;
    text = String(out.text).replace(/\s+/g, " ").trim();
  } catch (e) {
    console.error("inspection extract error:", e);
    return Response.json({ error: "Couldn't read that PDF — make sure it's a real PDF, not a scan or a photo." }, { status: 422 });
  }

  // Some real reports — seismic site sheets, a facade engineer's mark-ups —
  // are photographs of a page with an annotation layer, and the text layer is
  // a few hundred characters of nothing. Rather than refuse them, hand the PDF
  // straight to the model and let it read the pages. That IS the OCR: no
  // separate engine, no native dependency on a serverless function.
  const scanned = !hasUsableText(text, pages);
  // A scan still has to be a plausible report, not a 400-page photo album.
  if (scanned && pages > 30) {
    return Response.json(
      { error: `That looks like a scan with ${pages} pages, which is too big to read as images. Split it, or use a text PDF.` },
      { status: 422 }
    );
  }
  // The document block has a hard 32 MB request ceiling.
  if (scanned && buf.byteLength > 24 * 1024 * 1024) {
    return Response.json(
      { error: "That scan is too large to read as images — try a smaller or compressed copy." },
      { status: 422 }
    );
  }

  const doc = filename.replace(/\.pdf$/i, "");
  // ⚠️ On the scanned path the pages go to the model as images, so the text
  // anonymiser can't reach names printed on them. Extracted FIELDS are still
  // scrubbed (anonymiseField) and the prompt forbids returning people, so
  // nothing personal is stored — but the pages themselves are seen in full.
  const extracted = await extractInspection({ text, filename, pdf: scanned ? buf : undefined, scanned });

  if (!extracted.isInspectionReport) {
    return Response.json(
      { error: "That doesn't look like an inspection report — it reads more like a proposal, spec or drawing. Nothing was filed." },
      { status: 422 }
    );
  }

  // Same-job check: a report only joins THIS project's register if it is for
  // this job. Blocks a clear mismatch (the report names a different project);
  // when it names none, or the names are too generic to compare, it files.
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  if (sameJob(extracted.projectName, proj?.name ?? null) === false) {
    return Response.json(
      {
        error: `This report is for "${extracted.projectName}", not "${proj?.name}". Nothing was filed — switch to the right project, or check the report.`,
        mismatch: { reportProject: extracted.projectName, currentProject: proj?.name ?? null },
      },
      { status: 422 }
    );
  }

  // If the model pass failed we only have the council's own numbered fail list.
  // On an outright Fail that's complete; on a Partial Pass — where every real
  // defect lives in prose — it would file a report that looks clean when it
  // isn't. A flattering history is worse than no history, so refuse it.
  if (extracted.degraded) {
    return Response.json(
      { error: `Couldn't read that report properly — ${extracted.degradedReason}. Nothing was filed; try again once it's back, so the history doesn't end up looking cleaner than the job was.` },
      { status: 503 }
    );
  }

  const saved = await saveInspection(scope, { doc, file: pathname, eventId, extracted, createdBy: userId });

  return Response.json({
    id: saved.inspectionId,
    doc,
    outcome: extracted.outcome,
    inspectionCode: extracted.inspectionCode,
    inspectionType: extracted.inspectionType,
    inspectedOn: extracted.inspectedOn,
    items: extracted.items.length,
    categories: [...new Set(extracted.items.map((i) => i.category))],
    // Surfaced so the row can say "read 2 of ~25" rather than quietly
    // implying that report only had two things wrong with it.
    underRead: extracted.underRead,
    expectedItems: extracted.expectedItems,
  });
}

// DELETE /api/inspections?id=<uuid> → remove a filed inspection + its items.
//
// A badly-read report used to be permanent: the route had no delete, so the
// only correction was re-uploading a file with the identical name and relying
// on the upsert. Company-scoped through resolveScope like everything else, so
// nobody can delete another builder's history.
// PATCH /api/inspections { itemId, workStatus } — Feature 6: the extracted
// failed items are a live worklist (not_done | in_progress | done).
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId))
    return Response.json({ error: "Bad itemId" }, { status: 400 });
  if (!isWorkStatus(body.workStatus))
    return Response.json({ error: "workStatus must be not_done, in_progress or done" }, { status: 400 });
  const row = await setItemWorkStatus(scope, itemId, body.workStatus);
  if (!row) return Response.json({ error: "Item not found" }, { status: 404 });
  return Response.json({ item: row });
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const ok = await deleteInspection(scope, id);
  if (!ok) return Response.json({ error: "Inspection not found" }, { status: 404 });
  return Response.json({ ok: true });
}
