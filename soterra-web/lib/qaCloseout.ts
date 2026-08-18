// ─── The QA close-out engine ─────────────────────────────────────────────
//
// A defect (a qa_flag pinned on a drawing, or an item off a filed inspection
// report) does not just get emailed and forgotten - it runs a close-out loop:
//
//   open   (with the main contractor)
//    -> sent      emailed to the sub with a "Mark it fixed" link; clock on the sub
//    -> ready     the sub marked it fixed and attached a photo; ball back to the MC
//    -> then by type:
//         INTERNAL (qa_flags, and inspection_items off a COUNCIL report):
//            the MC closes it directly            -> closed
//         CONSULTANT (inspection_items off a CONSULTANT report):
//            the MC forwards it to the consultant -> submitted (clock on consultant)
//            -> consultant signs off              -> closed
//            -> consultant bounces it back        -> sent (the sub redoes it)
//   At any review step the MC can reject          -> sent (with a note).
//   The SUB never closes. Only the MC (internal) or the consultant closes.
//
// This mirrors lib/rfi.ts but leaner: no numbers, no revisions, no cost /
// programme / EOT, no separate thread table. The loop lives on the defect row's
// own closeout_status column; the legacy status / work_status columns are left
// to the existing screens and only nudged in step at close.
//
// TOKENS ARE THE AUTHORISATION. The sub's /fix link carries sub_token; the
// consultant's /signoff link carries consultant_token. Holding one proves you
// were sent that exact defect - that is the whole auth for the public pages.
// The scope is rebuilt from the ROW's own company / project ids, never the
// client, so a leaked link reaches one defect and nothing else. Tokens are
// stripped from every browser payload (payloads are built field by field).
//
// neon-http has no transactions, so every state hand-off that a public link can
// race (mark-ready, sign-off) is an ATOMIC conditional UPDATE: the WHERE on the
// current closeout_status is the lock, and exactly one writer wins.

import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { inspectionItems, inspections, projects, qaFlags } from "./schema";
import type { Scope } from "./company";
import { companyName } from "./company";
import { projectSenderAddress, sendEmail } from "./email";
import { renderQaCloseoutNotice, renderQaSignoffEmail } from "./emailTemplates";
import { workingDaysBetween } from "./rfi";

/** Where the public /fix and /signoff links point. One env override for previews. */
const APP_URL = (process.env.APP_BASE_URL ?? "https://soterra.co.nz").replace(/\/+$/, "");

/** Working days a sub / consultant has before a defect counts as overdue on the
 *  scorecard. A defect fix is quicker than an RFI answer, hence shorter than the
 *  RFI SLA of 7. Not enforced, only reported. */
export const QA_CLOSEOUT_SLA_WORKING_DAYS = 5;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

export type CloseoutKind = "flag" | "item";
type FlagRow = typeof qaFlags.$inferSelect;
type ItemRow = typeof inspectionItems.$inferSelect;

/** Ids come from the ROW, never the client (see the header note). */
function tokenScope(row: { projectId: string; companyId: string }): Scope {
  return {
    projectId: row.projectId,
    companyId: row.companyId as Scope["companyId"],
    userId: "",
    role: "qa-link",
  };
}

// ─── token lookups ─────────────────────────────────────────────────────────

/** A sub_token belongs to exactly one defect on one of the two tables. Flags are
 *  checked first; the tables share the token namespace but a collision across
 *  them is astronomically unlikely (24 random bytes each). */
async function bySubToken(token: string): Promise<{ kind: "flag"; row: FlagRow } | { kind: "item"; row: ItemRow } | null> {
  const clean = token.trim();
  if (!TOKEN_RE.test(clean)) return null;
  const [flag] = await db.select().from(qaFlags).where(eq(qaFlags.subToken, clean)).limit(1);
  if (flag) return { kind: "flag", row: flag };
  const [item] = await db.select().from(inspectionItems).where(eq(inspectionItems.subToken, clean)).limit(1);
  if (item) return { kind: "item", row: item };
  return null;
}

