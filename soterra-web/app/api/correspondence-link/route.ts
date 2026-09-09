import { corrByToken, corrRecipients, corrView, replyByToken, type CorrAttachment } from "@/lib/correspondence";
import { gateExternal, gateResponse } from "@/lib/externalAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

// The recipient's side of a piece of correspondence - soterra.co.nz/correspondence/<token>.
// Token-authorised like /api/rfi-answer, plus the company's sign-in gate
// (lib/externalAuth): when the company requires it, the holder must also be
// signed in on the address the item was sent to.
//
//   GET  /api/correspondence-link?token=…             → the item + thread
//   POST /api/correspondence-link {token, body, authorName, files?}
//        → a reply into the thread (sent → responded on the first one)

const MAX_BODY = 20000;

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const row = await corrByToken(token);
  if (!row) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  const gate = await gateExternal(row.companyId, corrRecipients(row));
  if (!gate.ok) return gateResponse(gate);
  return Response.json(await corrView(row), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = String(body.token ?? "");
  const text = String(body.body ?? "").trim();
  const authorName = typeof body.authorName === "string" ? body.authorName : null;
  if (text.length > MAX_BODY) return Response.json({ error: "That message is too long." }, { status: 413 });

  const row = await corrByToken(token);
  if (!row) return Response.json({ error: "This link is no longer valid." }, { status: 404 });
  const gate = await gateExternal(row.companyId, corrRecipients(row));
  if (!gate.ok) return gateResponse(gate);

  // Files the recipient uploaded through /api/correspondence-link/upload -
  // only paths under THIS item's own folder are accepted.
  const prefix = `${row.projectId}/correspondence/${row.id}/`;
  const files: CorrAttachment[] = Array.isArray(body.files)
    ? body.files
        .map((f) => ({
          filename: String((f as Record<string, unknown>)?.filename ?? "").slice(0, 160),
          path: String((f as Record<string, unknown>)?.path ?? ""),
          bytes: Math.max(0, Math.floor(Number((f as Record<string, unknown>)?.bytes ?? 0))),
          contentType: String((f as Record<string, unknown>)?.contentType ?? "application/octet-stream").slice(0, 120),
        }))
        .filter((f) => f.path.startsWith(prefix) && f.filename)
        .slice(0, 10)
    : [];
  if (!text && !files.length) return Response.json({ error: "Write the reply first." }, { status: 400 });

  try {
    const result = await replyByToken(token, text, authorName, files, gate.email ?? null);
    if (!result.ok) {
      if (result.error === "not-found") return Response.json({ error: "This link is no longer valid." }, { status: 404 });
      return Response.json({ error: "This item is closed - nothing further is needed." }, { status: 409 });
    }
    // Re-read: the reply may have moved sent → responded.
    const fresh = (await corrByToken(token)) ?? row;
    return Response.json({ ok: true, view: await corrView(fresh) });
  } catch (e) {
    console.error("correspondence-link POST failed:", e);
    return Response.json({ error: "That didn't go through. Try again in a moment." }, { status: 500 });
  }
}
