import { answerByToken, commentByToken, getRfiThreadByToken } from "@/lib/rfi";

export const runtime = "nodejs";
export const maxDuration = 60;

// The consultant's side of an RFI - token-authorised, NO login. The token in
// the emailed link proves the holder was sent this exact RFI; everything here
// is scoped to that one RFI's thread (see lib/rfi.ts). Deliberately public:
// a consultant must be able to answer without an account, or the whole
// answer-online flow dies at a sign-up wall.
//
//   GET  /api/rfi-answer?token=…            → the thread the page renders
//   POST /api/rfi-answer {token, kind, body, authorName}
//        kind "answer"  → the official answer: open → answered, clock stops
//        kind "comment" → a clarifying note; ball and clock do not move

const MAX_BODY = 20000;

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const thread = await getRfiThreadByToken(token);
  // One generic miss for bad token / void / draft: a probe learns nothing.
  if (!thread) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  return Response.json(thread, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = String(body.token ?? "");
  const kind = String(body.kind ?? "");
  const text = String(body.body ?? "").trim();
  const authorName = typeof body.authorName === "string" ? body.authorName : null;

  // Explicit allowlist. On a public endpoint the STATE-CHANGING action must
  // never be the fallback for a typo'd kind - reject anything unrecognised.
  if (kind !== "answer" && kind !== "comment") {
    return Response.json({ error: "Unknown kind" }, { status: 400 });
  }
  if (!text) return Response.json({ error: "Write the response first." }, { status: 400 });
  if (text.length > MAX_BODY) return Response.json({ error: "That response is too long." }, { status: 413 });

  try {
    const result =
      kind === "comment"
        ? await commentByToken(token, text, authorName)
        : await answerByToken(token, text, authorName);

    if (!result.ok) {
      if (result.error === "not-found") return Response.json({ error: "This link is no longer valid." }, { status: 404 });
      if (result.error === "not-open")
        return Response.json({ error: "This RFI already has an answer logged. Add a comment instead." }, { status: 409 });
      return Response.json({ error: "This RFI is closed - nothing further is needed." }, { status: 409 });
    }
    const thread = await getRfiThreadByToken(token);
    return Response.json({ ok: true, thread });
  } catch (e) {
    // The page always gets parseable JSON, never a bare 500.
    console.error("rfi-answer POST failed:", e);
    return Response.json({ error: "That didn't go through. Try again in a moment." }, { status: 500 });
  }
}
