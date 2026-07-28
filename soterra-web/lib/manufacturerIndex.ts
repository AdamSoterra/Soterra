import { inArray } from "drizzle-orm";
import { db } from "./db";
import { manufacturerPages } from "./schema";
import { computeDf } from "./retrieve";

// The shared manufacturer corpus (universal — the same GIB manual answers a
// question on any site, for any company). Loaded once per warm server and
// cached, exactly like the Building Code index, because it's static between
// ingests.
//
// Kept separate from `code_pages` on purpose. Code material is Crown copyright
// under CC BY 4.0 and free to anyone. This is used under a permission we asked
// for in writing, and the citation has to carry a link back to the
// manufacturer's own current document — an obligation the Code corpus doesn't
// have and shouldn't grow.

export type ManufacturerPage = {
  manufacturer: string;
  doc: string;
  file: string;
  page: number;
  npages: number;
  title: string | null;
  text: string;
  sourceUrl: string | null;
};

let MFR_CACHE: { pages: ManufacturerPage[]; df: Map<string, number> } | null = null;

export async function getManufacturerIndex(): Promise<{ pages: ManufacturerPage[]; df: Map<string, number> }> {
  if (MFR_CACHE) return MFR_CACHE;
  // `withdrawn` is excluded here rather than deleted, so a manufacturer who
  // changes their mind is honoured by one UPDATE and a server restart, and the
  // pages are still on hand if they change it back.
  const rows = await db
    .select({
      manufacturer: manufacturerPages.manufacturer,
      doc: manufacturerPages.doc,
      file: manufacturerPages.file,
      page: manufacturerPages.page,
      npages: manufacturerPages.npages,
      title: manufacturerPages.title,
      text: manufacturerPages.text,
      sourceUrl: manufacturerPages.sourceUrl,
    })
    .from(manufacturerPages)
    .where(inArray(manufacturerPages.licence, ["granted", "pending"]));

  const pages: ManufacturerPage[] = rows.map((r) => ({ ...r }));
  MFR_CACHE = { pages, df: computeDf(pages) };
  return MFR_CACHE;
}

/** Drop the cache so a fresh ingest is picked up without a redeploy. */
export function resetManufacturerIndex(): void {
  MFR_CACHE = null;
}

// What the user actually reads after "Source:". The manufacturer name leads,
// because on a structural or fire question the BRAND is the thing that makes an
// answer safe to act on — the same question has different answers for GIB and
// for a competitor's board.
export function manufacturerLabel(p: ManufacturerPage): string {
  return `${p.manufacturer} · ${p.doc}${p.title ? " · " + p.title : ""} · page ${p.page} of ${p.npages}`;
}
