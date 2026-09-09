// ─── Client / contract instructions — the register ───────────────────────
//
// A CI is a formal change to what the drawings say: "the client wants a
// pendant light over the kitchen island", "engineer's instruction: add a
// 2/90x45 nog at 1000 AFL". It arrives by email, letter or on a form, and
// somebody on site has to (a) keep it on record, (b) let the assistant know
// the drawings are amended, and (c) make sure the crew actually builds it.
//
// (a) is this register. (b) is search_directives on the ask route, which
// reads these rows. (c) is the generator in lib/checklist.ts: every open
// instruction that touches a check's trade or location becomes the FIRST
// item on that check ("cable in for the additional pendant, as per CI-003"
// on the electrical check; "ceiling nog for the pendant, as per CI-003" on
// the pre-line). Adam, 2026-09-09: "make sure this is item number one on the
// generated related QA list."
//
// Numbers are burned on creation (a CI exists the moment it is issued; there
// is no draft). The client's own document is attached as a private Blob; a
// PDF has its text extracted so the register is searchable and the generator
// can read the instruction in the client's own words.

import { and, desc, eq } from "drizzle-orm";
import { get } from "@vercel/blob";
import { extractText, getDocumentProxy } from "unpdf";
import { db } from "./db";
import { contractInstructions, rfiMessages } from "./schema";
import type { ContractInstruction } from "./schema";
import type { Scope } from "./company";
import { CATEGORIES, isCategory, type Category } from "./categories";

export const ISSUERS = ["client", "architect", "engineer", "other"] as const;
export type Issuer = (typeof ISSUERS)[number];
export const ISSUER_LABEL: Record<Issuer, string> = { client: "Client", architect: "Architect", engineer: "Engineer", other: "Other" };
const isIssuer = (v: unknown): v is Issuer => typeof v === "string" && (ISSUERS as readonly string[]).includes(v);

export function ciLabel(c: { number: number }): string {
  return `CI-${String(c.number).padStart(3, "0")}`;
}
export function parseTrades(json: string | null | undefined): Category[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter(isCategory) : [];
  } catch {
    return [];
  }
}
function parseAmends(json: string | null | undefined): { doc: string; fromRev?: string; toRev?: string }[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((a) => a && typeof a.doc === "string") : [];
  } catch {
    return [];
  }
}

export type CiInput = {
  title: string;
  body?: string | null;
  issuedBy?: Issuer | null;
  issuedByName?: string | null;
  dateIssued?: Date | null;
  location?: string | null;
  trades?: string[];
  amendsDrawings?: { doc: string; fromRev?: string; toRev?: string }[];
  cost?: string | null;
  sourceRfiId?: string | null;
  sourceCorrId?: string | null;
};

function clean(input: Partial<CiInput>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = {};
  if (input.title !== undefined) set.title = input.title.trim().slice(0, 200);
  if (input.body !== undefined) set.body = input.body?.trim().slice(0, 20000) || null;
  if (input.issuedBy !== undefined) set.issuedBy = isIssuer(input.issuedBy) ? input.issuedBy : null;
  if (input.issuedByName !== undefined) set.issuedByName = input.issuedByName?.trim().slice(0, 160) || null;
  if (input.dateIssued !== undefined) set.dateIssued = input.dateIssued ?? null;
  if (input.location !== undefined) set.location = input.location?.trim().slice(0, 120) || null;
  if (input.trades !== undefined) {
    const t = (input.trades ?? []).filter(isCategory);
    set.trades = t.length ? JSON.stringify([...new Set(t)]) : null;
  }
  if (input.amendsDrawings !== undefined) {
    const a = (input.amendsDrawings ?? []).map((d) => ({ doc: String(d.doc).trim().slice(0, 120), fromRev: d.fromRev?.trim() || undefined, toRev: d.toRev?.trim() || undefined })).filter((d) => d.doc).slice(0, 20);
    set.amendsDrawings = a.length ? JSON.stringify(a) : null;
  }
  if (input.cost !== undefined) set.cost = input.cost?.trim().slice(0, 120) || null;
  return set;
}

