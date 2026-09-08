import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { resolveScope } from "@/lib/company";
import { instructionById } from "@/lib/instructions";

// Streams the client's document attached to a CI (private Blob), for a
// member of the site. The path must be THAT instruction's file.
//   GET /api/instructions/file?id=…
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return new Response("No site selected", { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const row = await instructionById(scope, id);
  if (!row?.file) return new Response("Not found", { status: 404 });
  try {
    const got = await get(row.file, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return new Response("Not found", { status: 404 });
    const type = got.blob?.contentType || "application/octet-stream";
    const inline = ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(type);
    return new Response(got.stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${(row.fileName ?? "document").replace(/["\r\n\\]/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("instruction file fetch failed:", e);
    return new Response("Not found", { status: 404 });
  }
}
