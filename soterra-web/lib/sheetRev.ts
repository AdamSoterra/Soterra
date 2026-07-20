// Sheet identity + revision, parsed out of a drawing's filename.
//
// Superseding used to work only when the new upload had the BYTE-IDENTICAL doc
// name, but 95 of Kauri Tower's 120 sheets carry the revision in the filename
// ("S7.10-MIDFLOOR-PENETRATION-DETAILS-Rev.1"). So uploading Rev.3 left Rev.1
// sitting in the search corpus next to it, and a superseded detail could be
// retrieved and cited. Parsing the revision out gives every sheet a stable
// identity across revisions, so retrieval can keep only the current one.

export type SheetRev = {
  /** Stable identity for a sheet across its revisions (normalised, lowercase). */
  sheetKey: string;
  /** Sortable revision. Numeric revs use their number, alpha revs A=1, B=2…
   *  null when the filename carries no revision at all. */
  rev: number | null;
  /** What the filename actually said ("1", "C"), for display. */
  revLabel: string | null;
};

// Trailing "Rev 3" / "-Rev.1" / "_REVISION C" / "Rev-AA". Deliberately requires
// the word "rev": a bare trailing "-C" is far too easy to confuse with part of a
// real sheet name, and a wrong split silently merges two different drawings.
//
// NB: anchored with an explicit separator class, NOT \b — underscore is a word
// character, so \b never fires between "_" and "REVISION" and every
// underscore-separated filename silently parsed as having no revision.
// "revision" must precede "rev" in the alternation or it matches the prefix and
// then fails on the remainder.
const REV_RE = /(?:^|[-_ .])(?:revision|rev)[-_ .]*([A-Za-z]{1,2}|\d{1,3})\s*$/i;

/** A=1 … Z=26, AA=27 … Mirrors how drawings actually escalate revisions. */
function alphaToNumber(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function parseSheetRev(docName: string): SheetRev {
  const m = docName.match(REV_RE);
  if (!m) return { sheetKey: normaliseKey(docName), rev: null, revLabel: null };
  const raw = m[1];
  const rev = /^\d+$/.test(raw) ? parseInt(raw, 10) : alphaToNumber(raw);
  return { sheetKey: normaliseKey(docName.slice(0, m.index)), rev, revLabel: raw.toUpperCase() };
}

// Collapse the cosmetic differences between two exports of the same sheet
// (separators, case, trailing punctuation) so they group together.
function normaliseKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|[-.\s]+$/g, "")
    .trim();
}

/**
 * Keep only the CURRENT revision of each sheet.
 *
 * Highest parsed revision wins. Ties, missing revisions, or a sheet that mixes
 * numeric and alpha schemes fall back to most-recently-uploaded, so we degrade
 * to the old newest-wins behaviour rather than guessing wrong.
 */
export function currentRevisionsOnly<T extends { doc: string; uploadedAt?: number }>(pages: T[]): T[] {
  // doc -> its identity. Group by sheetKey, decide a winning doc per key.
  const byKey = new Map<string, { doc: string; rev: number | null; at: number }[]>();
  const seen = new Set<string>();
  for (const p of pages) {
    if (seen.has(p.doc)) continue;
    seen.add(p.doc);
    const { sheetKey, rev } = parseSheetRev(p.doc);
    const list = byKey.get(sheetKey) ?? [];
    list.push({ doc: p.doc, rev, at: p.uploadedAt ?? 0 });
    byKey.set(sheetKey, list);
  }

  const winners = new Set<string>();
  for (const list of byKey.values()) {
    if (list.length === 1) {
      winners.add(list[0].doc);
      continue;
    }
    const best = list.reduce((a, b) => {
      if (a.rev !== null && b.rev !== null && a.rev !== b.rev) return b.rev > a.rev ? b : a;
      return b.at > a.at ? b : a; // no usable revs, or a tie — newest upload wins
    });
    winners.add(best.doc);
  }

  return pages.filter((p) => winners.has(p.doc));
}
