import { auth } from "@clerk/nextjs/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerPages } from "@/lib/schema";

export const runtime = "nodejs";

// The list of manufacturer documents we hold, one row per document, with its
// live source URL and page count. The assistant's answers cite these by name
// and page; the client uses this list to turn a "Source: GIB · <doc> · page 14"
// line into a working citation card, page image and verify link — WITHOUT
// depending on the model to echo the URL in its answer, which it doesn't always
// do. This is the source of truth for the citation UI, not the model's text.
//
//   GET /api/manufacturer-docs → { docs: [{ manufacturer, doc, sourceUrl, npages }] }
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ docs: [] }, { status: 401 });

  const rows = await db
    .select({
      manufacturer: manufacturerPages.manufacturer,
      doc: manufacturerPages.doc,
      sourceUrl: sql<string>`max(${manufacturerPages.sourceUrl})`,
      npages: sql<number>`max(${manufacturerPages.npages})::int`,
    })
    .from(manufacturerPages)
    .where(inArray(manufacturerPages.licence, ["granted", "pending"]))
    .groupBy(manufacturerPages.manufacturer, manufacturerPages.doc);

  return Response.json(
    { docs: rows },
    // The set changes only when we ingest, so let the browser hold it briefly.
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
