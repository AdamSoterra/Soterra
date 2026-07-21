import { db } from "./db";
import { codePages } from "./schema";
import { computeDf } from "./retrieve";

// The shared Building Code corpus (universal — same for every site and every
// company). Loaded once per warm server and cached, because it's static: the
// whole free MBIE set is ~3,300 pages.
//
// Lifted out of the ask route so the checklist generator can search the same
// index the assistant does, rather than growing a second, drifting copy.

export type CodePage = { doc: string; file: string; page: number; npages: number; title: string | null; text: string };

let CODE_CACHE: { pages: CodePage[]; df: Map<string, number> } | null = null;

export async function getCodeIndex(): Promise<{ pages: CodePage[]; df: Map<string, number> }> {
  if (CODE_CACHE) return CODE_CACHE;
  const rows = await db
    .select({ doc: codePages.doc, file: codePages.file, page: codePages.page, npages: codePages.npages, title: codePages.title, text: codePages.text })
    .from(codePages);
  const pages: CodePage[] = rows.map((r) => ({ doc: r.doc, file: r.file, page: r.page, npages: r.npages, title: r.title, text: r.text }));
  CODE_CACHE = { pages, df: computeDf(pages) };
  return CODE_CACHE;
}

export function codeLabel(p: CodePage): string {
  return `${p.doc}${p.title ? " · " + p.title : ""} · page ${p.page} of ${p.npages}`;
}
