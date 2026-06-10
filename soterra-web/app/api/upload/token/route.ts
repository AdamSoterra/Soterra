import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@clerk/nextjs/server";

// Direct-to-Blob upload: the browser asks this route for a one-shot token, then
// PUTs the PDF straight to Vercel Blob — bypassing the ~4.5 MB serverless body
// limit so big plan sets (tens of MB) upload fine. After upload, the client
// posts the Blob URL to /api/upload/process for extraction + indexing.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const { userId } = await auth();
        if (!userId) throw new Error("Not signed in");
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB — full drawing sets
          tokenPayload: JSON.stringify({ uploadedBy: userId }),
        };
      },
      // Client owns the post-upload step (calls /process), so nothing to do here.
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Upload token failed" }, { status: 400 });
  }
}
