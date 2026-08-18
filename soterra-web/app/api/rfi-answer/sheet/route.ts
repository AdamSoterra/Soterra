import { tokenSheetPng } from "@/lib/rfi";

export const runtime = "nodejs";
// Rendering a sheet + pins takes real time on big drawings.
export const maxDuration = 60;

// The pinned drawing for the public answer page, token-authorised like the
// thread itself. The engine refuses any sheet this RFI did not actually pin,
// so the token cannot be used to browse the drawing set.
//   GET /api/rfi-answer/sheet?token=…&doc=…&page=3  → PNG
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const doc = url.searchParams.get("doc") ?? "";
  const page = Number(url.searchParams.get("page") ?? "");
  if (!doc || !Number.isInteger(page) || page < 1) return new Response("Bad request", { status: 400 });

  const png = await tokenSheetPng(token, doc, page);
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // Private to the link-holder; a day of caching keeps reloads instant.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
