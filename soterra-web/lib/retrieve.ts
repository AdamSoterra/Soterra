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
};

export function expand(q: string): string[] {
  const terms = (q.toLowerCase().match(/[a-z0-9-]+/g) || []).filter((t) => t.length > 1);
  const out = new Set(terms);
  for (const t of terms) for (const s of SYN[t] || []) out.add(s);
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

export function retrieve<T extends { text: string }>(pages: T[], df: Map<string, number>, q: string, k = 6): T[] {
  const terms = expand(q);
  const N = pages.length || 1;
  const idf = (t: string) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  const scored = pages
    .map((p) => {
      const low = p.text.toLowerCase();
      let s = 0;
      for (const t of terms) {
        const c = (low.match(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")) || []).length;
        if (c) s += (1 + Math.log(c)) * idf(t);
      }
      return { s, p };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => x.p);
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
