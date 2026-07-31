import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerPages } from "@/lib/schema";
import { SERVED_LICENCES, canSeeDemoCorpus } from "@/lib/manufacturerIndex";

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
    .select({
      sourceUrl: manufacturerPages.sourceUrl,
      npages: manufacturerPages.npages,
      licence: manufacturerPages.licence,
      imageUrl: manufacturerPages.imageUrl,
    })
    .from(manufacturerPages)
    .where(
      and(
        eq(manufacturerPages.manufacturer, m),
        eq(manufacturerPages.doc, doc),
        eq(manufacturerPages.page, p),
        inArray(manufacturerPages.licence, [...SERVED_LICENCES]),
      ),
    )
    .limit(1);

  if (!row?.sourceUrl && !row?.imageUrl) return new Response("Not found", { status: 404 });
  // Same gate as retrieval: a demo-tier page renders only for an allowed
  // account. Without this, a guessed manufacturer + document + page would render
  // an ungranted manufacturer's page for anyone signed in.
  if (row.licence === "demo" && !canSeeDemoCorpus(userId)) return new Response("Not found", { status: 404 });

  // Documents whose PDFs don't embed their fonts render blank on the Linux
  // serverless runtime, so those pages were pre-rendered locally and stored in
  // private Blob. Stream the stored PNG (the gate above already passed).
  if (row.imageUrl) {
    try {
      const got = await get(row.imageUrl, { access: "private" });
      if (got?.statusCode === 200 && got.stream) {
        return new Response(got.stream as unknown as ReadableStream, {
          headers: {
            "Content-Type": got.blob?.contentType || "image/png",
            "Cache-Control": "private, max-age=31536000, immutable",
          },
        });
      }
      // Fall through to a live render if the stored image can't be read.
    } catch (e) {
      console.error("doc-page stored image fetch failed:", e);
    }
  }

  if (!row.sourceUrl) return new Response("Not found", { status: 404 });
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
