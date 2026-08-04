// The shared TF-IDF retrieval used for BOTH a project's plan pages and the
// Building Code corpus. Both carry `.text`, so this is generic over anything
// with text. Extracted from the ask route so it can be measured and tested
// directly rather than only through a live chat.

const SYN: Record<string, string[]> = {
  colour: ["color", "paint", "finish", "resene", "dulux", "schedule"],
  color: ["colour", "paint", "finish", "resene", "dulux", "schedule"],
  paint: ["colour", "resene", "dulux", "finish"],
  fire: ["frr", "fire-rated", "rated", "fhr"],
  rating: ["frr", "fire", "rated"],
  beam: ["lintel", "lvl", "span", "portal", "header", "steel"],
  lintel: ["beam", "lvl", "span", "header"],
  garage: ["carport", "basement", "ground"],
  wall: ["partition", "gib", "plasterboard", "lining", "intertenancy"],
  insulation: ["r-value", "thermal", "batts", "pink"],
  window: ["glazing", "glazed", "joinery"],
  corridor: ["lobby", "circulation", "common"],
  // Manufacturer literature vocabulary. A builder asks "how far apart do the
  // screws go"; the manual says "fastener centres". Without these the query
  // lands on whatever page merely repeats the word "screw" — which on the GIB
  // Site Guide was a page about sanding compound.
  screw: ["screws", "fastener", "fasteners", "fixing", "fixings", "nail", "nails", "centres", "spacing"],
  screws: ["screw", "fastener", "fasteners", "fixing", "fixings", "centres", "spacing"],
  fixing: ["fixings", "fastener", "fasteners", "screw", "screws", "nail", "centres", "spacing"],
  fastener: ["fasteners", "fixing", "fixings", "screw", "screws", "centres", "spacing"],
  spacing: ["centres", "centers", "spacings", "apart", "pitch"],
  centres: ["spacing", "centers", "apart", "pitch"],
  ceiling: ["ceilings", "soffit", "overhead"],
  sheet: ["sheets", "board", "boards", "lining", "linings", "plasterboard"],
  plasterboard: ["gib", "board", "sheet", "lining", "wallboard"],
  brace: ["bracing", "bracline", "braceline", "ezybrace", "bu", "bracing-unit"],
  bracing: ["brace", "braceline", "ezybrace", "bu", "bracing-unit"],
  joint: ["joints", "jointing", "stopping", "stopped", "control", "seam"],
  stud: ["studs", "framing", "frame", "nog", "nogging", "dwang"],
  waterproof: ["waterproofing", "tanking", "membrane", "wet-area", "aqualine"],
  acoustic: ["noise", "sound", "stc", "iic", "rw"],
  noise: ["acoustic", "sound", "stc", "rw"],
  // Everyday word → Code word. These matter more than they look: the Acceptable
  // Solutions are written in a register nobody speaks on site, so the person who
  // needs the answer uses the word the document never contains. F2/AS1 says
  // "Glazing likely to be subject to human impact" and never once says "glass",
  // so "does this window need safety glass" scored ZERO against the clause that
  // answers it until these were added.
  glass: ["glazing", "glazed", "4223", "impact"],
  glazing: ["glass", "glazed", "4223", "impact"],
  handrail: ["handrails", "barrier", "barriers", "balustrade", "graspable"],
  balustrade: ["barrier", "barriers", "handrail", "handrails"],
  barrier: ["balustrade", "handrail", "barriers"],
  smoke: ["alarm", "alarms", "detector", "detectors", "domestic"],
  alarm: ["smoke", "alarms", "detector", "detectors"],
  stair: ["stairs", "stairway", "stairways", "riser", "tread", "going", "pitch"],
  stairs: ["stair", "stairway", "stairways", "riser", "tread", "going"],
  shower: ["wet-area", "wet", "tanking", "waterproofing", "membrane", "splash"],
  clearance: ["clearances", "separation", "gap", "distance"],
  ground: ["finished", "clearance", "paved", "unpaved"],
  pile: ["piles", "foundation", "foundations", "subfloor"],
  deck: ["decks", "decking", "balcony", "threshold"],
};

