import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectMembers } from "@/lib/schema";

// Direct-to-Blob upload token. The browser calls upload() with access:'private',
// handleUploadUrl → here; we authorise it. The client PUTs the PDF straight to
// Vercel Blob (bypassing the ~4.5 MB serverless body limit), then posts the
// resulting blob pathname to /api/upload/process for extraction + indexing.
//
// Guardrails (server-side, can't be bypassed by the client):
//  • the caller must be a MEMBER of the site they're uploading to, and
//  • the blob pathname must live under that site's folder: "<projectId>/…".
export const runtime = "nodejs";

async function isMember(projectId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return !!m;
}

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const { userId } = await auth();
        if (!userId) throw new Error("Not signed in");

        let projectId = "";
        try {
          projectId = String(JSON.parse(clientPayload || "{}").projectId ?? "");
        } catch {
          throw new Error("Missing site");
        }
        if (!projectId) throw new Error("No site selected");
        if (!(await isMember(projectId, userId))) throw new Error("Not a member of this site");
        // Files are namespaced by site (the trailing slash makes the prefix exact),
        // so one site can never write into — or later read — another's blobs.
        if (!pathname.startsWith(`${projectId}/`)) throw new Error("Bad upload path");

        // Site photos on a checklist go up the same way as plans, so images are
        // allowed too — but only under "<projectId>/checklists/", so a photo
        // token can't be used to slip a JPEG into the plan set.
        const isPhoto = pathname.startsWith(`${projectId}/checklists/`);
        return {
          allowedContentTypes: isPhoto ? ["image/jpeg", "image/png", "image/webp"] : ["application/pdf"],
          maximumSizeInBytes: isPhoto ? 12 * 1024 * 1024 : 100 * 1024 * 1024, // 12 MB a photo, 100 MB a drawing set
          addRandomSuffix: true, // avoid collisions + make URLs unguessable
          tokenPayload: JSON.stringify({ uploadedBy: userId, projectId }),
        };
      },
      // Client owns the post-upload step (it calls /process), so nothing to do here.
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Upload token failed" }, { status: 400 });
  }
}
