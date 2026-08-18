import { get, put } from "@vercel/blob";
import { fixPhotoByToken, fixPhotoPrefix, fixUploadTarget } from "@/lib/qaCloseout";

// The sub's photo of the fix. Token-authorised, NO login - same rail as the
// rest of the /fix flow. Private Blob, so it has no fetchable URL:
//   POST /api/qa-fix/photo?token=<sub_token>   -> upload; returns { path }
//   GET  /api/qa-fix/photo?token=<sub|consultant token> -> stream the fix photo
//
// The sub is anonymous, so the upload cannot use the signed-in direct-to-Blob
// token flow; it comes through this route (subject to the serverless body cap).
// The blob path is built SERVER-SIDE from the defect's own ids, so one link can
// never write into (or read) another defect's namespace.
export const runtime = "nodejs";
export const maxDuration = 60;

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const MAX_BYTES = 4 * 1024 * 1024; // serverless body cap; the client compresses first
const TYPE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const target = await fixUploadTarget(token);
  if (!target) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  if (!target.canSubmit) return Response.json({ error: "This item has already been marked fixed." }, { status: 409 });

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = TYPE_EXT[contentType];
  if (!ext) return Response.json({ error: "Attach a JPG, PNG or WEBP photo." }, { status: 415 });

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return Response.json({ error: "The photo was empty." }, { status: 400 });
  if (buf.length > MAX_BYTES) return Response.json({ error: "That photo is too large - please take a smaller one." }, { status: 413 });
  // The declared type is not trusted alone: verify the real magic bytes so a
  // holder of a valid link cannot store markup/script under an image/* label.
  const magicOk =
    (ext === "jpg" && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
    (ext === "png" && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
    (ext === "webp" && buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP");
  if (!magicOk) return Response.json({ error: "That doesn't look like a photo. Attach a JPG, PNG or WEBP." }, { status: 415 });
  if (!TOKEN) return Response.json({ error: "Photo storage is not configured." }, { status: 500 });

  try {
    const { pathname } = await put(`${fixPhotoPrefix(target.projectId, target.recordId)}fix.${ext}`, buf, {
      access: "private",
      addRandomSuffix: true, // unguessable path, and no collision on a resend
      contentType,
      token: TOKEN,
    });
    return Response.json({ path: pathname });
  } catch (e) {
    console.error("qa-fix photo upload failed:", e);
    return Response.json({ error: "That didn't upload. Try again in a moment." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const path = await fixPhotoByToken(token);
  if (!path) return new Response("Not found", { status: 404 });
  try {
    const got = await get(path, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return new Response("Not found", { status: 404 });
    return new Response(got.stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": got.blob?.contentType || "image/jpeg",
        // nosniff + inline disposition: the bytes came from an anonymous
        // uploader, so never let the browser sniff them as anything but the
        // declared image type. Defense in depth behind the upload allowlist.
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'inline; filename="fix.jpg"',
        // Private + immutable: the path carries a random suffix, so the bytes
        // at a path never change.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("qa-fix photo fetch failed:", e);
    return new Response("Not found", { status: 404 });
  }
}
