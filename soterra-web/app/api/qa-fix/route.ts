import { fixGateEmails, getFixByToken, markReadyByToken, noteByToken } from "@/lib/qaCloseout";
import { gateExternal, gateResponse } from "@/lib/externalAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

// The sub's side of a QA defect - token-authorised. The sub_token in the
// "Mark it fixed" link proves the holder was sent this exact defect; every
// read + write is scoped to that one defect (see lib/qaCloseout.ts). The
// company's sign-in gate (lib/externalAuth) can additionally require a Soterra
// account on the address the defect was sent to.
//
//   GET  /api/qa-fix?token=…              -> the defect the /fix page renders
//   POST /api/qa-fix {token, note?, photoPath?}
//        -> mark it fixed: sent -> ready, clock stops, the MC is notified.
//        photoPath is the pathname returned by /api/qa-fix/photo (same token).
//   POST /api/qa-fix {token, action: "note", note, authorName?}
//        -> a note on the thread (a question, an update) - the MC is told;
//        the ball does not move.

const MAX_NOTE = 4000;

async function gate(token: string) {
  const g = await fixGateEmails(token);
  if (!g) return { found: false, res: null };
  const r = await gateExternal(g.companyId, g.emails);
  return { found: true, res: r.ok ? null : gateResponse(r) };
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const { found, res } = await gate(token);
  // One generic miss for a bad token: a probe learns nothing.
  if (!found) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  if (res) return res;
  const defect = await getFixByToken(token);
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
  const note = String(body.note ?? "").trim();
  const photoPath = typeof body.photoPath === "string" ? body.photoPath : null;

  if (note.length > MAX_NOTE) return Response.json({ error: "That note is too long." }, { status: 413 });

  const { found, res } = await gate(token);
  if (!found) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  if (res) return res;

  try {
    if (String(body.action ?? "") === "note") {
      const r = await noteByToken(token, note, typeof body.authorName === "string" ? body.authorName : null);
      if (!r.ok) return Response.json({ error: r.error === "empty" ? "Write the note first." : r.error === "closed" ? "This item is closed." : "This link is no longer valid." }, { status: r.error === "not-found" ? 404 : 409 });
      return Response.json({ ok: true, defect: await getFixByToken(token) });
    }
    const result = await markReadyByToken(token, { photoBlobPath: photoPath, note });
    if (!result.ok) {
      if (result.error === "not-found") return Response.json({ error: "This link is no longer valid." }, { status: 404 });
      // Already marked fixed, or the builder moved it on.
      return Response.json({ error: "This item has already been marked fixed." }, { status: 409 });
    }
    const defect = await getFixByToken(token);
    return Response.json({ ok: true, defect });
  } catch (e) {
    // The page always gets parseable JSON, never a bare 500.
    console.error("qa-fix POST failed:", e);
    return Response.json({ error: "That didn't go through. Try again in a moment." }, { status: 500 });
  }
}
