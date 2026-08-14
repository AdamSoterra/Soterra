// ─── Cached plan-page rendering ───────────────────────────────────────────
//
// Opening a drawing used to render the PDF page to an image on every request,
// which is slow and repeated the work each time. This renders ONCE, stores the
// PNG in private Blob, records the pathname on the plan_pages row, and serves
// the stored image thereafter (same pattern as the Code / manufacturer pages).
//
// It applies to ANY uploaded document lazily: the first time a page is viewed
// it renders + caches; every view after is instant. `thumb` produces the small
// render used by the Plans preview grid.
//
// The caller (the route) is responsible for AUTHORISING the project first;
// this only takes an already-verified projectId.

import { get, put } from "@vercel/blob";
import { and, asc, eq } from "drizzle-orm";
import { db } from "./db";
import { planPages } from "./schema";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const FULL_SCALE = 2; // crisp full page for the viewer
const THUMB_SCALE = 0.4; // small preview for the grid

/** PNG bytes for a plan page, rendering + caching on the first request.
 *  Returns null when the sheet or its source file is missing. */
export async function planPageImage(
  projectId: string,
  doc: string,
  page: number,
  opts?: { thumb?: boolean }
): Promise<ArrayBuffer | null> {
  const thumb = !!opts?.thumb;

  let [row] = await db
    .select({ id: planPages.id, file: planPages.file, page: planPages.page, imageUrl: planPages.imageUrl, thumbUrl: planPages.thumbUrl })
    .from(planPages)
    .where(and(eq(planPages.projectId, projectId), eq(planPages.doc, doc), eq(planPages.page, page)))
    .limit(1);

  // The cited page can be a default (1) or slightly off; fall back to the
  // sheet's first available page rather than showing nothing.
  let renderPage = page;
  if (!row?.file) {
    const [alt] = await db
      .select({ id: planPages.id, file: planPages.file, page: planPages.page, imageUrl: planPages.imageUrl, thumbUrl: planPages.thumbUrl })
      .from(planPages)
      .where(and(eq(planPages.projectId, projectId), eq(planPages.doc, doc)))
      .orderBy(asc(planPages.page))
      .limit(1);
    if (!alt?.file) return null;
    row = alt;
    renderPage = alt.page;
  }

  // Cache hit → serve the stored render.
  const cached = thumb ? row.thumbUrl : row.imageUrl;
  if (cached) {
    try {
      const got = await get(cached, { access: "private" });
      if (got && got.statusCode === 200 && got.stream) {
        return await new Response(got.stream).arrayBuffer();
      }
      // stale pathname → fall through and re-render
    } catch {
      /* re-render below */
    }
  }

  // Miss → render from the source PDF.
  let buf: Buffer;
  try {
    const src = await get(row.file!, { access: "private" });
    if (!src || src.statusCode !== 200 || !src.stream) return null;
    const bytes = new Uint8Array(await new Response(src.stream).arrayBuffer());
    const { renderPageAsImage } = await import("unpdf");
    const png = await renderPageAsImage(bytes, renderPage, {
      scale: thumb ? THUMB_SCALE : FULL_SCALE,
      canvasImport: () => import("@napi-rs/canvas"),
    });
    buf = Buffer.from(png as ArrayBuffer);
  } catch (e) {
    console.error("plan render failed:", e);
    return null;
  }

  // Cache it (best-effort — never fail the response if the store hiccups).
  try {
    if (TOKEN) {
      const { pathname } = await put(`planpage/${projectId}/${row.id}${thumb ? "-thumb" : ""}.png`, buf, {
        access: "private",
        addRandomSuffix: true,
        contentType: "image/png",
        token: TOKEN,
      });
      await db
        .update(planPages)
        .set(thumb ? { thumbUrl: pathname } : { imageUrl: pathname })
        .where(eq(planPages.id, row.id));
    }
  } catch (e) {
    console.error("plan render cache-store failed:", e);
  }

  // Return a clean ArrayBuffer (a valid Response body in strict TS). A Node
  // Buffer is always backed by an ArrayBuffer, never a SharedArrayBuffer.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