/** consultant_token lives only on inspection_items (only they can be forwarded). */
async function byConsultantToken(token: string): Promise<ItemRow | null> {
  const clean = token.trim();
  if (!TOKEN_RE.test(clean)) return null;
  const [item] = await db.select().from(inspectionItems).where(eq(inspectionItems.consultantToken, clean)).limit(1);
  return item ?? null;
}

// ─── context reads (project / company names for emails + payloads) ──────────

async function projectAndCompany(scope: Scope): Promise<{ project: string; company: string }> {
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const company = (await companyName(scope.companyId)) ?? "The builder";
  return { project: proj?.name ?? "The project", company };
}

/** True when an inspection item belongs to a CONSULTANT report - the only
 *  defects that route through a consultant sign-off. */
async function itemIsConsultant(item: ItemRow): Promise<boolean> {
  const [insp] = await db
    .select({ source: inspections.source })
    .from(inspections)
    .where(and(eq(inspections.id, item.inspectionId), eq(inspections.companyId, item.companyId)))
    .limit(1);
  return insp?.source === "consultant";
}

// ─── arming: mint the sub link as part of the EXISTING send ─────────────────
//
// The send routes (app/api/flags PATCH, app/api/inspections/send-items) already
// compose + record the email and stamp sentTo/sentAt. These helpers slot into
// that: mint the sub_token BEFORE composing (so the "Mark it fixed" url can ride
// out in the same email), then the route flips closeout_status to 'sent' and
// stamps sender_email on its success write. Nothing here sends its own email.

function fixUrl(token: string): string {
  return `${APP_URL}/fix/${token}`;
}

/** Mint + persist a flag's sub_token if absent; return its "Mark it fixed" url. */
export async function armFlagFix(scope: Scope, flagId: string): Promise<{ token: string; url: string } | null> {
  const [flag] = await db
    .select({ id: qaFlags.id, subToken: qaFlags.subToken })
    .from(qaFlags)
    .where(and(eq(qaFlags.id, flagId), eq(qaFlags.projectId, scope.projectId)))
    .limit(1);
  if (!flag) return null;
  const token = flag.subToken ?? mintToken();
  if (!flag.subToken) await db.update(qaFlags).set({ subToken: token }).where(eq(qaFlags.id, flagId));
  return { token, url: fixUrl(token) };
}

/** Mint + persist sub_tokens for a batch of inspection items; return id -> url.
 *  Items already carrying a token keep it (a resend reuses the same link). */
export async function armItemsFix(scope: Scope, itemIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!itemIds.length) return out;
  const rows = await db
    .select({ id: inspectionItems.id, subToken: inspectionItems.subToken })
    .from(inspectionItems)
    .where(
      and(
        eq(inspectionItems.companyId, scope.companyId),
        eq(inspectionItems.projectId, scope.projectId),
        inArray(inspectionItems.id, itemIds)
      )
    );
  for (const r of rows) {
    const token = r.subToken ?? mintToken();
    if (!r.subToken) await db.update(inspectionItems).set({ subToken: token }).where(eq(inspectionItems.id, r.id));
    out.set(r.id, fixUrl(token));
  }
  return out;
}

// ─── the sub's /fix page (token-authorised, no login) ───────────────────────

/** Everything the /fix page shows. Null = bad token. Tokens are never returned. */
export async function getFixByToken(token: string) {
  const found = await bySubToken(token);
  if (!found) return null;
  const row = found.row;
  const scope = tokenScope(row);
  const { project, company } = await projectAndCompany(scope);
  const defect =
    found.kind === "flag"
      ? {
          title: (row as FlagRow).title,
          detail: (row as FlagRow).note,
          location: `${(row as FlagRow).doc} · p${(row as FlagRow).page}`,
          category: (row as FlagRow).trade,
        }
      : {
          title: (row as ItemRow).title,
          detail: (row as ItemRow).detail,
          location: (row as ItemRow).location,
          category: (row as ItemRow).category,
        };
  return {
    company,
    project,
    defect,
    status: row.closeoutStatus,
    hasFixPhoto: !!row.fixPhoto,
    // The button is live only while the ball is with the sub.
    canSubmit: row.closeoutStatus === "sent",
  };
}

