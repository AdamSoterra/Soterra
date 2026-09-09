// ─── The RFI engine — Feature 5 ──────────────────────────────────────────
//
// Design: RFI-BUILD-SPEC.md + the approved rfi-mock.html. The register, the
// thread, the transition audit and the consultant scorecard all read the
// tables in lib/schema.ts; the email leaves through Foundation 1 (lib/email)
// so every send is recorded before it transmits.
//
// Status machine (enforced here, nowhere else):
//   draft → open (send) | void
//   open → answered (log answer) | void
//   answered → closed (accept) | open (bounce/reopen)
//   closed → open (reopen)
// Ball follows status: draft/answered = us · open = consultant · closed/void = none.
//
// Working days are Mon-Fri, date-level, Pacific/Auckland. Public holidays are
// NOT excluded in v1 — the register says "working days" and stays consistent;
// a holiday calendar is a fast-follow refinement, not a correctness bug.

import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { consultants, contractInstructions, emailLog, planPins, projects, rfiMessages, rfis, rfiTransitions } from "./schema";
import type { Rfi } from "./schema";
import type { Scope } from "./company";
import { companyName } from "./company";
import { emailEnabled, projectSenderAddress, sendEmail, type EmailAttachment } from "./email";
import { renderRfiAnswerNotice, renderRfiEmail, renderThreadNotice } from "./emailTemplates";
import { renderSheetWithPins } from "./pinSnapshot";
import { companyRequiresLogin, normalizeEmail } from "./externalAuth";
import { replyAddress } from "./inboundAddress";
import { attachmentsLine, packForEmail, parseAttachments, type Attachment } from "./attachments";
import { attachInstructionFile, createInstruction, getInstruction, type CiInput } from "./instructions";

/** Where the consultant answer link points. One env override for previews. */
const APP_URL = (process.env.APP_BASE_URL ?? "https://soterra.co.nz").replace(/\/+$/, "");
const PORTAL_URL = `${APP_URL}/portal`;

// ─── files ────────────────────────────────────────────────────────────────
// Every file on an RFI lives in the private Blob store under the project's
// rfis/ folder: "<projectId>/rfis/<rfiId>/…" once the RFI exists, and
// "<projectId>/rfis/pending/<key>/…" for files picked on the New RFI form
// before Save. Reads never trust the folder alone - /api/rfi-file checks the
// path is on THIS RFI's list (rfiPathBelongsTo).
export function rfiBlobRoot(projectId: string): string {
  return `${projectId}/rfis/`;
}
export function rfiBlobPrefix(projectId: string, rfiId: string): string {
  return `${projectId}/rfis/${rfiId}/`;
}
const MAX_FILES_ON_RFI = 30;

// ─── assignees ────────────────────────────────────────────────────────────
// An RFI goes to as many consultants as the PM decides (the architect AND the
// electrical engineer, say). Any of them can answer; the first one listed is
// the accountable party the scorecard counts against (consultant_* columns).
export type Assignee = { name: string | null; company: string | null; email: string };
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function cleanAssignees(input: Assignee[] | undefined | null): Assignee[] {
  const seen = new Set<string>();
  const out: Assignee[] = [];
  for (const a of input ?? []) {
    const email = String(a?.email ?? "").trim().toLowerCase();
    if (!EMAIL_OK.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ name: String(a.name ?? "").trim().slice(0, 120) || null, company: String(a.company ?? "").trim().slice(0, 120) || null, email });
  }
  return out.slice(0, 10);
}
/** Everyone the RFI is assigned to; falls back to the single consultant on older rows. */
export function rfiAssignees(rfi: { assignees: string | null; consultantName: string | null; consultantCompany: string | null; consultantEmail: string | null }): Assignee[] {
  if (rfi.assignees) {
    try {
      const arr = JSON.parse(rfi.assignees);
      if (Array.isArray(arr) && arr.length) return cleanAssignees(arr as Assignee[]);
    } catch {
      /* fall through */
    }
  }
  return rfi.consultantEmail ? [{ name: rfi.consultantName, company: rfi.consultantCompany, email: rfi.consultantEmail.toLowerCase() }] : [];
}
export function assigneeLine(list: Assignee[]): string {
  return list.map((a) => a.company || a.name || a.email).join(" · ");
}
function cleanFiles(files: Attachment[] | undefined, prefixes: string[], max = 10): Attachment[] {
  return (files ?? [])
    .filter((f) => f && typeof f.path === "string" && prefixes.some((p) => f.path.startsWith(p)))
    .slice(0, max)
    .map((f) => ({
      filename: String(f.filename ?? "").trim().slice(0, 160) || "file",
      path: f.path,
      bytes: Math.max(0, Math.floor(Number(f.bytes) || 0)),
      contentType: String(f.contentType || "application/octet-stream").slice(0, 120),
    }));
}

export const RFI_SLA_WORKING_DAYS = 7;

export const DISCIPLINES = [
  "Architectural", "Structural", "Civil", "Fire", "Mechanical", "Electrical", "Hydraulic", "Geotech", "Facade",
] as const;

// ─── working-day maths ───────────────────────────────────────────────────

/** Date-only key in the project's timezone. */
function dayKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }); // YYYY-MM-DD
}
function isWeekend(key: string): boolean {
  const [y, m, dd] = key.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  return wd === 0 || wd === 6;
}
/** Whole working days from a to b (0 when same day or b before a). */
export function workingDaysBetween(a: Date, b: Date): number {
  let from = dayKey(a);
  const to = dayKey(b);
  if (from >= to) return 0;
  let count = 0;
  const cur = new Date(a.getTime());
  // Step by calendar days in NZ; count each full day landed on that is a weekday.
  for (let i = 0; i < 400 && dayKey(cur) < to; i++) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const k = dayKey(cur);
    if (k <= to && !isWeekend(k)) count++;
    from = k;
  }
  return count;
}
/** The date N working days after a. */
export function addWorkingDays(a: Date, n: number): Date {
  const cur = new Date(a.getTime());
  let added = 0;
  for (let i = 0; i < 400 && added < n; i++) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (!isWeekend(dayKey(cur))) added++;
  }
  return cur;
}

export function rfiLabel(r: { number: number | null }): string {
  return r.number == null ? "Draft" : `RFI-${String(r.number).padStart(3, "0")}`;
}

/** Net working days the CONSULTANT held the ball, from the transition log.
 *  The clock runs in ball="consultant" intervals only — a bounce back to us
 *  pauses it, which is the honest number the scorecard reports. */
export function consultantWorkingDays(
  transitions: { ballTo: string | null; at: Date }[],
  until: Date
): number {
  let total = 0;
  let heldSince: Date | null = null;
  for (const t of transitions) {
    if (!t.ballTo) continue;
    if (t.ballTo === "consultant") {
      if (!heldSince) heldSince = t.at;
    } else if (heldSince) {
      total += workingDaysBetween(heldSince, t.at);
      heldSince = null;
    }
  }
  if (heldSince) total += workingDaysBetween(heldSince, until);
  return total;
}

// ─── transitions ─────────────────────────────────────────────────────────

const ALLOWED: Record<string, string[]> = {
  draft: ["open", "void"],
  open: ["answered", "void"],
  answered: ["closed", "open"],
  closed: ["open"],
  void: [],
};
function ballFor(status: string): string {
  if (status === "open") return "consultant";
  if (status === "draft" || status === "answered") return "us";
  return "none";
}

