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
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { contractInstructions, emailLog, planPins, projects, rfiMessages, rfis, rfiTransitions } from "./schema";
import type { Rfi } from "./schema";
import type { Scope } from "./company";
import { companyName } from "./company";
import { emailEnabled, projectSenderAddress, sendEmail, type EmailAttachment } from "./email";
import { renderRfiAnswerNotice, renderRfiEmail } from "./emailTemplates";
import { renderSheetWithPins } from "./pinSnapshot";

/** Where the consultant answer link points. One env override for previews. */
const APP_URL = (process.env.APP_BASE_URL ?? "https://soterra.co.nz").replace(/\/+$/, "");

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
};

export async function createDraft(scope: Scope, input: NewRfiInput): Promise<Rfi> {
  const [row] = await db
    .insert(rfis)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      subject: input.subject.trim().slice(0, 200),
      discipline: input.discipline ?? null,
      priority: input.priority ?? "normal",
      location: input.location?.trim().slice(0, 120) || null,
      question: input.question.trim(),
      proposedSolution: input.proposedSolution?.trim() || null,
      codeRefs: input.codeRefs?.length ? JSON.stringify(input.codeRefs) : null,
      consultantName: input.consultantName?.trim() || null,
      consultantCompany: input.consultantCompany?.trim() || null,
      consultantEmail: input.consultantEmail?.trim() || null,
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

  const codeRefs: string[] = rfi.codeRefs ? JSON.parse(rfi.codeRefs) : [];
  const cc: string[] = rfi.cc ? JSON.parse(rfi.cc) : [];
  const meta = [
    { label: "Discipline", value: rfi.discipline ?? "General" },
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
    attachments: attachments.map((a) => a.filename),
    replyName: by.name ?? "the sender",
    refLabel: `${label} · Rev ${opened.revision}`,
    answerUrl: `${APP_URL}/answer/${answerToken}`,
  });

  const result = await sendEmail({
    scope,
    kind: "rfi",
    recordType: "rfi",
    recordIds: [rfi.id],
    to: { name: rfi.consultantName || rfi.consultantCompany, email: rfi.consultantEmail },
    cc,
    fromName: `${company} (via Soterra)`,
    fromEmail: projectSenderAddress(projectName, scope.projectId),
    replyTo: by.email ?? null,
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
      ? `Sent to ${rfi.consultantName ?? ""} ${rfi.consultantCompany ?? ""}`.trim() + (cc.length ? ` · cc ${cc.join(", ")}` : "")
      : `Recorded for ${rfi.consultantName ?? ""} ${rfi.consultantCompany ?? ""}`.trim() + " (email sending not yet live)",
  });
  const fresh = await ourRfi(scope, rfi.id);
  return { rfi: fresh ?? opened, emailStatus: result.status };
}

export async function logAnswer(
  scope: Scope,
  rfiId: string,
  body: string,
  by: { userId?: string | null; name?: string | null; consultantName?: string | null }
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
  });
  return claimed;
}

export async function addFollowup(
  scope: Scope,
  rfiId: string,
  body: string,
  by: { userId?: string | null; name?: string | null },
  opts?: { bounce?: boolean }
): Promise<Rfi> {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) throw new Error("RFI not found");
  await db.insert(rfiMessages).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    rfiId,
    type: "followup",
    authorSide: "contractor",
    authorName: by.name ?? null,
    body: body.trim(),
  });
  // A follow-up on an answered RFI can bounce the ball back (status → open).
  if (opts?.bounce && rfi.status === "answered") {
    return transition(scope, rfi, "open", by, "follow-up bounced the ball back");
  }
  const fresh = await ourRfi(scope, rfiId);
  return fresh ?? rfi;
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

