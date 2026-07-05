import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { get } from "@vercel/blob";
import { extractText, getDocumentProxy } from "unpdf";
import { db } from "@/lib/db";
import { planPages } from "@/lib/schema";
import { resolveProjectId } from "@/lib/project";

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

  // Extract per-page text.
  let totalPages = 0;
  let pageTexts: string[] = [];
  try {
    const pdf = await getDocumentProxy(buf);
    const out = await extractText(pdf, { mergePages: false });
    totalPages = out.totalPages;
    pageTexts = Array.isArray(out.text) ? out.text : [out.text];
  } catch (e) {
    console.error("extract error:", e);
    return Response.json({ error: "Couldn't read that PDF — make sure it's a real PDF, not a scan/photo." }, { status: 422 });
  }

  const doc = filename.replace(/\.pdf$/i, "");
  const rows = [];
  for (let i = 0; i < pageTexts.length; i++) {
    const text = (pageTexts[i] || "").replace(/\s+/g, " ").trim();
    if (text.length < 10) continue; // skip blank/cover pages
    rows.push({ projectId, doc, file: pathname, page: i + 1, npages: totalPages, text });
  }
  if (rows.length === 0) {
    return Response.json({ error: "No readable text found — that PDF looks like scanned images (OCR not supported yet)." }, { status: 422 });
  }

  // Replace any prior pages for this doc on this site (so re-uploading refreshes
  // it), then insert the new ones in chunks.
  await db.delete(planPages).where(and(eq(planPages.projectId, projectId), eq(planPages.doc, doc)));
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(planPages).values(rows.slice(i, i + CHUNK));
  }

  return Response.json({ doc, pages: totalPages, indexed: rows.length });
}