async function transition(
  scope: Scope,
  rfi: Rfi,
  toStatus: string,
  by: { userId?: string | null; name?: string | null },
  comment?: string | null
): Promise<Rfi> {
  if (!ALLOWED[rfi.status]?.includes(toStatus)) {
    throw new Error(`An RFI can't go ${rfi.status} → ${toStatus}`);
  }
  const ballTo = ballFor(toStatus);
  await db.insert(rfiTransitions).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    rfiId: rfi.id,
    fromStatus: rfi.status,
    toStatus,
    ballFrom: rfi.ballParty,
    ballTo,
    byUser: by.userId ?? null,
    byName: by.name ?? null,
    comment: comment ?? null,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = { status: toStatus, ballParty: ballTo, updatedAt: new Date() };
  if (toStatus === "answered") set.dateAnswered = new Date();
  if (toStatus === "closed") set.dateClosed = new Date();
  if (toStatus === "open" && rfi.status !== "draft") set.dateClosed = null; // reopen
  const [row] = await db.update(rfis).set(set).where(and(eq(rfis.id, rfi.id), eq(rfis.projectId, scope.projectId))).returning();
  return row;
}

// ─── CRUD + lifecycle ────────────────────────────────────────────────────

export type NewRfiInput = {
  subject: string;
  discipline?: string | null;
  priority?: "normal" | "high" | "critical";
  location?: string | null;
  question: string;
  proposedSolution?: string | null;
  codeRefs?: string[];
  consultantName?: string | null;
  consultantCompany?: string | null;
  consultantEmail?: string | null;
  cc?: string[];
  costImpact?: "none" | "unknown" | "yes";
  costEstimate?: string | null;
  programmeImpact?: "none" | "unknown" | "yes";
  programmeDays?: number | null;
  criticalPath?: boolean;
  requiredBy?: Date | null; // default = send date + SLA
  raisedByName?: string | null;
  /** Files picked on the New RFI form (already in Blob under the project's rfis/ folder). */
  attachments?: Attachment[];
  /** Everyone it is assigned to; the first is the accountable one. */
  assignees?: Assignee[];
};

export async function createDraft(scope: Scope, input: NewRfiInput): Promise<Rfi> {
  const files = cleanFiles(input.attachments, [rfiBlobRoot(scope.projectId)], MAX_FILES_ON_RFI);
  // The assignee list; an older caller that only sends consultant_* fields
  // becomes a one-person list. The first one is the accountable party.
  const assignees = cleanAssignees(
    input.assignees?.length
      ? input.assignees
      : input.consultantEmail
        ? [{ name: input.consultantName ?? null, company: input.consultantCompany ?? null, email: input.consultantEmail }]
        : []
  );
  const primary = assignees[0];
  const [row] = await db
    .insert(rfis)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      attachments: files.length ? JSON.stringify(files) : null,
      assignees: assignees.length ? JSON.stringify(assignees) : null,
      subject: input.subject.trim().slice(0, 200),
      discipline: input.discipline ?? null,
      priority: input.priority ?? "normal",
      location: input.location?.trim().slice(0, 120) || null,
      question: input.question.trim(),
      proposedSolution: input.proposedSolution?.trim() || null,
      codeRefs: input.codeRefs?.length ? JSON.stringify(input.codeRefs) : null,
      consultantName: primary?.name ?? null,
      consultantCompany: primary?.company ?? null,
      consultantEmail: primary?.email ?? null,
      cc: input.cc?.length ? JSON.stringify(input.cc) : null,
      costImpact: input.costImpact ?? "unknown",
      costEstimate: input.costEstimate?.trim() || null,
      programmeImpact: input.programmeImpact ?? "unknown",
      programmeDays: input.programmeDays ?? null,
      criticalPath: !!input.criticalPath,
      dateRequiredBy: input.requiredBy ?? null,
      raisedBy: scope.userId,
      raisedByName: input.raisedByName ?? null,
    })
    .returning();
  await db.insert(rfiMessages).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    rfiId: row.id,
    type: "question",
    authorSide: "contractor",
    authorName: input.raisedByName ?? null,
    body: row.question,
  });
  return row;
}

async function ourRfi(scope: Scope, rfiId: string): Promise<Rfi | null> {
  const [row] = await db
    .select()
    .from(rfis)
    .where(and(eq(rfis.id, rfiId), eq(rfis.projectId, scope.projectId)))
    .limit(1);
  return row ?? null;
}

/** Attach files (already uploaded direct-to-Blob under the project's rfis/
 *  folder) to a DRAFT. Once sent, files travel on follow-ups instead, so the
 *  consultant is told about them. */
export async function attachRfiFiles(scope: Scope, rfiId: string, files: Attachment[]): Promise<Rfi> {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) throw new Error("RFI not found");
  if (rfi.status !== "draft") throw new Error("Attach files to a sent RFI with a follow-up, so the consultant is told");
  const existing = parseAttachments(rfi.attachments);
  for (const f of cleanFiles(files, [rfiBlobRoot(scope.projectId)], MAX_FILES_ON_RFI)) {
    if (!existing.some((e) => e.path === f.path)) existing.push(f);
  }
  if (existing.length > MAX_FILES_ON_RFI) throw new Error("Too many files on one RFI");
  const [row] = await db
    .update(rfis)
    .set({ attachments: JSON.stringify(existing), updatedAt: new Date() })
    .where(eq(rfis.id, rfiId))
    .returning();
  return row;
}

export async function removeRfiAttachment(scope: Scope, rfiId: string, path: string): Promise<Rfi> {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) throw new Error("RFI not found");
  if (rfi.status !== "draft") throw new Error("Files can only be removed from a draft");
  const kept = parseAttachments(rfi.attachments).filter((a) => a.path !== path);
  const [row] = await db
    .update(rfis)
    .set({ attachments: kept.length ? JSON.stringify(kept) : null, updatedAt: new Date() })
    .where(eq(rfis.id, rfiId))
    .returning();
  return row;
}

/** Is this blob path one of the RFI's files (its own, or on a line of the thread)? */
export async function rfiPathBelongsTo(rfi: Rfi, path: string): Promise<Attachment | null> {
  const own = parseAttachments(rfi.attachments).find((a) => a.path === path);
  if (own) return own;
  const msgs = await db.select({ attachments: rfiMessages.attachments }).from(rfiMessages).where(eq(rfiMessages.rfiId, rfi.id));
  for (const m of msgs) {
    const hit = parseAttachments(m.attachments).find((a) => a.path === path);
    if (hit) return hit;
  }
  return null;
}

/** Send: burn the next number, open the clock, email the consultant. The
 *  email leaves through Foundation 1, so it is recorded whatever happens. */