export async function createInstruction(scope: Scope, input: CiInput, by: { userId?: string | null; name?: string | null }): Promise<ContractInstruction> {
  const [maxRow] = await db
    .select({ number: contractInstructions.number })
    .from(contractInstructions)
    .where(eq(contractInstructions.projectId, scope.projectId))
    .orderBy(desc(contractInstructions.number))
    .limit(1);
  const number = (maxRow?.number ?? 0) + 1;
  const set = clean(input);
  const [row] = await db
    .insert(contractInstructions)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      number,
      title: set.title || "Instruction",
      body: set.body ?? null,
      issuedBy: set.issuedBy ?? null,
      issuedByName: set.issuedByName ?? null,
      dateIssued: set.dateIssued ?? new Date(),
      location: set.location ?? null,
      trades: set.trades ?? null,
      amendsDrawings: set.amendsDrawings ?? null,
      cost: set.cost ?? null,
      sourceRfiId: input.sourceRfiId ?? null,
      sourceCorrId: input.sourceCorrId ?? null,
      createdBy: by.userId ?? null,
      createdByName: by.name ?? null,
    })
    .returning();
  return row;
}

async function ours(scope: Scope, id: string): Promise<ContractInstruction | null> {
  const [row] = await db
    .select()
    .from(contractInstructions)
    .where(and(eq(contractInstructions.id, id), eq(contractInstructions.projectId, scope.projectId)))
    .limit(1);
  return row ?? null;
}
export const instructionById = ours;

export async function updateInstruction(scope: Scope, id: string, input: Partial<CiInput>): Promise<ContractInstruction> {
  const row = await ours(scope, id);
  if (!row) throw new Error("Not found");
  const set = clean(input);
  if (set.title === "") delete set.title;
  set.updatedAt = new Date();
  const [updated] = await db.update(contractInstructions).set(set).where(eq(contractInstructions.id, id)).returning();
  return updated;
}

export async function setInstructionStatus(scope: Scope, id: string, status: "open" | "done" | "void"): Promise<ContractInstruction> {
  const row = await ours(scope, id);
  if (!row) throw new Error("Not found");
  const [updated] = await db.update(contractInstructions).set({ status, updatedAt: new Date() }).where(eq(contractInstructions.id, id)).returning();
  return updated;
}

/** Where a CI's document lives. Namespaced by project + CI. */
export function ciBlobPrefix(projectId: string, ciId: string): string {
  return `${projectId}/instructions/${ciId}/`;
}

/** Attach the client's document (already uploaded direct-to-Blob under the
 *  CI's own prefix). A PDF gets its text pulled out (unpdf, $0 AI) so the
 *  register is searchable and the generator can quote it. */