export async function createCi(
  scope: Scope,
  rfiId: string,
  input: { title: string; amendsDrawings?: { doc: string; fromRev?: string; toRev?: string }[]; cost?: string | null },
  by: { userId?: string | null; name?: string | null }
) {
  const rfi = await ourRfi(scope, rfiId);
  if (!rfi) throw new Error("RFI not found");
  const [maxRow] = await db
    .select({ number: contractInstructions.number })
    .from(contractInstructions)
    .where(eq(contractInstructions.projectId, scope.projectId))
    .orderBy(desc(contractInstructions.number))
    .limit(1);
  const number = (maxRow?.number ?? 0) + 1;
  const [ci] = await db
    .insert(contractInstructions)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      number,
      title: input.title.trim().slice(0, 200),
      sourceRfiId: rfi.id,
      amendsDrawings: input.amendsDrawings?.length ? JSON.stringify(input.amendsDrawings) : null,
      cost: input.cost ?? null,
      createdBy: by.userId ?? null,
    })
    .returning();
  await db.update(rfis).set({ resultingCiId: ci.id, updatedAt: new Date() }).where(eq(rfis.id, rfi.id));
  await db.insert(rfiMessages).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    rfiId,
    type: "system",
    authorSide: "contractor",
    authorName: by.name ?? null,
    body: `Answer spawned CI-${String(number).padStart(3, "0")}${input.amendsDrawings?.length ? ` · amends ${input.amendsDrawings.map((d) => d.doc).join(", ")}` : ""}`,
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
  const now = new Date();
  return rows.map((r) => {
    const daysOpen = r.dateRaised ? workingDaysBetween(r.dateRaised, r.status === "closed" && r.dateClosed ? r.dateClosed : now) : 0;
    const overdue = r.status === "open" && !!r.dateRequiredBy && now > r.dateRequiredBy;
    const lateWd = overdue && r.dateRequiredBy ? workingDaysBetween(r.dateRequiredBy, now) : 0;
    return { ...publicRfi(r), label: rfiLabel(r), daysOpen, overdue, lateWd };
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
  const ci = rfi.resultingCiId
    ? (await db.select().from(contractInstructions).where(eq(contractInstructions.id, rfi.resultingCiId)).limit(1))[0] ?? null
    : null;
  const now = new Date();
  return {
    rfi: {
      ...publicRfi(rfi),
      label: rfiLabel(rfi),
      daysOpen: rfi.dateRaised ? workingDaysBetween(rfi.dateRaised, now) : 0,
      overdue: rfi.status === "open" && !!rfi.dateRequiredBy && now > rfi.dateRequiredBy,
    },
    messages,
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

async function rfiByToken(token: string): Promise<Rfi | null> {
  const clean = token.trim();
  // base64url of 24 bytes is 32 chars; reject junk before it reaches the db.
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(clean)) return null;
  const [row] = await db.select().from(rfis).where(eq(rfis.answerToken, clean)).limit(1);
  return row ?? null;
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
  const scope = tokenScope(rfi);
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const company = (await companyName(scope.companyId)) ?? "The builder";
  const messages = await db
    .select({
      type: rfiMessages.type,
      authorSide: rfiMessages.authorSide,
      authorName: rfiMessages.authorName,
      body: rfiMessages.body,
      createdAt: rfiMessages.createdAt,
    })
    .from(rfiMessages)
    .where(and(eq(rfiMessages.rfiId, rfi.id), inArray(rfiMessages.type, PUBLIC_MESSAGE_TYPES)))
    .orderBy(rfiMessages.createdAt);
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
      dateRaised: rfi.dateRaised,
      dateRequiredBy: rfi.dateRequiredBy,
      dateAnswered: rfi.dateAnswered,
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
  authorName?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rfi = await rfiByToken(token);
  if (!rfi || rfi.status === "void" || rfi.number == null) return { ok: false, error: "not-found" };
  if (rfi.status === "closed") return { ok: false, error: "closed" };
  if (rfi.status !== "open") return { ok: false, error: "not-open" };
  const scope = tokenScope(rfi);
  const name = authorName?.trim().slice(0, 120) || rfi.consultantName || rfi.consultantCompany || "The consultant";
  try {
    await logAnswer(scope, rfi.id, body, { userId: null, name, consultantName: name });
  } catch {
    // Lost the atomic claim: someone answered (or closed it) a moment ago.
    return { ok: false, error: "not-open" };
  }
  // Best-effort: the answer is logged whatever happens to the notice email.
  try {
    await notifyAnswer(scope, rfi, body, name);
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
  authorName?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rfi = await rfiByToken(token);
  if (!rfi || rfi.status === "void" || rfi.number == null) return { ok: false, error: "not-found" };
  if (rfi.status !== "open" && rfi.status !== "answered") return { ok: false, error: "closed" };
  const name = authorName?.trim().slice(0, 120) || rfi.consultantName || rfi.consultantCompany || "The consultant";
  await db.insert(rfiMessages).values({
    companyId: rfi.companyId,
    projectId: rfi.projectId,
    rfiId: rfi.id,
    type: "followup",
    authorSide: "consultant",
    authorName: name,
    body: body.trim(),
  });
  return { ok: true };
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
async function notifyAnswer(scope: Scope, rfi: Rfi, answer: string, consultantLine: string) {
  if (!rfi.emailLogId) return;
  const [logRow] = await db.select({ replyTo: emailLog.replyTo }).from(emailLog).where(eq(emailLog.id, rfi.emailLogId)).limit(1);
  const to = logRow?.replyTo?.trim();
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
