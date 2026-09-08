import { auth, currentUser } from "@clerk/nextjs/server";
import { resolveScope } from "@/lib/company";
import { analytics, closeDirect, forwardToConsultant, reject, rejectCheck, reopenDefect, type CloseoutKind } from "@/lib/qaCloseout";

// The QA close-out loop, the site team's side.
//   GET  /api/qa-closeout                → the scorecard (?level=company widens it)
//   POST /api/qa-closeout {kind, id, action, note?, name?, email?}
//        kind   "flag" | "item" | "check"   (qa_flags / inspection_items / checklist_items)
//        action "close"   → closed now, by the site team, from any stage (Adam,
//                           2026-09-09: "close a few or even one and work in the
//                           area can proceed")
//               "reopen"  → back to sent/open
//               "reject"  → bounce a ready item back to the sub with a note
//               "forward" → send a ready CONSULTANT-report item for sign-off
// Company/project scope comes from resolveScope, never from the client.
export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Clerkish = { firstName?: string | null; username?: string | null; primaryEmailAddress?: { emailAddress?: string } | null } | null;
const displayName = (u: Clerkish) => u?.firstName || u?.username || u?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });
  const level = new URL(req.url).searchParams.get("level") === "company" ? "company" as const : "project" as const;
  return Response.json(await analytics(scope, { level }));
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const kind = String(body.kind ?? "");
  if (kind !== "flag" && kind !== "item" && kind !== "check") return Response.json({ error: "Bad kind" }, { status: 400 });
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  const action = String(body.action ?? "");
  const note = String(body.note ?? "").trim().slice(0, 4000) || null;
  const user = await currentUser();
  const byName = displayName(user);

  try {
    if (action === "close") {
      const r = await closeDirect(scope, kind as CloseoutKind, id, { note, byName });
      if (!r.ok) return Response.json({ error: r.error === "already-closed" ? "Already closed." : "Not found." }, { status: 409 });
      return Response.json({ ok: true });
    }
    if (action === "reopen") {
      const r = await reopenDefect(scope, kind as CloseoutKind, id);
      if (!r.ok) return Response.json({ error: "That item isn't closed." }, { status: 409 });
      return Response.json({ ok: true });
    }
    if (action === "reject") {
      const r = kind === "check" ? await rejectCheck(scope, id, note) : await reject(scope, kind as "flag" | "item", id, { note });
      if (!r.ok) return Response.json({ error: "Only an item the sub has marked fixed can be bounced back." }, { status: 409 });
      return Response.json({ ok: true });
    }
    if (action === "forward") {
      if (kind !== "item") return Response.json({ error: "Only an item off a consultant's report goes for sign-off." }, { status: 400 });
      const email = String(body.email ?? "").trim();
      if (!email) return Response.json({ error: "Who signs it off? Add their email." }, { status: 400 });
      const r = await forwardToConsultant(scope, id, { name: String(body.name ?? "").trim() || null, email, byName });
      if (!r.ok) {
        const msg = r.error === "not-consultant" ? "This item didn't come off a consultant's report - close it out directly." : r.error === "bad-email" ? "That email doesn't look right." : "Only an item the sub has marked fixed can be forwarded.";
        return Response.json({ error: msg }, { status: 409 });
      }
      return Response.json({ ok: true, emailStatus: r.emailStatus });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("qa-closeout POST failed:", e);
    return Response.json({ error: "That didn't work just now." }, { status: 500 });
  }
}
