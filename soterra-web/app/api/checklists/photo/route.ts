import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { resolveScope } from "@/lib/company";
import { photoIsOurs } from "@/lib/checklist";

// Site photos live in PRIVATE Blob storage, so they have no fetchable URL —
// this route is the only way to see one. It re-checks, per request, that the
// photo belongs to a checklist inside the caller's own company before it
// streams a single byte.
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return new Response("No site selected", { status: 403 });

  const path = new URL(req.url).searchParams.get("path");
  if (!path) return new Response("path required", { status: 400 });
  if (!(await photoIsOurs(scope, path))) return new Response("Not found", { status: 404 });

  try {
    const got = await get(path, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return new Response("Not found", { status: 404 });
    return new Response(got.stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": got.blob?.contentType || "image/jpeg",
        // Private + immutable: the blob path carries a random suffix, so the
        // bytes at a path never change.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("photo fetch error:", e);
    return new Response("Not found", { status: 404 });
  }
}
