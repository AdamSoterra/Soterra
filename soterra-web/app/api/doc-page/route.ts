import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerPages } from "@/lib/schema";

export const runtime = "nodejs";
// Fetching a manufacturer PDF and rendering a page can take a few seconds cold.
export const maxDuration = 60;

// Render ONE page of a manufacturer document to a PNG, so the assistant's
// citation can be verified in-app by looking at the actual page.
//
// Why render server-side to an image rather than embed the PDF: an <iframe> to
// a PDF shows blank in an Android WebView (and inconsistently on mobile
// browsers), which is exactly where this app runs. An <img> renders everywhere.
//
// The page's source URL is looked up from our own table by (manufacturer, doc,
// page) — the client never passes a URL, so this can't be turned into an open
// render proxy, and we only ever render a document we actually hold under
// permission.
//
//   GET /api/doc-page?m=GIB&doc=<title>&p=14  →  image/png
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });

  const url = new URL(req.url);
  const m = url.searchParams.get("m")?.trim();
  const doc = url.searchParams.get("doc")?.trim();
  const p = Number(url.searchParams.get("p"));
  if (!m || !doc || !Number.isInteger(p) || p < 1) return new Response("Bad request", { status: 400 });

  const [row] = await db
    .select({ sourceUrl: manufacturerPages.sourceUrl, npages: manufacturerPages.npages })
    .from(manufacturerPages)
    .where(
      and(
        eq(manufacturerPages.manufacturer, m),
        eq(manufacturerPages.doc, doc),
        eq(manufacturerPages.page, p),
        inArray(manufacturerPages.licence, ["granted", "pending"]),
      ),
    )
    .limit(1);

  if (!row?.sourceUrl) return new Response("Not found", { status: 404 });

  try {
    const res = await fetch(row.sourceUrl);
    if (!res.ok) return new Response("Source fetch failed", { status: 502 });
    const bytes = new Uint8Array(await res.arrayBuffer());

    const { renderPageAsImage } = await import("unpdf");
    const png = await renderPageAsImage(bytes, p, {
      scale: 2,
      canvasImport: () => import("@napi-rs/canvas"),
    });

    return new Response(Buffer.from(png as ArrayBuffer), {
      headers: {
        "Content-Type": "image/png",
        // (m, doc, page) → the same image forever, so let the CDN keep it.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("doc-page render failed:", e);
    return new Response("Render failed", { status: 500 });
  }
}