export async function sendRfi(
  scope: Scope,
  rfiId: string,
  by: { userId?: string | null; name?: string | null; email?: string | null }
): Promise<{ rfi: Rfi; emailStatus: string }> {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) throw new Error("RFI not found");
  if (rfi.status !== "draft") throw new Error("Only a draft can be sent");
  if (!rfi.consultantEmail) throw new Error("Give the RFI a consultant email first");

  // Next number on this project. Race window is acceptable at this scale; the
  // register unique-ish index keeps it observable if it ever double-fires.
  const [maxRow] = await db
    .select({ number: rfis.number })
    .from(rfis)
    .where(eq(rfis.projectId, scope.projectId))
    .orderBy(desc(rfis.number))
    .limit(1);
  const number = (maxRow?.number ?? 0) + 1;

  const now = new Date();
  const requiredBy = rfi.dateRequiredBy ?? addWorkingDays(now, RFI_SLA_WORKING_DAYS);
  // The answer-link secret rides out with the email; 24 random bytes, minted
  // once per RFI (a resend after reopen reuses the same thread link).
  const answerToken = rfi.answerToken ?? randomBytes(24).toString("base64url");
  await db
    .update(rfis)
    .set({ number, dateRaised: now, dateRequiredBy: requiredBy, answerToken, updatedAt: now })
    .where(eq(rfis.id, rfi.id));
  const opened = await transition(scope, { ...rfi, number }, "open", by, "sent to " + (rfi.consultantCompany ?? rfi.consultantEmail));

  // ── the email ──
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const projectName = proj?.name ?? "This project";
  const company = (await companyName(scope.companyId)) ?? "Your builder";
  const label = rfiLabel(opened);
  const dueLabel = requiredBy.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });

  // Pins on this RFI → drawing refs + the snapshot attachment.
  const pins = await db
    .select()
    .from(planPins)
    .where(and(eq(planPins.projectId, scope.projectId), eq(planPins.recordType, "rfi"), eq(planPins.recordId, rfi.id)));
  const attachments: EmailAttachment[] = [];
  const drawingRefs: string[] = [];
  const bySheet = new Map<string, { doc: string; page: number; pins: { x: number; y: number; label: string }[] }>();
  for (const p of pins) {
    drawingRefs.push(`${p.doc}${rfi.location ? ` · pin at ${rfi.location}` : ""}`);
    const key = `${p.doc}::${p.page}`;
    const e = bySheet.get(key) ?? { doc: p.doc, page: p.page, pins: [] };
    e.pins.push({ x: p.x, y: p.y, label: String(number) });
    bySheet.set(key, e);
  }
  for (const sheet of bySheet.values()) {
    const png = await renderSheetWithPins(scope.projectId, sheet.doc, sheet.page, sheet.pins);
    if (png) {
      const safe = sheet.doc.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 60);
      attachments.push({ filename: `${label}-${safe}-pin.png`, content: png.toString("base64") });
    }
  }
  // The RFI's own files ride along while the email budget lasts (the pin
  // snapshots are already on the email); the rest download from the RFI page.
  const pinBytes = attachments.reduce((n, a) => n + Math.ceil((a.content.length * 3) / 4), 0);
  const packed = await packForEmail(parseAttachments(rfi.attachments), pinBytes);
  attachments.push(...packed.attachments);
  const listedFiles = [
    ...attachments.slice(0, attachments.length - packed.attachments.length).map((a) => a.filename),
    ...packed.listed.map((l) => (l.attached ? `${l.filename} (${l.bytesLabel})` : `${l.filename} (${l.bytesLabel} · download from the RFI page)`)),
  ];

  const codeRefs: string[] = rfi.codeRefs ? JSON.parse(rfi.codeRefs) : [];
  const cc: string[] = rfi.cc ? JSON.parse(rfi.cc) : [];
  // With inbound capture on, a plain email reply lands in this thread via the
  // per-RFI reply address; otherwise it goes to the sender's inbox as before.
  const loginRequired = await companyRequiresLogin(scope.companyId);
  const inboundReplyTo = await replyAddress("rfi", answerToken);
  const assignees = rfiAssignees(rfi);
  const meta = [
    { label: assignees.length > 1 ? "Assigned to" : "Discipline", value: assignees.length > 1 ? assigneeLine(assignees) : rfi.discipline ?? "General" },
    { label: "Priority", value: rfi.priority[0].toUpperCase() + rfi.priority.slice(1) },
    { label: "Location", value: rfi.location ?? "-" },
    { label: "Cost impact", value: rfi.costImpact === "yes" ? `Yes${rfi.costEstimate ? ` · ${rfi.costEstimate}` : ""}` : rfi.costImpact[0].toUpperCase() + rfi.costImpact.slice(1) },
    { label: "Programme impact", value: rfi.programmeImpact === "yes" ? `Yes${rfi.programmeDays ? ` · est ${rfi.programmeDays} days` : ""}` : rfi.programmeImpact[0].toUpperCase() + rfi.programmeImpact.slice(1) },
    { label: "Drawing", value: pins[0]?.doc ?? "-" },
  ];
  const rendered = renderRfiEmail({
    companyName: company,
    contextLine: `${projectName} · Raised by ${by.name ?? "the site team"} · ${now.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" })}`,
    rfiNumber: label,
    rfiSubject: rfi.subject,
    requiredByLabel: `${dueLabel} (${RFI_SLA_WORKING_DAYS} working days)`,
    meta,
    question: rfi.question,
    proposedSolution: rfi.proposedSolution,
    drawingRefs,
    codeRefs,
    attachments: listedFiles,
    replyName: by.name ?? "the sender",
    refLabel: `${label} · Rev ${opened.revision}`,
    answerUrl: `${APP_URL}/answer/${answerToken}`,
    portalUrl: PORTAL_URL,
    loginRequired,
    replyLogged: !!inboundReplyTo,
  });

  const result = await sendEmail({
    scope,
    kind: "rfi",
    recordType: "rfi",
    recordIds: [rfi.id],
    to: assignees.length ? assignees.map((a) => ({ name: a.name || a.company, email: a.email })) : { name: rfi.consultantName || rfi.consultantCompany, email: rfi.consultantEmail },
    cc,
    fromName: `${company} (via Soterra)`,
    fromEmail: projectSenderAddress(projectName, scope.projectId),
    replyTo: inboundReplyTo ?? by.email ?? null,
    subject: `${label} · ${projectName} · ${rfi.subject} · response needed by ${dueLabel}`,
    html: rendered.html,
    text: rendered.text,
    attachments,
    sentBy: by.userId ?? null,
    sentByName: by.name ?? null,
  });
  await db.update(rfis).set({ emailLogId: result.id }).where(eq(rfis.id, rfi.id));
  await db.insert(rfiMessages).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    rfiId: rfi.id,
    type: "system",
    authorSide: "contractor",
    authorName: by.name ?? null,
    body: emailEnabled()
      ? `Sent to ${assignees.length ? assignees.map((a) => [a.name, a.company].filter(Boolean).join(" ") || a.email).join(", ") : `${rfi.consultantName ?? ""} ${rfi.consultantCompany ?? ""}`.trim()}` + (cc.length ? ` · cc ${cc.join(", ")}` : "")
      : `Recorded for ${rfi.consultantName ?? ""} ${rfi.consultantCompany ?? ""}`.trim() + " (email sending not yet live)",
  });
  // Remember the consultant in the Directory (upsert on company + email, so
  // details are typed once, ever). Best-effort: never fails a send.
  // Emails are stored LOWERCASED here - that is what lets the unique index on
  // (company_id, email) make this a true atomic upsert instead of a racy
  // check-then-insert, and it matches the directory API which does the same.
  for (const a of assignees.length ? assignees : [{ name: rfi.consultantName, company: rfi.consultantCompany, email: rfi.consultantEmail }]) {
    try {
      const email = a.email.trim().toLowerCase();
      // A garbage address must not become a directory row the edit screen then
      // refuses to touch (its API validates shape) - same regex as the API.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("unsaveable email: " + email);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details: Record<string, any> = {};
      if (a.name) details.name = a.name;
      if (a.company) details.company = a.company;
      if (rfi.discipline && (DISCIPLINES as readonly string[]).includes(rfi.discipline)) details.discipline = rfi.discipline;
      await db
        .insert(consultants)
        .values({ companyId: scope.companyId, email, ...details, createdBy: by.userId ?? null })
        .onConflictDoUpdate({
          target: [consultants.companyId, consultants.email],
          set: Object.keys(details).length ? details : { email },
        });
    } catch (e) {
      console.error("consultant directory upsert failed:", e);
    }
  }
  const fresh = await ourRfi(scope, rfi.id);
  return { rfi: fresh ?? opened, emailStatus: result.status };
}

