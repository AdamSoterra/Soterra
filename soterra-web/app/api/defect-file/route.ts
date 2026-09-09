import { auth, currentUser } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { resolveScope } from "@/lib/company";
import { defectPathBelongsTo } from "@/lib/defectThread";
import { defectByAnyToken, defectForEmail, defectForScope, photoGateEmails, subEmailsOf, type CloseoutKind, type FoundDefect } from "@/lib/qaCloseout";
import { gateExternal, verifiedEmails } from "@/lib/externalAuth";

// Streams one file off a defect's thread (a photo the sub sent back, a sketch
// the builder wrote to them with, a file that came in on an email reply) out
// of the private Blob store. Three doors, one rule - the path must be on THAT
// defect's thread (defectPathBelongsTo), never the folder alone:
//   ?kind=flag|item|check&id=<uuid>&path=…   the builder (member of the site;
//                                             ?project= rides on a plain link)
//   ?token=<sub or consultant token>&path=…  either party's emailed link
//                                             (+ the company's sign-in gate)
//   ?portal=<uuid>&table=…&side=sub|consultant&path=…
//                                             a signed-in external whose
//                                             verified email it was sent to
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeName(name: string): string {
  return name.replace(/["\r\n\\]/g, "").slice(0, 150) || "file";
}
function kindOf(t: string | null): CloseoutKind {
  return t === "flag" ? "flag" : t === "check" ? "check" : "item";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  if (!path) return new Response("Not found", { status: 404 });

  const { userId } = await auth();
  let found: FoundDefect | null = null;
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  const portal = url.searchParams.get("portal");
  if (id) {
    if (!userId) return new Response("Not signed in", { status: 401 });
    if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });
    const scope = await resolveScope(req, userId);
    if (!scope) return new Response("Forbidden", { status: 403 });
    found = await defectForScope(scope, kindOf(url.searchParams.get("kind")), id);
  } else if (token) {
    found = await defectByAnyToken(token);
    if (found) {
      // The same gate as the /fix and /signoff pages: whichever token this is,
      // the holder must be signed in on an address the item went to (when the
      // company requires it).
      const g = await photoGateEmails(token);
      const gate = await gateExternal(found.row.companyId, g?.emails ?? subEmailsOf(found));
      if (!gate.ok) return new Response(gate.reason === "login" ? "Sign in" : "Forbidden", { status: gate.reason === "login" ? 401 : 403 });
    }
  } else if (portal) {
    if (!userId) return new Response("Not signed in", { status: 401 });
    if (!UUID_RE.test(portal)) return new Response("Not found", { status: 404 });
    const user = await currentUser();
    const emails = verifiedEmails(user as never);
    const side = url.searchParams.get("side") === "consultant" ? "consultant" : "sub";
    found = await defectForEmail(kindOf(url.searchParams.get("table")), portal, emails, side);
  }
  if (!found) return new Response("Not found", { status: 404 });

  const att = await defectPathBelongsTo(found.kind, found.row.id, path);
  if (!att) return new Response("Not found", { status: 404 });
  try {
    const got = await get(path, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return new Response("Not found", { status: 404 });
    const inlineTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    const type = got.blob?.contentType || att.contentType || "application/octet-stream";
    return new Response(got.stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": type,
        // The bytes came from an outside party: never let the browser sniff
        // them into anything but the declared type.
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${inlineTypes.includes(type) ? "inline" : "attachment"}; filename="${safeName(att.filename)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("defect-file fetch failed:", e);
    return new Response("Not found", { status: 404 });
  }
}
