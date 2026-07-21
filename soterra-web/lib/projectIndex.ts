import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/db";
import { planPages } from "@/lib/schema";
import { computeDf } from "@/lib/retrieve";
import { currentRevisionsOnly } from "@/lib/sheetRev";
import indexData from "@/data/arthur-road-index.json";

export const DEMO_ID = "1-arthur-road"; // the seeded demo site keeps its bundled plan index

export type Page = {
  doc: string; disc: string; file: string; page: number; npages: number;
  code: string; title: string; text: string; uploadedAt?: number;
};
const INDEX = indexData as unknown as Page[];

export type ProjectIndex = { pages: Page[]; df: Map<string, number> };

// ── Cache ────────────────────────────────────────────────────────────────
// This used to reload EVERY page of the project from Neon and rebuild the
// TF-IDF term map on EVERY question. Fine at 120 sheets (55ms); measured at
// 1,201ms of pure CPU for a 2,500-page school set and 1,965ms at 5,000 —
// before the network time to pull 6-12MB, and before the model writes a token.
//
// So we cache per project, keyed on a cheap fingerprint rather than a timer:
// one indexed COUNT+MAX(created_at) aggregate tells us whether the plan set
// changed. That keeps the original "a fresh upload shows up immediately"
// guarantee (a re-index changes both count and max) while skipping the heavy
// load whenever nothing has changed. Self-invalidating — no cache-busting call
// to forget on the upload path.
const MAX_CACHED_PROJECTS = 8; // ~6MB each worst case; bounded so memory can't run away
const CACHE = new Map<string, { fingerprint: string; index: ProjectIndex }>();

async function fingerprint(projectId: string): Promise<string> {
  const [row] = await db
    .select({ n: raw<number>`count(*)::int`, latest: raw<string | null>`max(${planPages.createdAt})` })
    .from(planPages)
    .where(eq(planPages.projectId, projectId));
  return `${row?.n ?? 0}:${row?.latest ?? "-"}`;
}

/** Drop a project's cached index. Not required for correctness (the fingerprint
 *  handles that) — exposed for tests and for any future out-of-band mutation. */
export function invalidateProjectIndex(projectId: string): void {
  CACHE.delete(projectId);
}

/** For tests: how many projects are currently cached. */
export function cachedProjectCount(): number {
  return CACHE.size;
}

// A project's plan index: uploaded pages (Neon plan_pages) + the bundled demo
// set for the demo site.
export async function getProjectIndex(projectId: string): Promise<ProjectIndex> {
  const fp = await fingerprint(projectId);
  const hit = CACHE.get(projectId);
  if (hit && hit.fingerprint === fp) {
    // Refresh recency for the LRU eviction below.
    CACHE.delete(projectId);
    CACHE.set(projectId, hit);
    return hit.index;
  }

  const rows = await db
    .select({
      doc: planPages.doc, file: planPages.file, page: planPages.page, npages: planPages.npages,
      code: planPages.code, title: planPages.title, disc: planPages.disc, text: planPages.text,
      createdAt: planPages.createdAt,
    })
    .from(planPages)
    .where(eq(planPages.projectId, projectId));

  let pages: Page[] = rows.map((r) => ({
    doc: r.doc, disc: r.disc ?? "", file: r.file ?? "", page: r.page, npages: r.npages,
    code: r.code ?? "", title: r.title ?? "", text: r.text, uploadedAt: r.createdAt?.getTime() ?? 0,
  }));
  if (projectId === DEMO_ID) pages = [...INDEX.map((p) => ({ ...p, uploadedAt: 0 })), ...pages];

  // Drop superseded revisions BEFORE anything else sees them. Uploading
  // "…-Rev.3" doesn't overwrite "…-Rev.1" (different doc name, so the
  // replace-by-doc in indexPdf can't fire), which left both revisions in the
  // corpus and a superseded detail could be retrieved and cited.
  pages = currentRevisionsOnly(pages);
  // Newest-first so, where two pages still tie, the latest-uploaded wins.
  pages.sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));

  const index: ProjectIndex = { pages, df: computeDf(pages) };

  CACHE.delete(projectId);
  CACHE.set(projectId, { fingerprint: fp, index });
  while (CACHE.size > MAX_CACHED_PROJECTS) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
  return index;
}
