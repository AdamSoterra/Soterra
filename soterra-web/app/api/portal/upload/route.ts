import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth, currentUser } from "@clerk/nextjs/server";
import { corrBlobPrefix, corrForEmail } from "@/lib/correspondence";
import { verifiedEmails } from "@/lib/externalAuth";

// Direct-to-Blob upload token for a PORTAL user replying on a piece of
// correspondence with files. Authorised by the signed-in account's verified
// email matching the item's recipients (same rule as /api/portal); the path
// must live under the item's own folder.
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
        try {
          corrId = String(JSON.parse(clientPayload || "{}").corrId ?? "");
        } catch {
          throw new Error("Bad request");
        }
        const user = await currentUser();
        const row = await corrForEmail(corrId, verifiedEmails(user as never));
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