export async function logAnswer(
  scope: Scope,
  rfiId: string,
  body: string,
  by: { userId?: string | null; name?: string | null; consultantName?: string | null; via?: string | null },
  files?: Attachment[]
): Promise<Rfi> {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) throw new Error("RFI not found");
  // Atomic claim, NOT the generic transition(): the public answer link means
  // two devices genuinely can submit at once (or race the PM logging it
  // manually). neon-http has no transactions, so the conditional UPDATE is
  // the lock — WHERE status='open' lets exactly one writer win; the loser
  // sees zero rows and throws instead of double-answering, double-emailing,
  // and double-writing the audit trail.
  const now = new Date();
  const [claimed] = await db
    .update(rfis)
    .set({ status: "answered", ballParty: "us", dateAnswered: now, updatedAt: now })
    .where(and(eq(rfis.id, rfiId), eq(rfis.projectId, scope.projectId), eq(rfis.status, "open")))
    .returning();
  if (!claimed) throw new Error(`An RFI can't go ${rfi.status} → answered`);
  // Audit row after the claim so it is written exactly once, by the winner.
  await db.insert(rfiTransitions).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    rfiId,
    fromStatus: "open",
    toStatus: "answered",
    ballFrom: rfi.ballParty,
    ballTo: "us",
    byUser: by.userId ?? null,
    byName: by.name ?? null,
    comment: "answer logged",
  });
  await db.insert(rfiMessages).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    rfiId,
    type: "official_answer",
    authorSide: "consultant",
    authorName: by.consultantName ?? rfi.consultantName ?? rfi.consultantCompany ?? null,
    body: body.trim(),
    via: by.via ?? null,
    attachments: files?.length ? JSON.stringify(files) : null,
  });
  return claimed;
}

/** Promote an existing consultant follow-up (typically one that arrived by
 *  email) to THE official answer: same atomic open→answered claim as
 *  logAnswer, the message body copied into an official_answer line, and a
 *  system line saying which note it was. The original stays in the thread. */
export async function promoteToAnswer(
  scope: Scope,
  rfiId: string,
  messageId: string,
  by: { userId?: string | null; name?: string | null }
): Promise<Rfi> {
  const [msg] = await db
    .select()
    .from(rfiMessages)
    .where(and(eq(rfiMessages.id, messageId), eq(rfiMessages.rfiId, rfiId), eq(rfiMessages.projectId, scope.projectId)))
    .limit(1);
  if (!msg) throw new Error("That note isn't on this RFI");
  if (msg.authorSide !== "consultant" || msg.type !== "followup") throw new Error("Only a consultant's note can become the answer");
  // The note's files (a marked-up sketch that came with the email) go with it.
  const row = await logAnswer(scope, rfiId, msg.body, { ...by, consultantName: msg.authorName, via: msg.via ?? "app" }, parseAttachments(msg.attachments));
  await db.insert(rfiMessages).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    rfiId,
    type: "system",
    authorSide: "contractor",
    authorName: by.name ?? null,
    body: `${by.name ?? "The site team"} logged ${msg.authorName ?? "the consultant"}'s ${msg.via === "email" ? "email reply" : "note"} as the official answer`,
    via: "app",
  });
  return row;
}

export async function addFollowup(
  scope: Scope,
  rfiId: string,
  body: string,
  by: { userId?: string | null; name?: string | null; email?: string | null },
  opts?: { bounce?: boolean; files?: Attachment[] }
): Promise<Rfi> {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) throw new Error("RFI not found");
  const files = cleanFiles(opts?.files, [rfiBlobRoot(scope.projectId)]);
  const text = body.trim() || (files.length ? "(see attachments)" : "");
  if (!text) throw new Error("Write the follow-up first");
  await db.insert(rfiMessages).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    rfiId,
    type: "followup",
    authorSide: "contractor",
    authorName: by.name ?? null,
    body: text,
    via: "app",
    attachments: files.length ? JSON.stringify(files) : null,
  });
  // A follow-up on an answered RFI can bounce the ball back (status → open).
  let out: Rfi | null = null;
  if (opts?.bounce && rfi.status === "answered") {
    out = await transition(scope, rfi, "open", by, "follow-up bounced the ball back");
  }
  // The consultant hears about it (with the files), same as when our side
  // replies from their inbox. Best-effort: the line is logged whatever
  // happens to the email.
  if (rfi.status !== "draft" && rfi.consultantEmail && rfi.answerToken) {
    try {
      await notifyConsultantOfFollowup(scope, rfi, by, text, files, !!opts?.bounce && rfi.status === "answered");
    } catch (e) {
      console.error("rfi follow-up notice failed:", e);
    }
  }
  return out ?? (await ourRfi(scope, rfiId)) ?? rfi;
}

async function notifyConsultantOfFollowup(
  scope: Scope,
  rfi: Rfi,
  by: { userId?: string | null; name?: string | null; email?: string | null },
  text: string,
  files: Attachment[],
  bounced: boolean
) {
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const projectName = proj?.name ?? "The project";
  const company = (await companyName(scope.companyId)) ?? "The builder";
  const label = rfiLabel(rfi);
  const loginRequired = await companyRequiresLogin(scope.companyId);
  const packed = await packForEmail(files);
  const line = attachmentsLine(packed.listed.map((l) => ({ filename: l.attached ? l.filename : `${l.filename} (download from the RFI page)` })));
  const rendered = renderThreadNotice({
    companyName: company,
    projectName,
    heading: `${label} · ${bounced ? "follow-up question" : "follow-up"}`,
    subject: rfi.subject,
    actorLine: `${by.name ?? "The site team"} · ${company}`,
    lead: bounced ? `has a follow-up on ${label}. The RFI is open again and the response clock is running.` : `added to ${label}.`,
    body: text,
    attachmentsLine: line,
    linkLabel: "Open the RFI",
    linkUrl: `${APP_URL}/answer/${rfi.answerToken}`,
    linkNote: loginRequired ? "Opens for your Soterra account on the address this was sent to." : "No account needed.",
    refLabel: `${label} · ${projectName}`.slice(0, 80),
    portalUrl: PORTAL_URL,
    loginRequired,
    tone: bounced ? "amber" : "blue",
  });
  await sendEmail({
    scope,
    kind: "rfi",
    recordType: "rfi",
    recordIds: [rfi.id],
    to: { name: rfi.consultantName || rfi.consultantCompany, email: rfi.consultantEmail! },
    replyTo: (await replyAddress("rfi", rfi.answerToken!)) ?? by.email ?? null,
    fromName: `${company} (via Soterra)`,
    fromEmail: projectSenderAddress(projectName, scope.projectId),
    subject: `${label} · ${projectName} · ${rfi.subject}`,
    html: rendered.html,
    text: rendered.text,
    attachments: packed.attachments,
    sentBy: by.userId ?? null,
    sentByName: by.name ?? null,
  });
}

export async function setRfiStatus(
  scope: Scope,
  rfiId: string,
  toStatus: "closed" | "open" | "void",
  by: { userId?: string | null; name?: string | null },
  comment?: string
): Promise<Rfi> {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) throw new Error("RFI not found");
  return transition(scope, rfi, toStatus, by, comment ?? null);
}

/** Set the impact flags — critical-path / cost / programme. These aren't
 *  derivable (Soterra has no programme), so they're a human call, editable at
 *  any time (an RFI often becomes critical-path only after it sits unanswered).
 *  criticalPath drives the tile + the EOT pack. */
export async function updateRfiImpact(
  scope: Scope,
  rfiId: string,
  fields: {
    criticalPath?: boolean;
    costImpact?: "none" | "unknown" | "yes";
    costEstimate?: string | null;
    programmeImpact?: "none" | "unknown" | "yes";
    programmeDays?: number | null;
  }
): Promise<Rfi> {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) throw new Error("RFI not found");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = { updatedAt: new Date() };
  if (fields.criticalPath !== undefined) set.criticalPath = !!fields.criticalPath;
  if (fields.costImpact !== undefined) set.costImpact = fields.costImpact;
  if (fields.costEstimate !== undefined) set.costEstimate = fields.costEstimate?.trim() || null;
  if (fields.programmeImpact !== undefined) set.programmeImpact = fields.programmeImpact;
  if (fields.programmeDays !== undefined) set.programmeDays = fields.programmeDays ?? null;
  const [row] = await db.update(rfis).set(set).where(and(eq(rfis.id, rfiId), eq(rfis.projectId, scope.projectId))).returning();
  return row;
}

