import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { extractText, getDocumentProxy } from "unpdf";
import { resolveScope } from "@/lib/company";
import { extractInspection } from "@/lib/inspectionExtract";
import { listInspections, saveInspection, inspectionDetail } from "@/lib/history";

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

  // Low-text guard. Some real reports (facade photo mark-ups, seismic site
  // sheets) are entirely images with a text layer of a few hundred characters.
  // Without this the extractor happily returns zero items and the report looks
  // clean — the worst possible failure for a history that's meant to be honest.
  if (text.length < 400 || text.length / Math.max(pages, 1) < 250) {
    return Response.json(
      { error: "That report is mostly images — there's not enough readable text to pull the items out. A text PDF (not a scan) works; photo-only reports need to be entered by hand for now." },
      { status: 422 }
    );
  }

  const doc = filename.replace(/\.pdf$/i, "");
  const extracted = await extractInspection({ text, filename });

  if (!extracted.isInspectionReport) {
    return Response.json(
      { error: "That doesn't look like an inspection report — it reads more like a proposal, spec or drawing. Nothing was filed." },
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
  });
}