// Words that carry no retrieval signal but do carry score. People ask whole
// questions ("does this window need safety glass"), and the filler outweighs the
// two words that matter: every long page contains "does/this/need" somewhere, so
// a dense unrelated page can outscore the short clause that actually answers it.
// Deliberately conservative — anything with construction meaning stays, so no
// "fall", "going", "rise", "run", "fire", "door", "over", "under", "clear".
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "by", "with", "from",
  "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "have", "has", "had",
  "i", "we", "you", "my", "our", "your", "it", "its", "this", "that", "these", "those", "there",
  "what", "which", "who", "when", "where", "how", "why", "can", "could", "should", "would", "will",
  "need", "needs", "needed", "want", "get", "got", "use", "used", "any", "some", "much", "many",
  "please", "pls", "me", "us", "about", "as", "so", "just", "also", "here", "than", "then",
]);

export function expand(q: string): string[] {
  const all = (q.toLowerCase().match(/[a-z0-9-]+/g) || []).filter((t) => t.length > 1);
  // Keep the raw terms if the question was ENTIRELY filler, so a odd query still
  // retrieves something rather than nothing.
  const terms = all.filter((t) => !STOP.has(t));
  const base = terms.length ? terms : all;
  const out = new Set(base);
  for (const t of base) for (const s of SYN[t] || []) out.add(s);
  return [...out];
}

