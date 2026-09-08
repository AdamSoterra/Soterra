import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { rfiBlobPrefix, rfiByToken, rfiRecipients } from "@/lib/rfi";
import { gateExternal } from "@/lib/externalAuth";
import { FILE_TYPES, MAX_FILE_BYTES } from "@/lib/attachments";

// Direct-to-Blob upload token for the CONSULTANT on an RFI (files on their
// comment or answer: a marked-up sketch, a revised detail). Mirrors
// /api/upload/token but the authorisation is the RFI's answer-link token (in
// clientPayload) plus the company's sign-in gate, not project membership.
// The pathname must live under the RFI's own folder.
export const runtime = "nodejs";

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
        const rfi = await rfiByToken(token);
        if (!rfi || rfi.status === "void" || rfi.status === "draft" || rfi.number == null) throw new Error("This link is no longer valid");
        const gate = await gateExternal(rfi.companyId, rfiRecipients(rfi));
        if (!gate.ok) throw new Error(gate.reason === "login" ? "Sign in to attach files" : "This link was sent to a different email address");
        if (rfi.status !== "open" && rfi.status !== "answered") throw new Error("This RFI is closed");
        if (!pathname.startsWith(rfiBlobPrefix(rfi.projectId, rfi.id))) throw new Error("Bad upload path");
        return {
          allowedContentTypes: FILE_TYPES,
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ rfiId: rfi.id }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Upload token failed" }, { status: 400 });
  }
}
