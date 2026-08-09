import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { canSeeDemoCorpus } from "@/lib/manufacturerIndex";
import { isStandardDemoPage } from "@/lib/standardDemo";

export const runtime = "nodejs";

// Serve ONE pre-rendered page of a standard, from PRIVATE Blob, ONLY to a
// demo-corpus account. This exists for personal-use evaluation of the standards
// demo: the pages were rendered from Adam's own licensed copy and are shown back
// to his account and no other. Every other signed-in user gets a 404 here, and
// nothing routes to a page we did not deliberately render.
//
//   GET /api/standard-page?ref=NZS-3604-2011&p=210  →  image/png
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });
  // The gate. Without an allowed account this route reveals nothing.
  if (!canSeeDemoCorpus(userId)) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const slug = (url.searchParams.get("ref") || "").toLowerCase();
  const p = Number(url.searchParams.get("p"));

  // Only a (slug, page) we actually rendered can be requested — no arbitrary
  // path can be assembled through this route.
  if (!isStandardDemoPage(slug, p)) return new Response("Not found", { status: 404 });

  try {
    const got = await get(`standard-demo/${slug}/${p}.png`, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return new Response("Not found", { status: 404 });
    return new Response(got.stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": got.blob?.contentType || "image/png",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    console.error("standard-page fetch failed:", e);
    return new Response("Not found", { status: 404 });
  }
}
