import { getSignoffByToken, noteByConsultantToken, signoffByToken, signoffGateEmails, threadUploadTarget } from "@/lib/qaCloseout";
import { defectBlobPrefix } from "@/lib/defectThread";
import { sanitizeFiles } from "@/lib/attachments";
import { gateExternal, gateResponse } from "@/lib/externalAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

// The consultant's side of a QA defect sign-off - token-authorised. The
// consultant_token in the "Sign it off" link proves the holder was asked to
// sign off this exact defect; everything is scoped to that one defect (see
// lib/qaCloseout.ts). The company's sign-in gate (lib/externalAuth) can
// additionally require a Soterra account on the address it was sent to.
//
//   GET  /api/qa-signoff?token=…                  -> the defect the /signoff page renders
//   POST /api/qa-signoff {token, decision, note?, files?}
//        decision "approve" -> submitted -> closed
//        decision "reject"  -> back to sent (the sub redoes it)
//        files = what /api/qa-fix/upload signed under this defect's folder
//        (a marked-up photo of what to redo); they go on the thread line and
//        ride in the emails.
//   POST /api/qa-signoff {token, action: "note", note, files?}
//        -> a note on the thread without deciding (a question back to the
//        builder, "send me the north face"); the builder is told. Words,
//        files, or both.

const MAX_NOTE = 4000;

async function gate(token: string) {
  const g = await signoffGateEmails(token);
  if (!g) return { found: false, res: null };
  const r = await gateExternal(g.companyId, g.emails);
  return { found: true, res: r.ok ? null : gateResponse(r) };
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const { found, res } = await gate(token);
  if (!found) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  if (res) return res;
  const defect = await getSignoffByToken(token);
  if (!defect) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  return Response.json(defect, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = String(body.token ?? "");
  const decision = String(body.decision ?? "");
  const note = String(body.note ?? "").trim();
  if (note.length > MAX_NOTE) return Response.json({ error: "That note is too long." }, { status: 413 });

  if (String(body.action ?? "") === "note") {
    const { found, res } = await gate(token);
    if (!found) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
    if (res) return res;
    try {
      const target = await threadUploadTarget(token);
      const files = target ? sanitizeFiles(body.files, [defectBlobPrefix(target.projectId, target.recordId)]) : [];
      const r = await noteByConsultantToken(token, note, files);
      if (!r.ok) return Response.json({ error: r.error === "empty" ? "Write the note first, or attach a file." : r.error === "closed" ? "This item is closed." : "This link is no longer valid." }, { status: r.error === "not-found" ? 404 : 409 });
      return Response.json({ ok: true, defect: await getSignoffByToken(token) });
    } catch (e) {
      console.error("qa-signoff note failed:", e);
      return Response.json({ error: "That didn't go through. Try again in a moment." }, { status: 500 });
    }
  }

  // Explicit allowlist. On a public endpoint neither state change may be the
  // fallback for a typo'd decision - reject anything unrecognised.
  if (decision !== "approve" && decision !== "reject") {
    return Response.json({ error: "Unknown decision" }, { status: 400 });
  }
  // A bounce-back needs a reason so the sub knows what to redo.
  if (decision === "reject" && !note) {
    return Response.json({ error: "Add a note so the sub knows what to put right." }, { status: 400 });
  }

  const { found, res } = await gate(token);
  if (!found) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  if (res) return res;

  try {
    const target = await threadUploadTarget(token);
    const files = target ? sanitizeFiles(body.files, [defectBlobPrefix(target.projectId, target.recordId)]) : [];
    const result = await signoffByToken(token, { approve: decision === "approve", note, files });
    if (!result.ok) {
      if (result.error === "not-found") return Response.json({ error: "This link is no longer valid." }, { status: 404 });
      return Response.json({ error: "This item has already been actioned." }, { status: 409 });
    }
    const defect = await getSignoffByToken(token);
    return Response.json({ ok: true, approved: result.approved, defect });
  } catch (e) {
    console.error("qa-signoff POST failed:", e);
    return Response.json({ error: "That didn't go through. Try again in a moment." }, { status: 500 });
  }
}
