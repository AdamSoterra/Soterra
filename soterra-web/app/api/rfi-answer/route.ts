import { answerByToken, commentByToken, getRfiThreadByToken, rfiBlobPrefix, rfiByToken, rfiRecipients } from "@/lib/rfi";
import { gateExternal, gateResponse } from "@/lib/externalAuth";
import { sanitizeFiles } from "@/lib/attachments";

export const runtime = "nodejs";
export const maxDuration = 60;

// The consultant's side of an RFI - token-authorised. The token in the emailed
// link proves the holder was sent this exact RFI; everything here is scoped to
// that one RFI's thread (see lib/rfi.ts). On top of the token, the company's
// sign-in gate (lib/externalAuth) can require a Soterra account on the address
// the RFI was sent to - Adam's 2026-09-09 call: sensitive information, every
// external party gets a password. With the gate off it is the original
// no-account flow.
//
//   GET  /api/rfi-answer?token=…            → the thread the page renders
//   POST /api/rfi-answer {token, kind, body, authorName, files?}
//        kind "answer"  → the official answer: open → answered, clock stops
//        kind "comment" → a clarifying note; ball and clock do not move
//        files: {filename, path, bytes, contentType}[] already uploaded via
//               /api/rfi-answer/upload under this RFI's own Blob folder

const MAX_BODY = 20000;

async function gate(token: string) {
  const rfi = await rfiByToken(token);
  if (!rfi || rfi.status === "void" || rfi.status === "draft" || rfi.number == null) return { rfi: null, res: null };
  const g = await gateExternal(rfi.companyId, rfiRecipients(rfi));
  return { rfi, res: g.ok ? null : gateResponse(g) };
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const { rfi, res } = await gate(token);
  // One generic miss for bad token / void / draft: a probe learns nothing.
  if (!rfi) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  if (res) return res;
  const thread = await getRfiThreadByToken(token);
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
  if (text.length > MAX_BODY) return Response.json({ error: "That response is too long." }, { status: 413 });

  const { rfi, res } = await gate(token);
  if (!rfi) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  if (res) return res;
  // Only files under THIS RFI's folder count (the upload door signs nothing else).
  const files = sanitizeFiles(body.files, [rfiBlobPrefix(rfi.projectId, rfi.id)]);
  // The official answer needs words; a comment can be just a file (a marked-up sketch).
  if (!text && (kind === "answer" || !files.length)) return Response.json({ error: "Write the response first." }, { status: 400 });

  try {
    const result =
      kind === "comment"
        ? await commentByToken(token, text, authorName, "link", files)
        : await answerByToken(token, text, authorName, "link", files);

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
