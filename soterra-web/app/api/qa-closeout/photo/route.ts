import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { resolveScope } from "@/lib/company";
import { fixPhotoForScope, type CloseoutKind } from "@/lib/qaCloseout";

// The sub's photo of a fix, for the site team (any kind). Scoped through
// resolveScope; the path comes from the row, never the client.
//   GET /api/qa-closeout/photo?kind=flag|item|check&id=…
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return new Response("No site selected", { status: 403 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id") ?? "";
  if (kind !== "flag" && kind !== "item" && kind !== "check") return new Response("Bad kind", { status: 400 });
  const path = await fixPhotoForScope(scope, kind as CloseoutKind, id);
  if (!path) return new Response("Not found", { status: 404 });
  try {
    const got = await get(path, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return new Response("Not found", { status: 404 });
    return new Response(got.stream as unknown as ReadableStream, {
      headers: { "Content-Type": got.blob?.contentType || "image/jpeg", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
