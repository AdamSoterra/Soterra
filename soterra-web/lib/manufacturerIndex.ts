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

/**
 * Which licence states are served to users. One list, imported everywhere, so
 * retrieval, the citation map and the page-image endpoint can never drift apart
 * and start serving something one of them believes is withheld.
 *
 *   granted  — permission in writing. The steady state.
 *   pending  — asked, and they were positive; served while the paperwork lands.
 *   demo     — their own PUBLIC pages, held ONLY so we can record a short demo
 *              showing that manufacturer how their content would be quoted and
 *              cited, to help them decide. Kept as its own tier rather than
 *              lumped in with `pending` because "we emailed and they have not
 *              replied" is a materially weaker footing than "they said yes",
 *              and that difference should be visible in the data rather than
 *              remembered. Promote to `pending`/`granted` on a yes; delete on a
 *              no. See dev/demo-corpus.mts.
 *   withdrawn — kept on disk, never served. A change of mind is one UPDATE.
 */
export const SERVED_LICENCES = ["granted", "pending", "demo"] as const;

export type ManufacturerPage = {
  manufacturer: string;
  doc: string;
  file: string;
  page: number;
  npages: number;
  title: string | null;
  text: string;
  sourceUrl: string | null;
  licence: string;
};

/**
 * Who may see `demo`-tier pages: a comma-separated list of Clerk user ids in
 * DEMO_CORPUS_USERS. Everyone else is served exactly as if those pages did not
 * exist.
 *
 * This gate is the difference between "we recorded a demo for you" and "we put
 * your copyrighted material in our product before you answered". James Hardie,
 * Rondo and Ryanfire all publish terms REQUIRING written agreement before their
 * literature is reproduced commercially, and none of them has answered yet.
 * They are also competitors of each other and of GIB — and a GIB technical
 * manager already has a live account here. Serving one manufacturer's manual to
 * another's staff inside a product that is asking all of them for permission is
 * the kind of unforced error that loses every one of those conversations at
 * once. So demo pages reach the founder's own accounts and nobody else.
 */
export function canSeeDemoCorpus(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const allow = (process.env.DEMO_CORPUS_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.includes(userId);
}

/** Drop `demo` pages unless this caller is allowed to see them. */
export function visibleTo<T extends { licence: string }>(pages: T[], userId: string | null | undefined): T[] {
  if (canSeeDemoCorpus(userId)) return pages;
  return pages.filter((p) => p.licence !== "demo");
}

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
      licence: manufacturerPages.licence,
    })
    .from(manufacturerPages)
    .where(inArray(manufacturerPages.licence, [...SERVED_LICENCES]));

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
