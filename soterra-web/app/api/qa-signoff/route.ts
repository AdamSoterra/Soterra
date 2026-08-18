import { getSignoffByToken, signoffByToken } from "@/lib/qaCloseout";

export const runtime = "nodejs";
export const maxDuration = 60;

// The consultant's side of a QA defect sign-off - token-authorised, NO login.
// The consultant_token in the "Sign it off" link proves the holder was asked to
// sign off this exact defect; everything is scoped to that one defect (see
// lib/qaCloseout.ts).
//
//   GET  /api/qa-signoff?token=…                  -> the defect the /signoff page renders
//   POST /api/qa-signoff {token, decision, note?}
//        decision "approve" -> submitted -> closed
//        decision "reject"  -> back to sent (the sub redoes it)

const MAX_NOTE = 4000;

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
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

  // Explicit allowlist. On a public endpoint neither state change may be the
  // fallback for a typo'd decision - reject anything unrecognised.
  if (decision !== "approve" && decision !== "reject") {
    return Response.json({ error: "Unknown decision" }, { status: 400 });
  }
  if (note.length > MAX_NOTE) return Response.json({ error: "That note is too long." }, { status: 413 });
  // A bounce-back needs a reason so the sub knows what to redo.
  if (decision === "reject" && !note) {
    return Response.json({ error: "Add a note so the sub knows what to put right." }, { status: 400 });
  }

  try {
    const result = await signoffByToken(token, { approve: decision === "approve", note });
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
