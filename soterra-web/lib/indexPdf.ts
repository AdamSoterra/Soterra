import { and, eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { db } from "@/lib/db";
import { planPages } from "@/lib/schema";
import { detectDocType } from "@/lib/docType";

// The shared indexing core: PDF bytes in, one plan_pages row per readable page
// out, scoped to a site. Deliberately knows nothing about auth or where the
// bytes came from, so a manual upload and a doc pulled from an external source
// (Procore) can both land in the same searchable index the same way.

export type IndexPdfResult =
  // "unreadable" = not a real PDF / couldn't be parsed at all.
  // "no-text" = parsed fine but every page was blank, i.e. a scan (no OCR yet).
  | { ok: false; reason: "unreadable" | "no-text" }
  | { ok: true; doc: string; pages: number; indexed: number };

// Strip the extension so "A-101 Ground Floor.pdf" indexes (and re-indexes) under
// a stable doc name. Both callers must derive it the same way or a refresh would
// insert a duplicate doc instead of replacing the old one.
export function docNameFromFilename(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

export async function indexPdf({
  projectId,
  doc,
  bytes,
  file,
}: {
  projectId: string;
  doc: string;
  bytes: Uint8Array;
  /** Blob pathname we can fetch the original back from, stored on every row. */
  file: string;
}): Promise<IndexPdfResult> {
  // Extract per-page text.
  let totalPages = 0;
  let pageTexts: string[] = [];
  try {
    // Copy first: getDocumentProxy posts the buffer to a pdf.js worker, which
    // DETACHES it. Without this, indexPdf would consume the caller's bytes and
    // any retry on the same buffer would fail as "unreadable".
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const out = await extractText(pdf, { mergePages: false });
    totalPages = out.totalPages;
    pageTexts = Array.isArray(out.text) ? out.text : [out.text];
  } catch (e) {
    console.error("extract error:", e);
    return { ok: false, reason: "unreadable" };
  }

  const rows = [];
  for (let i = 0; i < pageTexts.length; i++) {
    const text = (pageTexts[i] || "").replace(/\s+/g, " ").trim();
    if (text.length < 10) continue; // skip blank/cover pages
    rows.push({ projectId, doc, file, page: i + 1, npages: totalPages, text });
  }
  if (rows.length === 0) return { ok: false, reason: "no-text" };

  // Classify the document once — filename first, first readable page as the
  // tiebreak — and stamp every row with it. The Documents tab can override.
  const docType = detectDocType(doc, rows[0].text);
  const typedRows = rows.map((r) => ({ ...r, docType }));

  // Replace any prior pages for this doc on this site (so re-indexing refreshes
  // it rather than duplicating), then insert the new ones in chunks.
  await db.delete(planPages).where(and(eq(planPages.projectId, projectId), eq(planPages.doc, doc)));
  const CHUNK = 100;
  for (let i = 0; i < typedRows.length; i += CHUNK) {
    await db.insert(planPages).values(typedRows.slice(i, i + CHUNK));
  }

  return { ok: true, doc, pages: totalPages, indexed: typedRows.length };
}
