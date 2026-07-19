import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { resolveProjectId } from "@/lib/project";
import { docNameFromFilename, indexPdf } from "@/lib/indexPdf";

// Reads a just-uploaded PRIVATE PDF from Blob (by pathname, via get() — a private
// blob isn't fetchable by URL), extracts text page-by-page (unpdf — no native
// deps, serverless-safe), and stores one plan_pages row per page scoped to the
// current site, so the assistant can search it. Re-uploading the same doc name
// replaces its old pages.
export const runtime = "nodejs";
export const maxDuration = 300; // big specs (280pp) take ~30s to extract+index

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

  // The blob pathname returned by the client upload() (already namespaced to this
  // site). Must live under "<projectId>/…" — never trust a cross-site path.
  const pathname = String(body.pathname ?? "").trim();
  const filename = String(body.filename ?? "document.pdf").trim() || "document.pdf";
  if (!pathname || !pathname.startsWith(`${projectId}/`)) {
    return Response.json({ error: "A valid uploaded-file path is required" }, { status: 400 });
  }

  // Pull the private blob back as bytes.
  let buf: Uint8Array;
  try {
    const got = await get(pathname, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) {
      return Response.json({ error: "Couldn't fetch the uploaded file" }, { status: 502 });
    }
    const ab = await new Response(got.stream).arrayBuffer();
    buf = new Uint8Array(ab);
  } catch (e) {
    console.error("blob get error:", e);
    return Response.json({ error: "Couldn't fetch the uploaded file" }, { status: 502 });
  }

  // Extract + store, using the same shared indexer the Procore sync uses.
  const result = await indexPdf({
    projectId,
    doc: docNameFromFilename(filename),
    bytes: buf,
    file: pathname,
  });

  if (!result.ok) {
    const error =
      result.reason === "unreadable"
        ? "Couldn't read that PDF — make sure it's a real PDF, not a scan/photo."
        : "No readable text found — that PDF looks like scanned images (OCR not supported yet).";
    return Response.json({ error }, { status: 422 });
  }

  return Response.json({ doc: result.doc, pages: result.pages, indexed: result.indexed });
}
