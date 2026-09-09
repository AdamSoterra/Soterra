import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { threadUploadTarget } from "@/lib/qaCloseout";
import { defectBlobPrefix } from "@/lib/defectThread";
import { gateExternal } from "@/lib/externalAuth";
import { FILE_TYPES, MAX_FILE_BYTES } from "@/lib/attachments";

// Direct-to-Blob upload token for the SUB writing back on a defect with a
// photo or a file (a shot of the wall, the product data sheet, a marked-up
// sketch), and for the CONSULTANT attaching on the sign-off page. Mirrors
// /api/rfi-answer/upload: the authorisation is the token from the emailed
// link (sub_token or consultant_token, in clientPayload) plus the company's
// sign-in gate, not project membership. The pathname must live under the defect's
// own folder. The "Mark it fixed" photo itself still goes through
// /api/qa-fix/photo - that one is the record of the fix; these are the
// conversation.
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
        const target = await threadUploadTarget(token);
        if (!target) throw new Error("This link is no longer valid");
        const gate = await gateExternal(target.companyId, target.emails);
        if (!gate.ok) throw new Error(gate.reason === "login" ? "Sign in to attach files" : "This link was sent to a different email address");
        if (!target.canNote) throw new Error("This item is closed");
        if (!pathname.startsWith(defectBlobPrefix(target.projectId, target.recordId))) throw new Error("Bad upload path");
        return {
          allowedContentTypes: FILE_TYPES,
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ defectId: target.recordId }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Upload token failed" }, { status: 400 });
  }
}
