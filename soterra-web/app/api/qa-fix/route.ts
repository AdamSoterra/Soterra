import { getFixByToken, markReadyByToken } from "@/lib/qaCloseout";

export const runtime = "nodejs";
export const maxDuration = 60;

// The sub's side of a QA defect - token-authorised, NO login. The sub_token in
// the "Mark it fixed" link proves the holder was sent this exact defect; every
// read + write is scoped to that one defect (see lib/qaCloseout.ts). Deliberately
// public: a sub must be able to close a defect out from a phone without an
// account, or the whole loop dies at a sign-up wall.
//
//   GET  /api/qa-fix?token=…              -> the defect the /fix page renders
//   POST /api/qa-fix {token, note?, photoPath?}
//        -> mark it fixed: sent -> ready, clock stops, the MC is notified.
//        photoPath is the pathname returned by /api/qa-fix/photo (same token).

const MAX_NOTE = 4000;

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const defect = await getFixByToken(token);
  // One generic miss for a bad token: a probe learns nothing.
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

  try {
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
