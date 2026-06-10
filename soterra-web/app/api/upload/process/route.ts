import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { db } from "@/lib/db";
import { planPages } from "@/lib/schema";

// Reads an uploaded PDF from Blob, extracts text page-by-page (unpdf — no native
// deps, serverless-safe), and stores one plan_pages row per page so the
// assistant can search it. Re-uploading the same doc replaces its old pages.
export const runtime = "nodejs";
export const maxDuration = 300; // big specs (280pp) take ~30s to extract+index

const PROJECT_ID = "1-arthur-road"; // single project for now; multi-project next

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const blobUrl = String(body.blobUrl ?? "");
  const filename = (String(body.filename ?? "document.pdf").trim() || "document.pdf");
  if (!/^https:\/\//.test(blobUrl)) {
    return Response.json({ error: "A valid uploaded-file URL is required" }, { status: 400 });
  }

  // Pull the PDF back from Blob.
  const res = await fetch(blobUrl);
  if (!res.ok) return Response.json({ error: "Couldn't fetch the uploaded file" }, { status: 502 });
  const buf = new Uint8Array(await res.arrayBuffer());

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
    rows.push({ projectId: PROJECT_ID, doc, file: blobUrl, page: i + 1, npages: totalPages, text });
  }
  if (rows.length === 0) {
    return Response.json({ error: "No readable text found — that PDF looks like scanned images (OCR not supported yet)." }, { status: 422 });
  }

  // Replace any prior pages for this doc (so re-uploading refreshes it), then
  // insert the new ones in chunks.
  await db.delete(planPages).where(and(eq(planPages.projectId, PROJECT_ID), eq(planPages.doc, doc)));
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(planPages).values(rows.slice(i, i + CHUNK));
  }

  return Response.json({ doc, pages: totalPages, indexed: rows.length });
}
