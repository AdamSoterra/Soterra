import { auth, currentUser } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { resolveProjectId } from "@/lib/project";
import { corrById, corrByToken, corrForEmail, corrRecipients, pathBelongsTo } from "@/lib/correspondence";
import { gateExternal, verifiedEmails } from "@/lib/externalAuth";
import { resolveScope } from "@/lib/company";

// Streams one attachment of a piece of correspondence out of the private Blob
// store. Three doors, one rule - the path must be one of THAT item's files:
//   ?id=<corr id>&path=…           the builder (member of the site, header)
//   ?token=<link token>&path=…     the recipient's link (+ the sign-in gate)
//   ?portal=<corr id>&path=…       a signed-in external whose verified email
//                                  the item was addressed to
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeName(name: string): string {
  return name.replace(/["\r\n\\]/g, "").slice(0, 150) || "file";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  if (!path) return new Response("Not found", { status: 404 });

  const { userId } = await auth();
  let row = null;
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  const portal = url.searchParams.get("portal");
  if (id) {
    if (!userId) return new Response("Not signed in", { status: 401 });
    if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });
    const scope = await resolveScope(req, userId);
    const projectId = scope?.projectId ?? (await resolveProjectId(req, userId));
    if (!scope || !projectId) return new Response("Forbidden", { status: 403 });
    row = await corrById(scope, id);
  } else if (token) {
    row = await corrByToken(token);
    if (row) {
      const gate = await gateExternal(row.companyId, corrRecipients(row));
      if (!gate.ok) return new Response(gate.reason === "login" ? "Sign in" : "Forbidden", { status: gate.reason === "login" ? 401 : 403 });
    }
  } else if (portal) {
    if (!userId) return new Response("Not signed in", { status: 401 });
    if (!UUID_RE.test(portal)) return new Response("Not found", { status: 404 });
    const user = await currentUser();
    row = await corrForEmail(portal, verifiedEmails(user as never));
  }
  if (!row) return new Response("Not found", { status: 404 });

  const att = await pathBelongsTo(row, path);
  if (!att) return new Response("Not found", { status: 404 });
  try {
    const got = await get(path, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return new Response("Not found", { status: 404 });
    const inlineTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    const type = got.blob?.contentType || att.contentType || "application/octet-stream";
    return new Response(got.stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${inlineTypes.includes(type) ? "inline" : "attachment"}; filename="${safeName(att.filename)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("corr-file fetch failed:", e);
    return new Response("Not found", { status: 404 });
  }
}