/** The answer changed the works: raise the client / contract instruction from
 *  it, INSIDE the RFI (Adam 2026-09-10: the CI is how an RFI ends, so it lives
 *  on the closed RFI rather than on a register of its own). The wording
 *  defaults to the official answer, the location to the RFI's, the document
 *  to a PDF already on the thread; the trades tagged decide which generated
 *  QA checks put it at item one (lib/checklist.ts). */
export type CiFromRfiInput = Omit<CiInput, "sourceRfiId" | "sourceCorrId"> & {
  /** A PDF already on this RFI (its own files or a thread line) to use as the document. */
  filePath?: string | null;
  fileName?: string | null;
};
export async function createCi(scope: Scope, rfiId: string, input: CiFromRfiInput, by: { userId?: string | null; name?: string | null }) {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) throw new Error("RFI not found");
  if (rfi.resultingCiId) throw new Error("This RFI already raised an instruction");
  const answer = (await db.select({ body: rfiMessages.body }).from(rfiMessages).where(and(eq(rfiMessages.rfiId, rfiId), eq(rfiMessages.type, "official_answer"))).orderBy(desc(rfiMessages.createdAt)).limit(1))[0];
  let ci = await createInstruction(
    scope,
    {
      ...input,
      title: input.title?.trim() || rfi.subject,
      body: input.body?.trim() || answer?.body || null,
      location: input.location === undefined ? rfi.location : input.location,
      issuedByName: input.issuedByName === undefined ? [rfi.consultantName, rfi.consultantCompany].filter(Boolean).join(" · ") || null : input.issuedByName,
      sourceRfiId: rfi.id,
    },
    by
  );
  if (input.filePath && (await rfiPathBelongsTo(rfi, input.filePath))) {
    try {
      ci = await attachInstructionFile(scope, ci.id, input.filePath, input.fileName || input.filePath.split("/").pop() || "document.pdf", { anyProjectPath: true });
    } catch (e) {
      console.error("ci document from rfi failed:", e);
    }
  }
  await db.update(rfis).set({ resultingCiId: ci.id, updatedAt: new Date() }).where(eq(rfis.id, rfi.id));
  const amends = input.amendsDrawings ?? [];
  await db.insert(rfiMessages).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    rfiId,
    type: "system",
    authorSide: "contractor",
    authorName: by.name ?? null,
    body: `Answer raised CI-${String(ci.number).padStart(3, "0")}${amends.length ? ` · amends ${amends.map((d) => d.doc).join(", ")}` : ""}`,
  });
  return ci;
}

// ─── reads ───────────────────────────────────────────────────────────────

/** The answer-link secret stays server-side: the register and thread payloads
 *  go to the browser, and a harvested token would let anyone write into the
 *  thread. Exported so the route can strip the rows the lifecycle actions
 *  return too. */
export function publicRfi(r: Rfi): Omit<Rfi, "answerToken"> {
  const { answerToken: _secret, ...pub } = r;
  return pub;
}

export async function listRfis(scope: Scope) {
  const rows = await db
    .select()
    .from(rfis)
    .where(eq(rfis.projectId, scope.projectId))
    .orderBy(desc(rfis.number), desc(rfis.createdAt));
  // The CI each answered RFI raised, for the row marker.
  const cis = await db
    .select({ id: contractInstructions.id, number: contractInstructions.number, status: contractInstructions.status })
    .from(contractInstructions)
    .where(eq(contractInstructions.projectId, scope.projectId));
  const ciById = new Map(cis.map((c) => [c.id, c]));
  const now = new Date();
  return rows.map((r) => {
    const daysOpen = r.dateRaised ? workingDaysBetween(r.dateRaised, r.status === "closed" && r.dateClosed ? r.dateClosed : now) : 0;
    const overdue = r.status === "open" && !!r.dateRequiredBy && now > r.dateRequiredBy;
    const lateWd = overdue && r.dateRequiredBy ? workingDaysBetween(r.dateRequiredBy, now) : 0;
    const ci = r.resultingCiId ? ciById.get(r.resultingCiId) : null;
    return { ...publicRfi(r), assignees: rfiAssignees(r), ciLabel: ci ? `CI-${String(ci.number).padStart(3, "0")}` : null, label: rfiLabel(r), daysOpen, overdue, lateWd };
  });
}

export async function getRfi(scope: Scope, rfiId: string) {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) return null;
  const messages = await db.select().from(rfiMessages).where(eq(rfiMessages.rfiId, rfiId)).orderBy(rfiMessages.createdAt);
  const transitions = await db.select().from(rfiTransitions).where(eq(rfiTransitions.rfiId, rfiId)).orderBy(rfiTransitions.at);
  const pins = await db
    .select({ id: planPins.id, doc: planPins.doc, page: planPins.page, x: planPins.x, y: planPins.y })
    .from(planPins)
    .where(and(eq(planPins.projectId, scope.projectId), eq(planPins.recordType, "rfi"), eq(planPins.recordId, rfiId)));
  const ci = rfi.resultingCiId ? await getInstruction(scope, rfi.resultingCiId) : null;
  const now = new Date();
  return {
    rfi: {
      ...publicRfi(rfi),
      assignees: rfiAssignees(rfi),
      label: rfiLabel(rfi),
      daysOpen: rfi.dateRaised ? workingDaysBetween(rfi.dateRaised, now) : 0,
      overdue: rfi.status === "open" && !!rfi.dateRequiredBy && now > rfi.dateRequiredBy,
      files: parseAttachments(rfi.attachments),
      uploadPrefix: rfiBlobPrefix(scope.projectId, rfi.id),
    },
    messages: messages.map((m) => ({ ...m, attachments: parseAttachments(m.attachments) })),
    transitions,
    pins,
    ci,
  };
}

// ─── the consultant answer link (token-authorised, no login) ─────────────
//
// The consultant's email carries /answer/<token>. Holding the token proves
// the holder was SENT this exact RFI — that is the whole authorisation. The
// scope is rebuilt from the RFI ROW's own company/project ids (never from the
// client), so the blast radius of a leaked link is one RFI's thread, nothing
// else. Void RFIs answer to nobody; a closed thread is read-only.

export async function rfiByToken(token: string): Promise<Rfi | null> {
  const clean = token.trim();
  // base64url of 24 bytes is 32 chars; reject junk before it reaches the db.
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(clean)) return null;
  const [row] = await db.select().from(rfis).where(eq(rfis.answerToken, clean)).limit(1);
  return row ?? null;
}

/** A sent RFI by id, for the portal (the caller has already matched the
 *  signed-in email against the recipients; see rfiRecipients). */
export async function sentRfiById(id: string): Promise<Rfi | null> {
  const [row] = await db.select().from(rfis).where(eq(rfis.id, id)).limit(1);
  if (!row || row.status === "void" || row.status === "draft" || row.number == null) return null;
  return row;
}

/** The addresses an RFI went to (consultant + cc), lowercased. */
export function rfiRecipients(rfi: Rfi): string[] {
  const cc: string[] = rfi.cc ? (JSON.parse(rfi.cc) as string[]) : [];
  return [...rfiAssignees(rfi).map((a) => a.email), rfi.consultantEmail, ...cc].filter((e): e is string => !!e).map(normalizeEmail);
}

