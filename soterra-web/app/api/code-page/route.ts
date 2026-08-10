import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { codePages } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 30;

// Serve ONE page of the NZ Building Code as a PNG, so a Code citation can be
// opened in the viewer like a manufacturer or determination one.
//
// This used to be the gap: a Code chip linked out to building.govt.nz because
// we held no rendered pages, which meant the most-cited source in the product
// was the one you could not actually look at. The pages are pre-rendered by
// dev/prerender-code.mts and stored in private Blob.
//
// Unlike a manufacturer's manual there is no licence gate here — the Code is
// Crown material MBIE publishes free. Sign-in is still required, because these
// are our own stored renders and not a public asset endpoint. A page we have
// not rendered simply 404s, and the client falls back to linking out, which is
// exactly the old behaviour.
//
//   GET /api/code-page?doc=<document title>&p=14  →  image/png
//
// Keyed on the readable document title rather than the PDF filename, because
// that title is what the assistant writes in its "Source:" line and therefore
// what the client can hand back. Same approach as the manufacturer citations.
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });

  const url = new URL(req.url);
  const doc = url.searchParams.get("doc")?.trim();
  const p = Number(url.searchParams.get("p"));
  if (!doc || !Number.isInteger(p) || p < 1) return new Response("Bad request", { status: 400 });

  // The gate: only a (doc, page) actually in our index can be requested, so no
  // arbitrary blob path can be assembled through this route.
  const [row] = await db
    .select({ imageUrl: codePages.imageUrl })
    .from(codePages)
    .where(and(eq(codePages.doc, doc), eq(codePages.page, p)))
    .limit(1);
  if (!row?.imageUrl) return new Response("Not found", { status: 404 });

  try {
    const got = await get(row.imageUrl, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return new Response("Not found", { status: 404 });
    return new Response(got.stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": got.blob?.contentType || "image/png",
        // Signed-in only, so keep it out of shared caches. A given edition's
        // page never changes; a new amendment is ingested as a new document.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("code-page fetch failed:", e);
    return new Response("Not found", { status: 404 });
  }
}
