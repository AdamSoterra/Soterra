import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth, currentUser } from "@clerk/nextjs/server";
import { corrBlobPrefix, corrForEmail } from "@/lib/correspondence";
import { rfiBlobPrefix, rfiRecipients, sentRfiById } from "@/lib/rfi";
import { verifiedEmails } from "@/lib/externalAuth";

// Direct-to-Blob upload token for a PORTAL user replying with files - on a
// piece of correspondence ({corrId}) or on an RFI ({rfiId}). Authorised by the
// signed-in account's verified email matching the item's recipients (same rule
// as /api/portal); the path must live under the item's own folder.
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
        const { userId } = await auth();
        if (!userId) throw new Error("Not signed in");
        let corrId = "";
        let rfiId = "";
        try {
          const payload = JSON.parse(clientPayload || "{}");
          corrId = String(payload.corrId ?? "");
          rfiId = String(payload.rfiId ?? "");
        } catch {
          throw new Error("Bad request");
        }
        const user = await currentUser();
        const emails = verifiedEmails(user as never);
        if (rfiId) {
          const rfi = await sentRfiById(rfiId);
          if (!rfi || !rfiRecipients(rfi).some((e) => emails.includes(e))) throw new Error("Not found");
          if (rfi.status !== "open" && rfi.status !== "answered") throw new Error("This RFI is closed");
          if (!pathname.startsWith(rfiBlobPrefix(rfi.projectId, rfi.id))) throw new Error("Bad upload path");
          return {
            allowedContentTypes: ALLOWED,
            maximumSizeInBytes: 100 * 1024 * 1024,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ rfiId: rfi.id, uploadedBy: userId }),
          };
        }
        const row = await corrForEmail(corrId, emails);
        if (!row) throw new Error("Not found");
        if (row.status !== "sent" && row.status !== "responded") throw new Error("This item is closed");
        if (!pathname.startsWith(corrBlobPrefix(row.projectId, row.id))) throw new Error("Bad upload path");
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: 100 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ corrId: row.id, uploadedBy: userId }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Upload token failed" }, { status: 400 });
  }
}