/** The sent RFIs addressed to any of these emails - the portal's list. */
export async function rfisForEmails(emails: string[]): Promise<Rfi[]> {
  if (!emails.length) return [];
  const lower = emails.map((e) => e.toLowerCase());
  // Matches the accountable consultant, any assignee (JSON text) or a cc;
  // "local+tag@domain" rows count as "local@domain" (normalizeEmail).
  const clauses = lower.flatMap((e) => {
    const clean = e.replace(/[%_]/g, "");
    const at = clean.lastIndexOf("@");
    const tagged = at > 0 ? `${clean.slice(0, at)}+%${clean.slice(at)}` : null;
    return [
      sql`lower(${rfis.consultantEmail}) = ${e}`,
      sql`${rfis.assignees} ILIKE ${"%" + clean + "%"}`,
      sql`${rfis.cc} ILIKE ${"%" + clean + "%"}`,
      ...(tagged ? [sql`lower(${rfis.consultantEmail}) LIKE ${tagged}`, sql`${rfis.assignees} ILIKE ${"%" + tagged + "%"}`] : []),
    ];
  });
  const rows = await db
    .select()
    .from(rfis)
    .where(and(inArray(rfis.status, ["open", "answered", "closed"]), sql`(${sql.join(clauses, sql` OR `)})`))
    .orderBy(desc(rfis.updatedAt));
  return rows.filter((r) => r.number != null);
}

/** See the header note: token IS the authorisation, ids come from the row. */
function tokenScope(rfi: Rfi): Scope {
  return {
    projectId: rfi.projectId,
    companyId: rfi.companyId as Scope["companyId"],
    userId: "",
    role: "consultant-link",
  };
}

const PUBLIC_MESSAGE_TYPES = ["question", "official_answer", "followup"];

/** Everything the public answer page shows. Null = bad token / void RFI. */
export async function getRfiThreadByToken(token: string) {
  const rfi = await rfiByToken(token);
  // number==null is the draft guard; status "draft" is also checked directly
  // because a crash inside sendRfi can leave number+token set with the status
  // flip unapplied — that half-sent state must stay invisible too.
  if (!rfi || rfi.status === "void" || rfi.status === "draft" || rfi.number == null) return null;
  return rfiThreadView(rfi);
}

/** The external view of an RFI - shared by the token page and the portal. */
export async function rfiThreadView(rfi: Rfi) {
  const scope = tokenScope(rfi);
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const company = (await companyName(scope.companyId)) ?? "The builder";
  const rows = await db
    .select({
      type: rfiMessages.type,
      authorSide: rfiMessages.authorSide,
      authorName: rfiMessages.authorName,
      body: rfiMessages.body,
      via: rfiMessages.via,
      attachments: rfiMessages.attachments,
      createdAt: rfiMessages.createdAt,
    })
    .from(rfiMessages)
    .where(and(eq(rfiMessages.rfiId, rfi.id), inArray(rfiMessages.type, PUBLIC_MESSAGE_TYPES)))
    .orderBy(rfiMessages.createdAt);
  const messages = rows.map((m) => ({ ...m, attachments: parseAttachments(m.attachments) }));
  // The sheets this RFI pinned — rendered by the sheet route, one per doc+page.
  const pins = await db
    .select({ doc: planPins.doc, page: planPins.page })
    .from(planPins)
    .where(and(eq(planPins.projectId, scope.projectId), eq(planPins.recordType, "rfi"), eq(planPins.recordId, rfi.id)));
  const sheets = [...new Map(pins.map((p) => [`${p.doc}::${p.page}`, p])).values()];

  return {
    company,
    project: proj?.name ?? "The project",
    rfi: {
      id: rfi.id,
      label: rfiLabel(rfi),
      revision: rfi.revision,
      subject: rfi.subject,
      status: rfi.status,
      discipline: rfi.discipline,
      priority: rfi.priority,
      location: rfi.location,
      question: rfi.question,
      proposedSolution: rfi.proposedSolution,
      codeRefs: rfi.codeRefs ? (JSON.parse(rfi.codeRefs) as string[]) : [],
      costImpact: rfi.costImpact,
      costEstimate: rfi.costEstimate,
      programmeImpact: rfi.programmeImpact,
      programmeDays: rfi.programmeDays,
      consultantName: rfi.consultantName,
      consultantCompany: rfi.consultantCompany,
      assignees: rfiAssignees(rfi).map((a) => ({ name: a.name, company: a.company })),
      dateRaised: rfi.dateRaised,
      dateRequiredBy: rfi.dateRequiredBy,
      dateAnswered: rfi.dateAnswered,
      attachments: parseAttachments(rfi.attachments),
      // Where the consultant's own files go (the upload doors sign only this folder).
      uploadPrefix: rfiBlobPrefix(scope.projectId, rfi.id),
    },
    messages,
    sheets,
    canAnswer: rfi.status === "open",
    canComment: rfi.status === "open" || rfi.status === "answered",
  };
}

/** The consultant's official answer: open → answered, clock stops, thread
 *  gains the answer, and whoever pressed Send hears about it. */
