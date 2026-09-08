import { auth, currentUser } from "@clerk/nextjs/server";
import { get, put } from "@vercel/blob";
import { verifiedEmails } from "@/lib/externalAuth";
import { defectForEmail, fixPhotoOf, fixPhotoPrefix } from "@/lib/qaCloseout";

// The portal's copy of /api/qa-fix/photo: the sub's photo of the fix, keyed
// on the signed-in account's verified email instead of a link token.
//   POST /api/portal/photo?table=item|flag&id=…   → upload; returns { path }
//   GET  /api/portal/photo?table=item|flag&id=…&side=sub|consultant → stream
export const runtime = "nodejs";
export const maxDuration = 60;

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const MAX_BYTES = 4 * 1024 * 1024;
const TYPE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function target(req: Request, side: "sub" | "consultant") {
  const { userId } = await auth();
  if (!userId) return null;
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return null;
  const table = url.searchParams.get("table") === "flag" ? "flag" : "item";
  const user = await currentUser();
  return defectForEmail(table, id, verifiedEmails(user as never), side);
}

export async function POST(req: Request) {
  const found = await target(req, "sub");
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  if (found.row.closeoutStatus !== "sent") return Response.json({ error: "This item has already been marked fixed." }, { status: 409 });
  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = TYPE_EXT[contentType];
  if (!ext) return Response.json({ error: "Attach a JPG, PNG or WEBP photo." }, { status: 415 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return Response.json({ error: "The photo was empty." }, { status: 400 });
  if (buf.length > MAX_BYTES) return Response.json({ error: "That photo is too large - please take a smaller one." }, { status: 413 });
  const magicOk =
    (ext === "jpg" && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
    (ext === "png" && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
    (ext === "webp" && buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP");
  if (!magicOk) return Response.json({ error: "That doesn't look like a photo. Attach a JPG, PNG or WEBP." }, { status: 415 });
  if (!TOKEN) return Response.json({ error: "Photo storage is not configured." }, { status: 500 });
  try {
    const { pathname } = await put(`${fixPhotoPrefix(found.row.projectId, found.row.id)}fix.${ext}`, buf, {
      access: "private",
      addRandomSuffix: true,
      contentType,
      token: TOKEN,
    });
    return Response.json({ path: pathname });
  } catch (e) {
    console.error("portal photo upload failed:", e);
    return Response.json({ error: "That didn't upload. Try again in a moment." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const side = new URL(req.url).searchParams.get("side") === "consultant" ? "consultant" : "sub";
  const found = await target(req, side);
  const path = found ? fixPhotoOf(found) : null;
  if (!path) return new Response("Not found", { status: 404 });
  try {
    const got = await get(path, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return new Response("Not found", { status: 404 });
    return new Response(got.stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": got.blob?.contentType || "image/jpeg",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'inline; filename="fix.jpg"',
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("portal photo fetch failed:", e);
    return new Response("Not found", { status: 404 });
  }
}