export function computeDf(pages: { text: string }[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set(p.text.toLowerCase().match(/[a-z0-9-]{2,}/g) || []);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// BM25 parameters. k1 controls how fast a repeated term stops earning more;
// b controls how hard a long page is penalised for its length.
//
// These matter more here than in ordinary search, because of what our "pages"
// are. A page that ANSWERS a question usually says so ONCE, in one plain
// sentence ("there is no requirement for the application of sill tapes"). A
// page that merely concerns the same topic — a detail drawing — repeats the
// word ten times as labels. Raw frequency scoring therefore ranks the drawing
// above the rule, which is exactly backwards, and it is how the assistant came
// to answer the same question two opposite ways depending on how it happened to
// word its search. Saturation fixes the repetition; normalisation stops a long
// page winning on sheer volume.
const K1 = 1.2;
const B = 0.75;

/**
 * `nDocs` is the size of the corpus `df` was built from, which is NOT always
 * `pages.length`: brandHits scores one manufacturer's pages, and a customer sees
 * only the licence-visible subset, while `df` is always global. Deriving N from
 * the subset made idf(t) = log((N+1)/(df+1))+1 go to zero or NEGATIVE for any
 * term commoner than the subset is large — so inside a brand-scoped search the
 * words that mattered scored nothing and the ranking collapsed (a BPIR cover
 * page outranked the page that answered the question). Pass the real corpus size
 * whenever `pages` is a subset.
 */
export function retrieve<T extends { text: string }>(pages: T[], df: Map<string, number>, q: string, k = 6, nDocs?: number): T[] {
  const terms = expand(q);
  const N = nDocs ?? pages.length ?? 1;
  const idf = (t: string) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;

  // Average page length across whatever set we were handed (the whole corpus, or
  // one manufacturer's pages when called from brandHits) — the baseline a page
  // is judged long or short against.
  // (Deliberately over `pages`, not N: length is judged against the candidates
  // we are actually ranking, whereas idf is a property of the whole corpus.)
  let total = 0;
  for (const p of pages) total += p.text.length;
  const avgLen = total / (pages.length || 1) || 1;

  // The literal words the user typed, in order, before synonym expansion. Used
  // for the adjacency bonus below — synonyms must not take part, or "screw
  // fastener" would count as a phrase the user never wrote.
  const literal = (q.toLowerCase().match(/[a-z0-9-]+/g) || []).filter((t) => t.length > 1);

  const scored = pages
    .map((p) => {
      const low = p.text.toLowerCase();
      const norm = K1 * (1 - B + B * (p.text.length / avgLen));
      let s = 0;
      for (const t of terms) {
        const c = (low.match(new RegExp(`\\b${esc(t)}`, "g")) || []).length;
        if (c) s += idf(t) * ((c * (K1 + 1)) / (c + norm));
      }

      // Adjacency bonus. Bag-of-words scoring ranks a page that LISTS fifty
      // system codes above the page that IS one of them, because the list
      // repeats the common token ("gbsa") more often. But builders ask by
      // identifier — "what's the spec for GBSA 90f?" — and the index/summary
      // page is the wrong answer. So pay for consecutive query words appearing
      // adjacent in the text. Weighted by idf, which keeps it near-silent for
      // ordinary phrases and decisive for a rare code.
      //
      // No trailing \b: the phrase must START on a word boundary, but it may end
      // mid-word, so "sill tape" still matches the manual's "sill tapes". With
      // the boundary there, the one page stating the sill-tape rule scored no
      // phrase bonus at all, purely because the manual wrote it in the plural.
      // (Single terms above are matched the same way, so this is consistent.)
      for (let i = 0; i < literal.length - 1; i++) {
        const [a, b] = [literal[i], literal[i + 1]];
        const hits = (low.match(new RegExp(`\\b${esc(a)}[\\s\\-]?${esc(b)}`, "g")) || []).length;
        // Capped: a phrase appearing twice is a strong signal, appearing twenty
        // times is a drawing legend, not a stronger answer.
        if (hits) s += Math.min(hits, 3) * 1.5 * Math.min(idf(a), idf(b));
      }

      return { s, p };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => x.p);
}

// ─── Manufacturer search ─────────────────────────────────────────────────
//
// Lifted out of the ask route so the exact ranking the assistant sees can be
// evaluated directly (dev/eval-retrieval.mts) rather than only through a live
// chat. The route now calls searchManufacturerPages().

// GIB name their systems with short codes (GBTL 90, GBS 60, GFS 520, GBSA 90f).
// Plain keyword search buries these — the code token is tiny next to common words
// like "wall" and "fire" — so a code question can miss the one page that DEFINES
// the code, or grab a look-alike (GBQSA 90 for GBTL 90). When the query carries a
// code, surface the pages that actually contain that exact code FIRST, so the
// model reads the right system. Codes are written uppercase and (for GIB) start
// with G, which stops this firing on ordinary words. Normalising out spaces and
// hyphens makes "GBTL 90" match "GBTL90"; requiring an exact token stops "GBTL90"
// matching "GBTLA90".
export function codeHits<T extends { text: string }>(pages: T[], query: string, k = 4): T[] {
  const norm = (t: string) => t.toUpperCase().replace(/[\s-]/g, "");
  const codes = [...query.matchAll(/\bG[A-Z]{1,4}\s?-?\s?\d{1,3}[a-z]?\b/gi)].map((m) => norm(m[0]));
  if (codes.length === 0) return [];
  return pages
    .map((p) => {
      const hay = norm(p.text);
      let hits = 0;
      for (const c of codes) hits += hay.split(c).length - 1;
      return { p, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, k)
    .map((x) => x.p);
}

/** Product and system names that identify a manufacturer as surely as the brand
 *  name does. This matters because nobody on site asks about "APL" or "GIB" —
 *  they ask about "Centrafix" or "Fyreline". Without these, a question named
 *  purely by product competes against the whole corpus, and the largest
 *  manufacturer's pages win on sheer volume — which is how a Centrafix question
 *  ends up ranked against 800-odd pages of someone else's manual.
 *  KEEP IN STEP with the brand/product list in the ask route's static prompt. */
const BRAND_ALIASES: Record<string, string[]> = {
  GIB: ["fyreline", "aqualine", "braceline", "noiseline", "barrierline", "weatherline", "ezybrace"],
  APL: ["centrafix", "thermalheart", "altherm", "vantage", "first windows", "metro series", "klima", "minima"],
  Allproof: ["vision channel", "vision shower", "floor waste gully", "vf80"],
  "BOSS Fire": ["fyrebox", "maxicollar", "firemastic", "fastwrap", "firemortar"],
  "James Hardie": ["axon", "villaboard", "secura", "linea"],
  Ryanfire: ["ryanbatt", "sl collar"],
  "Kingspan Thermakraft": ["covertek", "watergate", "thermakraft", "rainarmor", "thermaflash", "thermabar", "aluband", "oneseal"],
  Resene: ["lumbersider", "sonyx", "galvo", "broadwall"],
  ColorSteel: ["colorcote", "maxam", "dridex"],
};

// When a question NAMES a manufacturer (or one of its products), that
// manufacturer's own pages must win.
//
// Plain relevance scoring doesn't give you this, and the bigger the corpus gets
// the worse it reads. GIB is 823 pages; Rondo is 60. Ask "what centres do I fix
// a Rondo track at" and every top hit came back GIB, partly because GIB's pages
// simply outnumber Rondo's, and partly because GIB publish a co-branded "GIB
// Rondo Metal Batten Systems" manual, so the word "Rondo" is scattered through
// the larger corpus too. Answering a Rondo question out of a competitor's manual
// is wrong in the way that matters most here: the brand IS the answer, because
// the same detail has different figures for different makers.
export function brandHits<T extends { manufacturer: string; text: string }>(
  pages: T[],
  df: Map<string, number>,
  q: string,
  k = 5,
  nDocs?: number,
): T[] {
  const brands = [...new Set(pages.map((p) => p.manufacturer))];
  const low = q.toLowerCase();
  const named = brands.filter((b) => {
    if (new RegExp(`\\b${esc(b.toLowerCase())}\\b`).test(low)) return true;
    // Only aliases for a manufacturer we actually hold pages for, so a demo-tier
    // brand that has been filtered out for this user can't be resurrected here.
    return (BRAND_ALIASES[b] || []).some((a) => new RegExp(`\\b${esc(a)}`).test(low));
  });
  if (!named.length) return [];
  const scoped = pages.filter((p) => named.includes(p.manufacturer));
  if (!scoped.length) return [];
  // Score within the brand's own pages, so a small corpus isn't buried by a
  // large one. df stays global — it only weights how rare a word is — so the
  // corpus size must stay global with it.
  return retrieve(scoped, df, q, k, nDocs ?? pages.length);
}

/** Exactly what the assistant is handed for a manufacturer question: exact
 *  system codes first, then the named brand's own pages, then general relevance,
 *  deduped. One definition, so the eval measures the real thing. */
export function searchManufacturerPages<T extends { manufacturer: string; doc: string; page: number; text: string }>(
  pages: T[],
  df: Map<string, number>,
  q: string,
  k = 8,
  /** Size of the corpus `df` was built from — pass it when `pages` has been
   *  filtered (e.g. licence-gated for this user), or idf goes wrong. */
  nDocs?: number,
): T[] {
  const n = nDocs ?? pages.length;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of [...codeHits(pages, q, 4), ...brandHits(pages, df, q, 5, n), ...retrieve(pages, df, q, 6, n)]) {
    const key = `${p.doc}|${p.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= k) break;
  }
  return out;
}

// We can't hand the model a whole page — long pages blow the token budget. The
// naive fix (text.slice(0, LIMIT)) always keeps the START of the page, which on
// a dense drawing sheet or a Code page means the schedule/clause that actually
// answers the question gets dropped. Instead, centre the excerpt on where the
// query terms actually cluster, and only fall back to the head when nothing
// matches. Snaps to whitespace so we don't cut mid-word, and marks elisions so
// the model can tell the excerpt isn't the whole page.
export function excerpt(text: string, q: string, limit = 2800): string {
  if (text.length <= limit) return text;

  const terms = expand(q);
  const low = text.toLowerCase();

  // Score each candidate window by how many term hits fall inside it. Step in
  // reasonably coarse strides — we want the right region, not the optimal byte.
  const hits: number[] = [];
  for (const t of terms) {
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(low))) hits.push(m.index);
  }
  if (hits.length === 0) return text.slice(0, limit) + " …[truncated]";

  hits.sort((a, b) => a - b);
  const stride = Math.max(1, Math.floor(limit / 8));
  let best = 0;
  let bestCount = -1;
  for (let start = 0; start <= text.length - 1; start += stride) {
    const end = start + limit;
    let c = 0;
    for (const h of hits) if (h >= start && h < end) c++;
    if (c > bestCount) {
      bestCount = c;
      best = start;
    }
  }

  // Pull the window back so the first hit isn't flush against the left edge.
  const firstInWindow = hits.find((h) => h >= best) ?? best;
  let start = Math.max(0, Math.min(best, firstInWindow - Math.floor(limit / 6)));
  let end = Math.min(text.length, start + limit);
  start = Math.max(0, end - limit);

  // Snap to whitespace so we don't slice mid-word.
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp !== -1 && sp - start < 40) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp !== -1 && end - sp < 40) end = sp;
  }

  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? " …[truncated]" : "");
}
