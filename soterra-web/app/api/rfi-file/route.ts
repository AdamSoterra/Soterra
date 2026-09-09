import { auth, currentUser } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rfis } from "@/lib/schema";
import { resolveScope } from "@/lib/company";
import { rfiByToken, rfiPathBelongsTo, rfiRecipients, sentRfiById } from "@/lib/rfi";
import { gateExternal, verifiedEmails } from "@/lib/externalAuth";

// Streams one file of an RFI (its own, or on a line of the thread) out of the
// private Blob store. Three doors, one rule - the path must be one of THAT
// RFI's files (rfiPathBelongsTo), never the folder alone:
//   ?id=<rfi id>&path=…          the builder (member of the site, header)
//   ?token=<answer token>&path=… the consultant's link (+ the sign-in gate)
//   ?portal=<rfi id>&path=…      a signed-in external whose verified email the
//                                RFI was sent to
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
    if (!scope) return new Response("Forbidden", { status: 403 });
    [row] = await db.select().from(rfis).where(and(eq(rfis.id, id), eq(rfis.projectId, scope.projectId))).limit(1);
  } else if (token) {
    row = await rfiByToken(token);
    if (row && (row.status === "void" || row.status === "draft" || row.number == null)) row = null;
    if (row) {
      const gate = await gateExternal(row.companyId, rfiRecipients(row));
      if (!gate.ok) return new Response(gate.reason === "login" ? "Sign in" : "Forbidden", { status: gate.reason === "login" ? 401 : 403 });
    }
  } else if (portal) {
    if (!userId) return new Response("Not signed in", { status: 401 });
    if (!UUID_RE.test(portal)) return new Response("Not found", { status: 404 });
    const user = await currentUser();
    const emails = verifiedEmails(user as never);
    const candidate = await sentRfiById(portal);
    row = candidate && rfiRecipients(candidate).some((e) => emails.includes(e)) ? candidate : null;
  }
  if (!row) return new Response("Not found", { status: 404 });

  const att = await rfiPathBelongsTo(row, path);
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
    console.error("rfi-file fetch failed:", e);
    return new Response("Not found", { status: 404 });
  }
}
