import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { corrByToken, corrBlobPrefix, corrRecipients } from "@/lib/correspondence";
import { gateExternal } from "@/lib/externalAuth";

// Direct-to-Blob upload token for the RECIPIENT of a piece of correspondence
// (their reply's attachments). Mirrors /api/upload/token but the authorisation
// is the item's link token (in clientPayload) plus the company's sign-in gate,
// not project membership. The pathname must live under the item's own folder.
export const runtime = "nodejs";

const ALLOWED = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "application/acad",
  "image/vnd.dwg",
  "application/octet-stream",
];

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let token = "";
        try {
          token = String(JSON.parse(clientPayload || "{}").token ?? "");
        } catch {
          throw new Error("Bad request");
        }
        const row = await corrByToken(token);
        if (!row) throw new Error("This link is no longer valid");
        const gate = await gateExternal(row.companyId, corrRecipients(row));
        if (!gate.ok) throw new Error(gate.reason === "login" ? "Sign in to attach files" : "This link was sent to a different email address");
        if (row.status !== "sent" && row.status !== "responded") throw new Error("This item is closed");
        if (!pathname.startsWith(corrBlobPrefix(row.projectId, row.id))) throw new Error("Bad upload path");
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: 100 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ corrId: row.id }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Upload token failed" }, { status: 400 });
  }
}
