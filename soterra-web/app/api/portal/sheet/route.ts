import { auth, currentUser } from "@clerk/nextjs/server";
import { rfiRecipients, sentRfiById, tokenSheetPng, rfiByToken } from "@/lib/rfi";
import { verifiedEmails } from "@/lib/externalAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

// The pinned drawing for an RFI opened from the portal: authorised by the
// signed-in account's verified email matching the RFI's recipients, then the
// same engine call as the token route (which refuses any sheet the RFI did
// not pin).
//   GET /api/portal/sheet?id=…&doc=…&page=3  → PNG
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Sign in", { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const doc = url.searchParams.get("doc") ?? "";
  const page = Number(url.searchParams.get("page") ?? "");
  if (!doc || !Number.isInteger(page) || page < 1) return new Response("Bad request", { status: 400 });
  const rfi = await sentRfiById(id);
  if (!rfi || !rfi.answerToken) return new Response("Not found", { status: 404 });
  const user = await currentUser();
  const mine = verifiedEmails(user as never);
  if (!rfiRecipients(rfi).some((e) => mine.includes(e))) return new Response("Not found", { status: 404 });
  // Re-resolve through the token path so the pin scoping is the engine's.
  const viaToken = await rfiByToken(rfi.answerToken);
  if (!viaToken) return new Response("Not found", { status: 404 });
  const png = await tokenSheetPng(rfi.answerToken, doc, page);
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
}