export async function answerByToken(
  token: string,
  body: string,
  authorName?: string | null,
  via: "link" | "portal" = "link",
  files?: Attachment[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rfi = await rfiByToken(token);
  if (!rfi || rfi.status === "void" || rfi.number == null) return { ok: false, error: "not-found" };
  return answerAsConsultant(rfi, body, authorName, via, files);
}

/** The official answer from the other side, whichever door it came in. */
export async function answerAsConsultant(
  rfi: Rfi,
  body: string,
  authorName?: string | null,
  via: "link" | "portal" | "email" = "link",
  files?: Attachment[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (rfi.status === "closed") return { ok: false, error: "closed" };
  if (rfi.status !== "open") return { ok: false, error: "not-open" };
  const scope = tokenScope(rfi);
  const name = authorName?.trim().slice(0, 120) || rfi.consultantName || rfi.consultantCompany || "The consultant";
  const atts = cleanFiles(files, [rfiBlobPrefix(rfi.projectId, rfi.id), `${rfi.projectId}/inbound/${rfi.id}/`]);
  try {
    await logAnswer(scope, rfi.id, body, { userId: null, name, consultantName: name, via }, atts);
  } catch {
    // Lost the atomic claim: someone answered (or closed it) a moment ago.
    return { ok: false, error: "not-open" };
  }
  // Best-effort: the answer is logged whatever happens to the notice email.
  try {
    await notifyAnswer(scope, rfi, body, name, attachmentsLine(atts));
  } catch (e) {
    console.error("rfi answer notice failed:", e);
  }
  return { ok: true };
}

/** A consultant comment that is NOT the official answer (a clarifying
 *  question, a partial note). Ball and clock do not move — the scorecard
 *  stays honest: they have not answered yet. */
export async function commentByToken(
  token: string,
  body: string,
  authorName?: string | null,
  via: "link" | "portal" = "link",
  files?: Attachment[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rfi = await rfiByToken(token);
  if (!rfi || rfi.status === "void" || rfi.number == null) return { ok: false, error: "not-found" };
  return commentAsConsultant(rfi, body, authorName, via, files);
}

export async function commentAsConsultant(
  rfi: Rfi,
  body: string,
  authorName?: string | null,
  via: "link" | "portal" | "email" = "link",
  files?: Attachment[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (rfi.status !== "open" && rfi.status !== "answered") return { ok: false, error: "closed" };
  const name = authorName?.trim().slice(0, 120) || rfi.consultantName || rfi.consultantCompany || "The consultant";
  const atts = cleanFiles(files, [rfiBlobPrefix(rfi.projectId, rfi.id), `${rfi.projectId}/inbound/${rfi.id}/`]);
  const text = body.trim() || "(see attachments)";
  await db.insert(rfiMessages).values({
    companyId: rfi.companyId,
    projectId: rfi.projectId,
    rfiId: rfi.id,
    type: "followup",
    authorSide: "consultant",
    authorName: name,
    body: text,
    via,
    attachments: atts.length ? JSON.stringify(atts) : null,
  });
  // The app has no notifications, so every message from the other side lands
  // in the sender's inbox too (Adam 2026-09-10) - same notice an email reply gets.
  if (via !== "email") {
    try {
      await notifyConsultantNote(rfi, name, text, attachmentsLine(atts), via);
    } catch (e) {
      console.error("rfi comment notice failed:", e);
    }
  }
  return { ok: true };
}

async function notifyConsultantNote(rfi: Rfi, actor: string, text: string, attLine: string | null, via: string) {
  const scope = tokenScope(rfi);
  const to = await senderEmailOf(rfi);
  if (!to) return;
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const projectName = proj?.name ?? "The project";
  const company = (await companyName(scope.companyId)) ?? "The builder";
  const label = rfiLabel(rfi);
  const rendered = renderThreadNotice({
    companyName: company,
    projectName,
    heading: `${label} · note from the consultant`,
    subject: rfi.subject,
    actorLine: actor,
    lead: `added a note on ${label}${via === "portal" ? " from the portal" : ""}. It is in the thread${rfi.status === "open" ? " - open the RFI to log it as the official answer if it is one" : ""}.`,
    body: text,
    attachmentsLine: attLine,
    linkLabel: "Open the RFI in Soterra",
    linkUrl: APP_URL,
    refLabel: `${label} · ${projectName}`.slice(0, 80),
    tone: "green",
  });
  await sendEmail({
    scope,
    kind: "rfi",
    recordType: "rfi",
    recordIds: [rfi.id],
    to: { email: to },
    replyTo: rfi.consultantEmail ?? null,
    fromName: "Soterra",
    fromEmail: projectSenderAddress(projectName, scope.projectId),
    subject: `${label} note · ${projectName} · ${rfi.subject}`,
    html: rendered.html,
    text: rendered.text,
    sentByName: actor,
  });
}

/** An email reply that arrived on the RFI's reply address (lib/inbound.ts).
 *  From the consultant's side it is logged as a consultant note - never
 *  auto-promoted to the official answer, because "I'll look tomorrow" is
 *  also an email reply; the site team promotes it with one click in the
 *  thread (promoteToAnswer). From our own side (the sender replying from
 *  their inbox) it is logged as our follow-up. Either way the OTHER side is
 *  told, so nobody has to watch two inboxes. */
export async function emailReplyOnRfi(
  rfi: Rfi,
  from: { email: string; name: string },
  text: string,
  attachments: Attachment[]
): Promise<{ handled: "rfi_comment" | "rfi_followup" | "rejected" }> {
  if (rfi.status === "void" || rfi.number == null) return { handled: "rejected" };
  const scope = tokenScope(rfi);
  // The stored files go on the thread line itself (so they open from the
  // RFI page) and are named in the notice to the other side.
  const attJson = attachments.length ? JSON.stringify(attachments) : null;
  const attachmentsLine = attachments.length
    ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}: ${attachments.map((a) => a.filename).join(" · ")}`
    : null;
  const fromLower = from.email.toLowerCase();
  const senderLower = (await senderEmailOf(rfi))?.toLowerCase() ?? null;
  // Our own sender replying from their inbox is the one internal case; anyone
  // else on the reply address is the other side (the consultant, their cc).
  const external = !senderLower || fromLower !== senderLower;
  const body = text.trim() || "(no text - see attachments)";
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const projectName = proj?.name ?? "The project";
  const company = (await companyName(scope.companyId)) ?? "The builder";
  const label = rfiLabel(rfi);

  if (external) {
    // Closed RFIs still take the note (a late "thanks" or a correction is
    // worth keeping); the ball does not move.
    await db.insert(rfiMessages).values({
      companyId: rfi.companyId,
      projectId: rfi.projectId,
      rfiId: rfi.id,
      type: "followup",
      authorSide: "consultant",
      authorName: from.name || rfi.consultantName || rfi.consultantCompany || from.email,
      body,
      via: "email",
      attachments: attJson,
    });
    // Tell whoever pressed Send, with the one-click promote in the app.
    const to = await senderEmailOf(rfi);
    if (to) {
      const rendered = renderThreadNotice({
        companyName: company,
        projectName,
        heading: `${label} · reply by email`,
        subject: rfi.subject,
        actorLine: from.name || from.email,
        lead: `replied to ${label} by email. It is in the thread${rfi.status === "open" ? " - open the RFI to log it as the official answer if it is one" : ""}.`,
        body,
        attachmentsLine,
        linkLabel: "Open the RFI in Soterra",
        linkUrl: APP_URL,
        refLabel: `${label} · ${projectName}`.slice(0, 80),
        tone: "green",
      });
      await sendEmail({
        scope,
        kind: "inbound",
        recordType: "rfi",
        recordIds: [rfi.id],
        to: { email: to },
        replyTo: rfi.consultantEmail ?? null,
        fromName: "Soterra",
        fromEmail: projectSenderAddress(projectName, scope.projectId),
        subject: `${label} reply · ${projectName} · ${rfi.subject}`,
        html: rendered.html,
        text: rendered.text,
        sentByName: from.name || from.email,
      });
    }
    return { handled: "rfi_comment" };
  }

  // Our side replying from their own inbox: log it as our follow-up and pass
  // it on to the consultant with the answer link.
  await db.insert(rfiMessages).values({
    companyId: rfi.companyId,
    projectId: rfi.projectId,
    rfiId: rfi.id,
    type: "followup",
    authorSide: "contractor",
    authorName: from.name || from.email,
    body,
    via: "email",
    attachments: attJson,
  });
  if (rfi.consultantEmail && rfi.answerToken) {
    const loginRequired = await companyRequiresLogin(scope.companyId);
    const rendered = renderThreadNotice({
      companyName: company,
      projectName,
      heading: `${label} · follow-up`,
      subject: rfi.subject,
      actorLine: `${from.name || from.email} · ${company}`,
      lead: `added to ${label}.`,
      body,
      attachmentsLine,
      linkLabel: "Open the RFI",
      linkUrl: `${APP_URL}/answer/${rfi.answerToken}`,
      linkNote: loginRequired ? "Opens for your Soterra account on the address this was sent to." : "No account needed.",
      refLabel: `${label} · ${projectName}`.slice(0, 80),
      portalUrl: PORTAL_URL,
      loginRequired,
    });
    await sendEmail({
      scope,
      kind: "inbound",
      recordType: "rfi",
      recordIds: [rfi.id],
      to: { name: rfi.consultantName || rfi.consultantCompany, email: rfi.consultantEmail },
      replyTo: (await replyAddress("rfi", rfi.answerToken)) ?? from.email,
      fromName: `${company} (via Soterra)`,
      fromEmail: projectSenderAddress(projectName, scope.projectId),
      subject: `${label} · ${projectName} · ${rfi.subject}`,
      html: rendered.html,
      text: rendered.text,
      sentByName: from.name || from.email,
    });
  }
  return { handled: "rfi_followup" };
}

/** Whoever pressed Send: the Reply-To stamped on the outbound send, read back
 *  from the email log. With inbound on, that Reply-To is the reply address,
 *  so we fall through to the sender recorded on the log row instead. */
async function senderEmailOf(rfi: Rfi): Promise<string | null> {
  if (!rfi.emailLogId) return null;
  const [logRow] = await db
    .select({ replyTo: emailLog.replyTo, sentBy: emailLog.sentBy })
    .from(emailLog)
    .where(eq(emailLog.id, rfi.emailLogId))
    .limit(1);
  const to = logRow?.replyTo?.trim();
  if (to && !/^(rfi|cor|fix|so)-[A-Za-z0-9_-]{20,64}@/i.test(to)) return to;
  // Inbound was on at send time, so the Reply-To is the reply address, not a
  // person. The log still knows WHO pressed Send (their Clerk id).
  return clerkPrimaryEmail(logRow?.sentBy ?? null);
}

/** A Clerk user's primary email, for notices to whoever pressed Send. */
export async function clerkPrimaryEmail(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(userId);
    const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses[0];
    return primary?.emailAddress ?? null;
  } catch (e) {
    console.error("clerk user lookup failed:", e);
    return null;
  }
}

/** Sheet render for the public page — only sheets this RFI actually pinned. */
export async function tokenSheetPng(token: string, doc: string, page: number): Promise<Buffer | null> {
  const rfi = await rfiByToken(token);
  if (!rfi || rfi.status === "void" || rfi.status === "draft" || rfi.number == null) return null;
  const pins = await db
    .select()
    .from(planPins)
    .where(
      and(
        eq(planPins.projectId, rfi.projectId),
        eq(planPins.recordType, "rfi"),
        eq(planPins.recordId, rfi.id),
        eq(planPins.doc, doc),
        eq(planPins.page, page)
      )
    );
  if (!pins.length) return null; // token cannot render arbitrary sheets
  return renderSheetWithPins(
    rfi.projectId,
    doc,
    page,
    pins.map((p) => ({ x: p.x, y: p.y, label: String(rfi.number ?? "") }))
  );
}

/** Tell whoever pressed Send that the answer is in. Their address is the
 *  Reply-To we stamped on the outbound send — read back from the email log. */
async function notifyAnswer(scope: Scope, rfi: Rfi, answer: string, consultantLine: string, attachmentsLine?: string | null) {
  const to = await senderEmailOf(rfi);
  if (!to) return;
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const projectName = proj?.name ?? "Your project";
  const company = (await companyName(scope.companyId)) ?? "Your company";
  const label = rfiLabel(rfi);
  const rendered = renderRfiAnswerNotice({
    companyName: company,
    projectName,
    rfiNumber: label,
    rfiSubject: rfi.subject,
    consultantLine,
    answer,
    attachmentsLine: attachmentsLine ?? null,
    appUrl: APP_URL,
  });
  await sendEmail({
    scope,
    kind: "rfi",
    recordType: "rfi",
    recordIds: [rfi.id],
    to: { email: to },
    // Replying to the notice goes straight back to the consultant.
    replyTo: rfi.consultantEmail ?? null,
    fromName: "Soterra",
    fromEmail: projectSenderAddress(projectName, scope.projectId),
    subject: `${label} answered · ${projectName} · ${rfi.subject}`,
    html: rendered.html,
    text: rendered.text,
    sentByName: consultantLine,
  });
}

// ─── analytics (the scorecard) ───────────────────────────────────────────

export async function rfiAnalytics(scope: Scope) {
  const rows = await db.select().from(rfis).where(eq(rfis.projectId, scope.projectId));
  const sent = rows.filter((r) => r.number != null && r.status !== "void");
  const trans = sent.length
    ? await db.select().from(rfiTransitions).where(eq(rfiTransitions.projectId, scope.projectId)).orderBy(rfiTransitions.at)
    : [];
  const transByRfi = new Map<string, typeof trans>();
  for (const t of trans) {
    const list = transByRfi.get(t.rfiId) ?? [];
    list.push(t);
    transByRfi.set(t.rfiId, list);
  }
  const now = new Date();

  type Row = {
    consultant: string;
    open: number;
    turnarounds: number[];
    overdue: number;
    lateWds: number[];
    longestOpen: number;
    reopens: number;
    total: number;
  };
  const byConsultant = new Map<string, Row>();
  let openTotal = 0;
  let ballUs = 0;
  const ballBy = new Map<string, number>();
  const eotRows: {
    label: string; subject: string; consultant: string; raised: string | null; requiredBy: string | null;
    answered: string | null; netLateWd: number; programmeDays: number | null; costImpact: string; status: string;
  }[] = [];

  for (const r of sent) {
    const key = r.consultantCompany || r.consultantName || "Unassigned";
    const row = byConsultant.get(key) ?? { consultant: key, open: 0, turnarounds: [], overdue: 0, lateWds: [], longestOpen: 0, reopens: 0, total: 0 };
    row.total++;
    const rTrans = transByRfi.get(r.id) ?? [];
    row.reopens += rTrans.filter((t) => t.fromStatus === "answered" && t.toStatus === "open").length +
      rTrans.filter((t) => t.fromStatus === "closed" && t.toStatus === "open").length;

    if (r.status === "open") {
      row.open++;
      openTotal++;
      ballBy.set(key, (ballBy.get(key) ?? 0) + 1);
      const openWd = r.dateRaised ? workingDaysBetween(r.dateRaised, now) : 0;
      if (openWd > row.longestOpen) row.longestOpen = openWd;
      if (r.dateRequiredBy && now > r.dateRequiredBy) {
        row.overdue++;
        row.lateWds.push(workingDaysBetween(r.dateRequiredBy, now));
      }
    } else if (r.status === "answered" || r.status === "closed") {
      if (r.status === "answered") { openTotal++; ballUs++; }
      if (r.dateAnswered) {
        const net = consultantWorkingDays(
          rTrans.map((t) => ({ ballTo: t.ballTo, at: t.at })),
          r.dateAnswered
        );
        row.turnarounds.push(net);
      }
    }
    byConsultant.set(key, row);

    // EOT: critical path + late (answered late, or open past required-by).
    if (r.criticalPath && r.dateRequiredBy) {
      const lateEnd = r.dateAnswered ?? now;
      const netLate = lateEnd > r.dateRequiredBy ? workingDaysBetween(r.dateRequiredBy, lateEnd) : 0;
      if (netLate > 0) {
        eotRows.push({
          label: rfiLabel(r),
          subject: r.subject,
          consultant: key,
          raised: r.dateRaised?.toISOString() ?? null,
          requiredBy: r.dateRequiredBy.toISOString(),
          answered: r.dateAnswered?.toISOString() ?? null,
          netLateWd: netLate,
          programmeDays: r.programmeDays,
          costImpact: r.costImpact,
          status: r.status,
        });
      }
    }
  }

  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const scorecard = [...byConsultant.values()]
    .map((r) => ({
      consultant: r.consultant,
      open: r.open,
      avgWd: +avg(r.turnarounds).toFixed(1),
      medianWd: +median(r.turnarounds).toFixed(1),
      pctInSla: r.turnarounds.length ? Math.round((r.turnarounds.filter((t) => t <= RFI_SLA_WORKING_DAYS).length / r.turnarounds.length) * 100) : null,
      overdue: r.overdue,
      avgLateWd: +avg(r.lateWds).toFixed(1),
      longestOpenWd: r.longestOpen,
      reopenPct: r.total ? Math.round((r.reopens / r.total) * 100) : 0,
      answered: r.turnarounds.length,
    }))
    .sort((a, b) => (b.avgWd || 0) - (a.avgWd || 0));

  const allTurnarounds = scorecard.flatMap((s) => Array(s.answered).fill(0)).length
    ? [...byConsultant.values()].flatMap((r) => r.turnarounds)
    : [];
  return {
    slaWd: RFI_SLA_WORKING_DAYS,
    tiles: {
      openTotal,
      ballConsultants: openTotal - ballUs,
      ballUs,
      avgResponseWd: +avg(allTurnarounds).toFixed(1),
      overdue: scorecard.reduce((n, s) => n + s.overdue, 0),
      criticalPath: sent.filter((r) => r.criticalPath && r.status === "open").length,
      raisedTotal: sent.length,
    },
    scorecard,
    ballSplit: [...ballBy.entries()].map(([consultant, count]) => ({ consultant, count })).sort((a, b) => b.count - a.count),
    eot: eotRows.sort((a, b) => b.netLateWd - a.netLateWd),
  };
}