export async function attachInstructionFile(
  scope: Scope,
  id: string,
  path: string,
  filename: string,
  /** Server-side callers may point at a file already on this site (the RFI answer's PDF). */
  opts?: { anyProjectPath?: boolean }
): Promise<ContractInstruction> {
  const row = await ours(scope, id);
  if (!row) throw new Error("Not found");
  const okPath = opts?.anyProjectPath ? path.startsWith(`${scope.projectId}/`) : path.startsWith(ciBlobPrefix(scope.projectId, id));
  if (!okPath) throw new Error("Bad file path");
  let fileText: string | null = null;
  if (/\.pdf$/i.test(filename)) {
    try {
      const got = await get(path, { access: "private" });
      if (got && got.statusCode === 200 && got.stream) {
        const bytes = new Uint8Array(await new Response(got.stream).arrayBuffer());
        const pdf = await getDocumentProxy(bytes);
        const out = await extractText(pdf, { mergePages: true });
        const text = (Array.isArray(out.text) ? out.text.join("\n") : out.text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        fileText = text.slice(0, 60000) || null;
      }
    } catch (e) {
      console.error("instruction pdf extract failed:", e);
    }
  }
  const [updated] = await db
    .update(contractInstructions)
    .set({ file: path, fileName: filename.trim().slice(0, 160), fileText, updatedAt: new Date() })
    .where(eq(contractInstructions.id, id))
    .returning();
  return updated;
}

export type CiView = Omit<ContractInstruction, "trades" | "amendsDrawings"> & {
  label: string;
  trades: Category[];
  amendsDrawings: { doc: string; fromRev?: string; toRev?: string }[];
  /** The governing text: the body, else the source RFI's official answer. */
  directs: string | null;
};

async function directsFor(rows: ContractInstruction[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rfiIds = [...new Set(rows.map((r) => r.sourceRfiId).filter((v): v is string => !!v))];
  if (!rfiIds.length) return out;
  const msgs = await db.select().from(rfiMessages).where(and(eq(rfiMessages.type, "official_answer")));
  const latest = new Map<string, { body: string; at: number }>();
  for (const m of msgs) {
    if (!rfiIds.includes(m.rfiId)) continue;
    const at = m.createdAt?.getTime() ?? 0;
    const prev = latest.get(m.rfiId);
    if (!prev || at > prev.at) latest.set(m.rfiId, { body: m.body, at });
  }
  for (const r of rows) if (r.sourceRfiId && latest.has(r.sourceRfiId)) out.set(r.id, latest.get(r.sourceRfiId)!.body);
  return out;
}

export async function toViews(rows: ContractInstruction[]): Promise<CiView[]> {
  const answers = await directsFor(rows);
  return rows.map((r) => ({
    ...r,
    label: ciLabel(r),
    trades: parseTrades(r.trades),
    amendsDrawings: parseAmends(r.amendsDrawings),
    directs: r.body?.trim() || answers.get(r.id) || null,
  }));
}

export async function listInstructions(scope: Scope): Promise<CiView[]> {
  const rows = await db
    .select()
    .from(contractInstructions)
    .where(eq(contractInstructions.projectId, scope.projectId))
    .orderBy(desc(contractInstructions.number));
  return toViews(rows);
}

export async function getInstruction(scope: Scope, id: string): Promise<CiView | null> {
  const row = await ours(scope, id);
  if (!row) return null;
  return (await toViews([row]))[0];
}

/** The CI raised from a piece of correspondence, if any (shown inside that item). */
export async function instructionForCorr(scope: Scope, corrId: string): Promise<CiView | null> {
  const [row] = await db
    .select()
    .from(contractInstructions)
    .where(and(eq(contractInstructions.projectId, scope.projectId), eq(contractInstructions.sourceCorrId, corrId)))
    .orderBy(desc(contractInstructions.number))
    .limit(1);
  return row ? (await toViews([row]))[0] : null;
}

// ─── for the QA generator ─────────────────────────────────────────────────

const STOP = new Set(["the", "and", "for", "with", "per", "from", "this", "that", "into", "onto", "over", "under", "check", "make", "sure", "level", "unit", "area"]);
function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w)));
}

export type RelevantCi = CiView & { score: number; why: string };

/** The OPEN instructions that plausibly touch a check: a trade match is
 *  decisive (an instruction tagged Electrical belongs on the electrical
 *  check), a location match is strong, and text overlap with the check's
 *  subject is the tiebreak. Untagged instructions ride on text/location
 *  only. Everything scoring > 0 is handed to the model with its reason; the
 *  model decides the wording, and the deterministic fallback in
 *  lib/checklist.ts guarantees a trade-matched CI is never dropped. */
export async function relevantInstructions(
  scope: Scope,
  opts: { category?: Category | null; location?: string | null; subject: string }
): Promise<RelevantCi[]> {
  const all = (await listInstructions(scope)).filter((c) => c.status === "open");
  if (!all.length) return [];
  const subj = words(opts.subject);
  const loc = opts.location ? words(opts.location) : new Set<string>();
  const out: RelevantCi[] = [];
  for (const c of all) {
    let score = 0;
    const why: string[] = [];
    if (opts.category && c.trades.includes(opts.category)) {
      score += 10;
      why.push(`tagged ${opts.category}`);
    }
    const ciLoc = c.location ? words(c.location) : new Set<string>();
    if (loc.size && ciLoc.size && [...loc].some((w) => ciLoc.has(w))) {
      score += 5;
      why.push(`same location (${c.location})`);
    }
    const hay = words(`${c.title} ${c.directs ?? ""} ${c.fileText?.slice(0, 4000) ?? ""}`);
    const overlap = [...subj].filter((w) => hay.has(w)).length;
    if (overlap) {
      score += Math.min(4, overlap);
      why.push(`mentions ${overlap} of the check's terms`);
    }
    // An instruction with no trade tag and no location is general: always
    // shown to the model (score 1) so it can decide, never forced in.
    if (!score && !c.trades.length && !c.location) {
      score = 1;
      why.push("general instruction");
    }
    if (score > 0) out.push({ ...c, score, why: why.join(", ") });
  }
  return out.sort((a, b) => b.score - a.score || b.number - a.number);
}

export { CATEGORIES };
