import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { determinationPages } from "@/lib/schema";

export const runtime = "nodejs";
// Fetching a determination PDF from MBIE and rendering a page takes a few
// seconds cold; some determinations run to 70+ pages.
export const maxDuration = 60;

// Render ONE page of an MBIE determination to a PNG, so a citation can be
// verified in-app against the actual ruling.
//
// Determinations are published by MBIE under CC BY 4.0 at a stable URL derived
// from the reference, so we don't host the PDFs: we fetch the original and
// render the cited page. The reference is checked against our own table first,
// so this can't be turned into an open render proxy for arbitrary URLs.
//
//   GET /api/determination-page?ref=2024/001&p=3  →  image/png
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });

  const url = new URL(req.url);
  const ref = url.searchParams.get("ref")?.trim();
  const p = Number(url.searchParams.get("p"));
  if (!ref || !/^\d{4}\/\d{3}$/.test(ref) || !Number.isInteger(p) || p < 1) {
    return new Response("Bad request", { status: 400 });
  }

  // Only render a page we actually indexed. This is the gate: an arbitrary
  // reference or page number renders nothing.
  const [row] = await db
    .select({ npages: determinationPages.npages, file: determinationPages.file })
    .from(determinationPages)
    .where(and(eq(determinationPages.ref, ref), eq(determinationPages.page, p)))
    .limit(1);
  if (!row) return new Response("Not found", { status: 404 });

  const [year] = ref.split("/");
  const src = `https://www.building.govt.nz/assets/Uploads/resolving-problems/determinations/${year}/${row.file}`;

  try {
    // building.govt.nz refuses requests without a browser user-agent.
    const res = await fetch(src, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
      redirect: "follow",
    });
    if (!res.ok) return new Response("Source fetch failed", { status: 502 });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") return new Response("Source fetch failed", { status: 502 });

    const { renderPageAsImage } = await import("unpdf");
    const png = await renderPageAsImage(bytes, p, { scale: 2, canvasImport: () => import("@napi-rs/canvas") });

    return new Response(Buffer.from(png as ArrayBuffer), {
      headers: {
        "Content-Type": "image/png",
        // Signed-in only, so keep it out of shared caches. (ref, page) is
        // immutable: MBIE does not revise a published determination in place.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("determination-page render failed:", e);
    return new Response("Render failed", { status: 500 });
  }
}
