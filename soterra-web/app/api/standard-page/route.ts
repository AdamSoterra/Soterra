import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { canSeeStandardsDemo } from "@/lib/manufacturerIndex";
import { isStandardDemoPage } from "@/lib/standardDemo";

export const runtime = "nodejs";

// Serve ONE pre-rendered page of a standard, from PRIVATE Blob, to accounts
// canSeeStandardsDemo allows. Under STANDARDS_PUBLIC that is every signed-in
// user (Standards NZ confirmed customer use, 2026-08-18); otherwise the founder
// allowlist only. Only a (slug, page) we deliberately rendered can be fetched -
// nothing else routes through here.
//
//   GET /api/standard-page?ref=NZS-3604-2011&p=210  →  image/png
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });
  // The gate. Without an allowed account this route reveals nothing.
  if (!canSeeStandardsDemo(userId)) return new Response("Not found", { status: 404 });

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
