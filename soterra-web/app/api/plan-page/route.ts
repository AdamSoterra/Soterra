import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { planPages, projectMembers } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

// Render ONE page of a project's own uploaded plan to a PNG, so a citation can
// show the actual drawing rather than a placeholder. Same rendering path as the
// manufacturer viewer, but this serves PRIVATE customer drawings, so it is
// gated hard:
//   - the request must carry a signed-in Clerk session (the <img> sends the
//     session cookie same-origin),
//   - the user must be a member of the project it names,
//   - the file is read from private Blob by the pathname WE stored, never a
//     path the client supplies.
// The project id travels in the query string because an <img> can't send the
// x-soterra-project header the rest of the app uses; membership is re-checked
// here regardless, so that's not a trust downgrade.
//
//   GET /api/plan-page?project=<id>&doc=<title>&p=1  →  image/png
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });

  const url = new URL(req.url);
  const project = url.searchParams.get("project")?.trim();
  const doc = url.searchParams.get("doc")?.trim();
  const p = Number(url.searchParams.get("p"));
  if (!project || !doc || !Number.isInteger(p) || p < 1) return new Response("Bad request", { status: 400 });

  const [member] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, project), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!member) return new Response("Forbidden", { status: 403 });

  let [row] = await db
    .select({ file: planPages.file })
    .from(planPages)
    .where(and(eq(planPages.projectId, project), eq(planPages.doc, doc), eq(planPages.page, p)))
    .limit(1);

  // The cited page may be a default (1) or slightly off in a long answer. Rather
  // than show nothing, fall back to the sheet's first available page.
  let renderPage = p;
  if (!row?.file) {
    const [alt] = await db
      .select({ file: planPages.file, page: planPages.page })
      .from(planPages)
      .where(and(eq(planPages.projectId, project), eq(planPages.doc, doc)))
      .orderBy(planPages.page)
      .limit(1);
    if (alt?.file) {
      row = { file: alt.file };
      renderPage = alt.page;
    }
  }
  if (!row?.file) return new Response("Not found", { status: 404 });

  try {
    const got = await get(row.file, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return new Response("Fetch failed", { status: 502 });
    const bytes = new Uint8Array(await new Response(got.stream).arrayBuffer());

    const { renderPageAsImage } = await import("unpdf");
    const png = await renderPageAsImage(bytes, renderPage, {
      scale: 2,
      canvasImport: () => import("@napi-rs/canvas"),
    });

    return new Response(Buffer.from(png as ArrayBuffer), {
      headers: {
        "Content-Type": "image/png",
        // Private customer drawing — the browser may cache it, a shared CDN must not.
        "Cache-Control": "private, max-age=600",
      },
    });
  } catch (e) {
    console.error("plan-page render failed:", e);
    return new Response("Render failed", { status: 500 });
  }
}