/** The sub marks it fixed. ATOMIC claim on closeout_status='sent': the public
 *  link means two taps can race, and neon-http has no transactions, so the
 *  conditional UPDATE is the lock - exactly one writer flips sent -> ready, the
 *  loser sees zero rows and gets {ok:false}. Then the MC is notified (best
 *  effort: the fix is recorded whatever happens to the email). */
export async function markReadyByToken(
  token: string,
  input: { photoBlobPath?: string | null; note?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const found = await bySubToken(token);
  if (!found) return { ok: false, error: "not-found" };
  const row = found.row;
  const now = new Date();
  const note = input.note?.trim().slice(0, 4000) || null;
  // Only accept a photo path that lives under THIS defect's own blob namespace,
  // proving it came from this defect's upload (the path is built server-side in
  // the photo route from the row's ids, never trusted from the client verbatim).
  const photo =
    input.photoBlobPath && input.photoBlobPath.startsWith(`${row.projectId}/qa-fix/${row.id}/`)
      ? input.photoBlobPath
      : null;

  const set = { closeoutStatus: "ready", readyAt: now, fixPhoto: photo, subNote: note };
  const claimed =
    found.kind === "flag"
      ? (await db.update(qaFlags).set(set).where(and(eq(qaFlags.id, row.id), eq(qaFlags.closeoutStatus, "sent"))).returning())[0]
      : (await db.update(inspectionItems).set(set).where(and(eq(inspectionItems.id, row.id), eq(inspectionItems.closeoutStatus, "sent"))).returning())[0];
  if (!claimed) {
    // Lost the claim: already ready / closed, or never sent.
    return { ok: false, error: row.closeoutStatus === "sent" ? "race" : "not-open" };
  }

  try {
    await notifyMc(found.kind, claimed, {
      kind: "ready",
      actorLine: subLine(found.kind, claimed),
      note,
      nextLine: "marked this fixed. Review it and close it out, or forward it to the consultant to sign off.",
    });
  } catch (e) {
    console.error("qa markReady notice failed:", e);
  }
  return { ok: true };
}

// ─── the consultant's /signoff page (token-authorised, no login) ────────────

/** Everything the /signoff page shows, including the sub's fix note. The photo
 *  itself streams through the token-authorised photo route. Null = bad token. */
export async function getSignoffByToken(token: string) {
  const item = await byConsultantToken(token);
  if (!item) return null;
  const scope = tokenScope(item);
  const { project, company } = await projectAndCompany(scope);
  return {
    company,
    project,
    defect: {
      title: item.title,
      detail: item.detail,
      location: item.location,
      category: item.category,
    },
    subLine: item.sentTo ?? "The subcontractor",
    fixNote: item.subNote,
    hasFixPhoto: !!item.fixPhoto,
    status: item.closeoutStatus,
    canSignoff: item.closeoutStatus === "submitted",
  };
}

/** The consultant's decision. ATOMIC claim on closeout_status='submitted'.
 *  approve -> closed (closed_at set); bounce -> back to sent so the sub's
 *  ORIGINAL /fix link comes alive again (the sub_token is left in place - the
 *  status flip is what re-arms it). Then the MC is notified. */
export async function signoffByToken(
  token: string,
  input: { approve: boolean; note?: string | null }
): Promise<{ ok: true; approved: boolean } | { ok: false; error: string }> {
  const item = await byConsultantToken(token);
  if (!item) return { ok: false, error: "not-found" };
  const now = new Date();
  const note = input.note?.trim().slice(0, 4000) || null;

  const set = input.approve
    ? { closeoutStatus: "closed", closedAt: now, reviewNote: note, workStatus: "done" }
    : { closeoutStatus: "sent", reviewNote: note };
  const [claimed] = await db
    .update(inspectionItems)
    .set(set)
    .where(and(eq(inspectionItems.id, item.id), eq(inspectionItems.closeoutStatus, "submitted")))
    .returning();
  if (!claimed) return { ok: false, error: "not-open" };

  try {
    await notifyMc("item", claimed, {
      kind: input.approve ? "signed_off" : "bounced",
      actorLine: item.consultantName || item.consultantEmail || "The consultant",
      note,
      nextLine: input.approve
        ? "signed this off. It is closed - nothing further needed."
        : "bounced this back. It is back with the sub to redo, and the sub's fix link is live again.",
    });
  } catch (e) {
    console.error("qa signoff notice failed:", e);
  }
  return { ok: true, approved: input.approve };
}

// ─── the MC side (authed, scoped through resolveScope by the caller) ─────────

async function ourFlag(scope: Scope, id: string): Promise<FlagRow | null> {
  const [row] = await db.select().from(qaFlags).where(and(eq(qaFlags.id, id), eq(qaFlags.projectId, scope.projectId))).limit(1);
  return row ?? null;
}
async function ourItem(scope: Scope, id: string): Promise<ItemRow | null> {
  const [row] = await db.select().from(inspectionItems).where(and(eq(inspectionItems.id, id), eq(inspectionItems.projectId, scope.projectId))).limit(1);
  return row ?? null;
}

/** Internal close: the MC signs off a ready defect directly (no consultant).
 *  Claim on closeout_status='ready'. Legacy status is nudged to done in step. */
export async function reviewClose(
  scope: Scope,
  kind: CloseoutKind,
  id: string,
  input?: { note?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date();
  const note = input?.note?.trim().slice(0, 4000) || null;
  if (kind === "flag") {
    const [row] = await db
      .update(qaFlags)
      .set({ closeoutStatus: "closed", closedAt: now, reviewNote: note, status: "done", fixedAt: now })
      .where(and(eq(qaFlags.id, id), eq(qaFlags.projectId, scope.projectId), eq(qaFlags.closeoutStatus, "ready")))
      .returning();
    return row ? { ok: true } : { ok: false, error: "not-ready" };
  }
  // A consultant-report defect cannot be closed internally - it must be
  // forwarded for the consultant to sign off (mirrors forwardToConsultant's
  // guard). Only internal items (council/other reports) close here.
  const target = await ourItem(scope, id);
  if (!target) return { ok: false, error: "not-found" };
  if (await itemIsConsultant(target)) return { ok: false, error: "needs-consultant" };
  const [row] = await db
    .update(inspectionItems)
    .set({ closeoutStatus: "closed", closedAt: now, reviewNote: note, workStatus: "done" })
    .where(and(eq(inspectionItems.id, id), eq(inspectionItems.projectId, scope.projectId), eq(inspectionItems.closeoutStatus, "ready")))
    .returning();
  return row ? { ok: true } : { ok: false, error: "not-ready" };
}

/** Forward a ready CONSULTANT defect for sign-off: mint the consultant_token,
 *  flip to submitted, email the "/signoff" link. Only inspection_items off a
 *  consultant report qualify. Claim on closeout_status='ready'. */
export async function forwardToConsultant(
  scope: Scope,
  itemId: string,
  input: { name?: string | null; email: string; byName?: string | null }
): Promise<{ ok: true; emailStatus: string } | { ok: false; error: string }> {
  const item = await ourItem(scope, itemId);
  if (!item) return { ok: false, error: "not-found" };
  if (!(await itemIsConsultant(item))) return { ok: false, error: "not-consultant" };
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "bad-email" };
  const name = input.name?.trim().slice(0, 120) || null;

  const now = new Date();
  const token = item.consultantToken ?? mintToken();
  const [claimed] = await db
    .update(inspectionItems)
    .set({
      closeoutStatus: "submitted",
      submittedAt: now,
      consultantToken: token,
      consultantName: name,
      consultantEmail: email,
    })
    .where(and(eq(inspectionItems.id, itemId), eq(inspectionItems.projectId, scope.projectId), eq(inspectionItems.closeoutStatus, "ready")))
    .returning();
  if (!claimed) return { ok: false, error: "not-ready" };

  const { project, company } = await projectAndCompany(scope);
  const rendered = renderQaSignoffEmail({
    companyName: company,
    contextLine: `${project} · ${claimed.category ?? "Inspection"} · marked fixed`,
    title: claimed.title,
    detail: claimed.detail,
    location: claimed.location,
    category: claimed.category,
    subLine: claimed.sentTo ?? "The subcontractor",
    fixNote: claimed.subNote,
    hasPhoto: !!claimed.fixPhoto,
    signoffUrl: `${APP_URL}/signoff/${token}`,
    refLabel: `QA close-out · ${claimed.title}`.slice(0, 80),
  });
  const result = await sendEmail({
    scope,
    kind: "inspection_items",
    recordType: "inspection_item",
    recordIds: [itemId],
    to: { name, email },
    fromName: `${company} (via Soterra)`,
    fromEmail: projectSenderAddress(project, scope.projectId),
    replyTo: claimed.senderEmail ?? null,
    subject: `Sign-off needed · ${project} · ${claimed.title}`,
    html: rendered.html,
    text: rendered.text,
    sentBy: scope.userId || null,
    sentByName: input.byName ?? null,
  });
  return { ok: true, emailStatus: result.status };
}

/** MC reject at a review step: bounce a ready defect back to the sub (its
 *  /fix link comes alive again). Claim on closeout_status='ready'. */
export async function reject(
  scope: Scope,
  kind: CloseoutKind,
  id: string,
  input: { note?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const note = input.note?.trim().slice(0, 4000) || null;
  if (kind === "flag") {
    const [row] = await db
      .update(qaFlags)
      .set({ closeoutStatus: "sent", reviewNote: note })
      .where(and(eq(qaFlags.id, id), eq(qaFlags.projectId, scope.projectId), eq(qaFlags.closeoutStatus, "ready")))
      .returning();
    return row ? { ok: true } : { ok: false, error: "not-ready" };
  }
  const [row] = await db
    .update(inspectionItems)
    .set({ closeoutStatus: "sent", reviewNote: note })
    .where(and(eq(inspectionItems.id, id), eq(inspectionItems.projectId, scope.projectId), eq(inspectionItems.closeoutStatus, "ready")))
    .returning();
  return row ? { ok: true } : { ok: false, error: "not-ready" };
}

// ─── the MC notice ──────────────────────────────────────────────────────────

function subLine(kind: CloseoutKind, row: FlagRow | ItemRow): string {
  if (kind === "flag") return (row as FlagRow).subName || (row as FlagRow).subEmail || "The subcontractor";
  return (row as ItemRow).sentTo || "The subcontractor";
}

/** Tell whoever pressed Send that the ball moved. sender_email is stamped on the
 *  defect at send time; with no address there is nobody to notify (best-effort). */
async function notifyMc(
  kind: CloseoutKind,
  row: FlagRow | ItemRow,
  n: { kind: "ready" | "signed_off" | "bounced"; actorLine: string; note: string | null; nextLine: string }
): Promise<void> {
  const to = (row as { senderEmail?: string | null }).senderEmail?.trim();
  if (!to) return;
  const scope = tokenScope(row);
  const { project, company } = await projectAndCompany(scope);
  const title = kind === "flag" ? (row as FlagRow).title : (row as ItemRow).title;
  const rendered = renderQaCloseoutNotice({
    companyName: company,
    projectName: project,
    title,
    kind: n.kind,
    actorLine: n.actorLine,
    note: n.note,
    nextLine: n.nextLine,
    appUrl: APP_URL,
    refLabel: `QA close-out · ${title}`.slice(0, 80),
  });
  await sendEmail({
    scope,
    kind: kind === "flag" ? "qa_flags" : "inspection_items",
    recordType: kind === "flag" ? "qa_flag" : "inspection_item",
    recordIds: [row.id],
    to: { email: to },
    fromName: "Soterra",
    fromEmail: projectSenderAddress(project, scope.projectId),
    subject: `${title} · ${n.kind === "ready" ? "marked fixed" : n.kind === "signed_off" ? "signed off" : "bounced back"} · ${project}`,
    html: rendered.html,
    text: rendered.text,
    sentByName: n.actorLine,
  });
}

// ─── the sub's fix photo (private Blob, streamed through a token route) ───────

/** Resolve any of a defect's tokens to its stored fix photo, for the streaming
 *  photo route. The token authorises; the path comes from the row. Accepts the
 *  sub's OR the consultant's token (both are entitled to see the fix). */
export async function fixPhotoByToken(token: string): Promise<string | null> {
  const found = await bySubToken(token);
  if (found?.row.fixPhoto) return found.row.fixPhoto;
  const item = await byConsultantToken(token);
  return item?.fixPhoto ?? null;
}

/** Where a sub's fix photo for a given defect must live. Namespaced by project +
 *  defect so one defect's link can never write into (or later read) another's. */
export function fixPhotoPrefix(projectId: string, recordId: string): string {
  return `${projectId}/qa-fix/${recordId}/`;
}

/** The defect a sub_token points at, for the photo-upload route: it needs the
 *  ids to build the blob path, and the status to refuse an upload once the ball
 *  has moved off the sub. */
export async function fixUploadTarget(
  token: string
): Promise<{ projectId: string; recordId: string; canSubmit: boolean } | null> {
  const found = await bySubToken(token);
  if (!found) return null;
  return {
    projectId: found.row.projectId,
    recordId: found.row.id,
    canSubmit: found.row.closeoutStatus === "sent",
  };
}

// ─── the scorecard ──────────────────────────────────────────────────────────

type Agg = { sub: string; status: string; sentAt: Date | null; readyAt: Date | null; closedAt: Date | null };

export async function analytics(scope: Scope) {
  const flags = await db.select().from(qaFlags).where(eq(qaFlags.projectId, scope.projectId));
  const items = await db.select().from(inspectionItems).where(eq(inspectionItems.projectId, scope.projectId));
  const now = new Date();

  const rows: Agg[] = [
    ...flags.map((f) => ({ sub: f.subName || f.subEmail || "Unassigned", status: f.closeoutStatus, sentAt: f.sentAt, readyAt: f.readyAt, closedAt: f.closedAt })),
    ...items.map((i) => ({ sub: i.sentTo || "Unassigned", status: i.closeoutStatus, sentAt: i.sentAt, readyAt: i.readyAt, closedAt: i.closedAt })),
  ];

  type Row = { sub: string; open: number; overdue: number; turnarounds: number[]; total: number };
  const bySub = new Map<string, Row>();
  const tiles = { open: 0, sent: 0, ready: 0, withConsultant: 0, closed: 0 };
  const closeoutWds: number[] = [];

  for (const r of rows) {
    const row = bySub.get(r.sub) ?? { sub: r.sub, open: 0, overdue: 0, turnarounds: [], total: 0 };
    row.total++;
    if (r.status === "open" || r.status === "sent") { tiles.open++; row.open++; }
    if (r.status === "sent") {
      tiles.sent++;
      if (r.sentAt && workingDaysBetween(r.sentAt, now) > QA_CLOSEOUT_SLA_WORKING_DAYS) row.overdue++;
    }
    if (r.status === "ready") tiles.ready++;
    if (r.status === "submitted") tiles.withConsultant++;
    if (r.status === "closed") tiles.closed++;
    if (r.sentAt && r.readyAt) row.turnarounds.push(workingDaysBetween(r.sentAt, r.readyAt));
    if (r.sentAt && r.closedAt) closeoutWds.push(workingDaysBetween(r.sentAt, r.closedAt));
    bySub.set(r.sub, row);
  }

  const avg = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : 0);
  const scorecard = [...bySub.values()]
    .map((r) => ({
      sub: r.sub,
      open: r.open,
      overdue: r.overdue,
      avgFixWd: avg(r.turnarounds),
      fixed: r.turnarounds.length,
      total: r.total,
    }))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);

  return {
    slaWd: QA_CLOSEOUT_SLA_WORKING_DAYS,
    tiles: {
      open: tiles.open,
      readyForReview: tiles.ready,
      withConsultant: tiles.withConsultant,
      closed: tiles.closed,
      avgCloseoutWd: avg(closeoutWds),
    },
    scorecard,
  };
}
