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
import { defectBlobPrefix, defectMessagesFor, logDefect } from "./defectThread";
import { attachmentsLine, packForEmail, type Attachment } from "./attachments";
import { normalizeEmail } from "./externalAuth";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { checklistItems, checklists, inspectionItems, inspections, projects, qaFlags } from "./schema";
import type { Scope } from "./company";
import { companyName } from "./company";
import { projectSenderAddress, sendEmail } from "./email";
import { renderQaCloseoutNotice, renderQaSignoffEmail, renderThreadNotice } from "./emailTemplates";
import { workingDaysBetween } from "./rfi";
import { companyRequiresLogin } from "./externalAuth";
import { replyAddress } from "./inboundAddress";
import { APP_URL, PORTAL_URL } from "./appUrl";

/** Working days a sub / consultant has before a defect counts as overdue on the
 *  scorecard. A defect fix is quicker than an RFI answer, hence shorter than the
 *  RFI SLA of 7. Not enforced, only reported. */
export const QA_CLOSEOUT_SLA_WORKING_DAYS = 5;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

// "check" = a Needs-fixing item on one of the site's own QA checks
// (checklist_items), in the loop since 2026-09-09 so every item can be sent
// and closed on its own, exactly like a flag.
export type CloseoutKind = "flag" | "item" | "check";
type FlagRow = typeof qaFlags.$inferSelect;
type ItemRow = typeof inspectionItems.$inferSelect;
type CheckRow = typeof checklistItems.$inferSelect;

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

/** A sub_token belongs to exactly one defect on one of the three tables. Flags
 *  are checked first; the tables share the token namespace but a collision
 *  across them is astronomically unlikely (24 random bytes each). */
async function bySubToken(token: string): Promise<FoundDefect | null> {
  const clean = token.trim();
  if (!TOKEN_RE.test(clean)) return null;
  const [flag] = await db.select().from(qaFlags).where(eq(qaFlags.subToken, clean)).limit(1);
  if (flag) return { kind: "flag", row: flag };
  const [item] = await db.select().from(inspectionItems).where(eq(inspectionItems.subToken, clean)).limit(1);
  if (item) return { kind: "item", row: item };
  const [check] = await db.select().from(checklistItems).where(eq(checklistItems.subToken, clean)).limit(1);
  if (check) return { kind: "check", row: check };
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

/** Mint + persist sub_tokens for a batch of QA CHECK items (checklist_items);
 *  return id -> url + token. Same shape as armItemsFix. */
export async function armChecksFix(scope: Scope, itemIds: string[]): Promise<Map<string, { url: string; token: string }>> {
  const out = new Map<string, { url: string; token: string }>();
  if (!itemIds.length) return out;
  const rows = await db
    .select({ id: checklistItems.id, subToken: checklistItems.subToken })
    .from(checklistItems)
    .where(and(eq(checklistItems.companyId, scope.companyId), eq(checklistItems.projectId, scope.projectId), inArray(checklistItems.id, itemIds)));
  for (const r of rows) {
    const token = r.subToken ?? mintToken();
    if (!r.subToken) await db.update(checklistItems).set({ subToken: token }).where(eq(checklistItems.id, r.id));
    out.set(r.id, { url: fixUrl(token), token });
  }
  return out;
}

/** Mint + persist sub_tokens for a batch of inspection items; return id -> url
 *  (+ the token, for the reply address). Items already carrying a token keep
 *  it (a resend reuses the same link). */
export async function armItemsFix(scope: Scope, itemIds: string[]): Promise<Map<string, { url: string; token: string }>> {
  const out = new Map<string, { url: string; token: string }>();
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
    out.set(r.id, { url: fixUrl(token), token });
  }
  return out;
}

// ─── lookups shared by the token pages, the portal and inbound email ────────

export type FoundDefect = { kind: "flag"; row: FlagRow } | { kind: "item"; row: ItemRow } | { kind: "check"; row: CheckRow };

/** The title any of the three rows shows. */
export function defectTitle(found: FoundDefect): string {
  return found.row.title;
}

/** A reply-address token → the defect it belongs to. "fix" = the sub's
 *  token (either table); "so" = the consultant's token (items only). */
export async function defectByReplyToken(kind: "fix" | "so", token: string): Promise<(FoundDefect & { side: "sub" | "consultant" }) | null> {
  if (kind === "fix") {
    const f = await bySubToken(token);
    return f ? { ...f, side: "sub" } : null;
  }
  const item = await byConsultantToken(token);
  return item ? { kind: "item", row: item, side: "consultant" } : null;
}

/** The addresses a defect's fix link went to (lowercased) - what the sign-in
 *  gate and the portal match a sub against. */
export function subEmailsOf(found: FoundDefect): string[] {
  if (found.kind === "flag") return found.row.subEmail ? [normalizeEmail(found.row.subEmail)] : [];
  try {
    const arr = found.row.subEmails ? (JSON.parse(found.row.subEmails) as string[]) : [];
    return arr.map((e) => normalizeEmail(String(e)));
  } catch {
    return [];
  }
}

/** The check a QA check item belongs to (title + location), for the sub's page. */
async function checkContext(row: CheckRow): Promise<{ title: string; location: string | null }> {
  const [c] = await db.select({ title: checklists.title, location: checklists.location }).from(checklists).where(eq(checklists.id, row.checklistId)).limit(1);
  return { title: c?.title ?? "QA check", location: c?.location ?? null };
}

/** The portal: every defect sent to any of these emails, on either side. */
export async function defectsForEmails(emails: string[]): Promise<{ fixes: FoundDefect[]; signoffs: ItemRow[] }> {
  if (!emails.length) return { fixes: [], signoffs: [] };
  const lower = emails.map((e) => e.toLowerCase());
  // A defect sent to "local+tag@domain" belongs to the account on
  // "local@domain" (normalizeEmail, same rule as rfisForEmails): the SQL
  // pre-filter must let the tagged rows through, the exact match below
  // (subEmailsOf) then decides.
  const variants = lower.map((e) => {
    const clean = e.replace(/[%_]/g, "");
    const at = clean.lastIndexOf("@");
    return { e, clean, tagged: at > 0 ? `${clean.slice(0, at)}+%${clean.slice(at)}` : null };
  });
  const oneOf = (col: typeof qaFlags.subEmail | typeof inspectionItems.consultantEmail) =>
    sql.join(variants.flatMap((v) => [sql`lower(${col}) = ${v.e}`, ...(v.tagged ? [sql`lower(${col}) LIKE ${v.tagged}`] : [])]), sql` OR `);
  const inJson = (col: typeof inspectionItems.subEmails | typeof checklistItems.subEmails) =>
    sql.join(variants.flatMap((v) => [sql`${col} ILIKE ${"%" + v.clean + "%"}`, ...(v.tagged ? [sql`${col} ILIKE ${"%" + v.tagged + "%"}`] : [])]), sql` OR `);
  const flags = await db
    .select()
    .from(qaFlags)
    .where(and(isNotNull(qaFlags.subToken), sql`(${oneOf(qaFlags.subEmail)})`));
  const items = await db
    .select()
    .from(inspectionItems)
    .where(and(isNotNull(inspectionItems.subToken), sql`(${inJson(inspectionItems.subEmails)})`));
  const checks = await db
    .select()
    .from(checklistItems)
    .where(and(isNotNull(checklistItems.subToken), sql`(${inJson(checklistItems.subEmails)})`));
  const signoffs = await db
    .select()
    .from(inspectionItems)
    .where(and(isNotNull(inspectionItems.consultantToken), sql`(${oneOf(inspectionItems.consultantEmail)})`));
  const fixes: FoundDefect[] = [
    ...flags.map((row) => ({ kind: "flag" as const, row })),
    ...items.filter((i) => subEmailsOf({ kind: "item", row: i }).some((e) => lower.includes(e))).map((row) => ({ kind: "item" as const, row })),
    ...checks.filter((i) => subEmailsOf({ kind: "check", row: i }).some((e) => lower.includes(e))).map((row) => ({ kind: "check" as const, row })),
  ];
  return { fixes, signoffs };
}

/** One defect for the portal, only if it was sent to one of these emails. */
export async function defectForEmail(kind: CloseoutKind, id: string, emails: string[], side: "sub" | "consultant"): Promise<FoundDefect | null> {
  const lower = new Set(emails.map((e) => e.toLowerCase()));
  if (kind === "flag") {
    if (side !== "sub") return null;
    const [row] = await db.select().from(qaFlags).where(eq(qaFlags.id, id)).limit(1);
    if (!row || !row.subToken) return null;
    return subEmailsOf({ kind: "flag", row }).some((e) => lower.has(e)) ? { kind: "flag", row } : null;
  }
  if (kind === "check") {
    if (side !== "sub") return null;
    const [row] = await db.select().from(checklistItems).where(eq(checklistItems.id, id)).limit(1);
    if (!row || !row.subToken) return null;
    return subEmailsOf({ kind: "check", row }).some((e) => lower.has(e)) ? { kind: "check", row } : null;
  }
  const [row] = await db.select().from(inspectionItems).where(eq(inspectionItems.id, id)).limit(1);
  if (!row) return null;
  if (side === "sub") return row.subToken && subEmailsOf({ kind: "item", row }).some((e) => lower.has(e)) ? { kind: "item", row } : null;
  return row.consultantToken && row.consultantEmail && lower.has(row.consultantEmail.toLowerCase()) ? { kind: "item", row } : null;
}

// ─── the sub's /fix page (token-authorised, no login) ───────────────────────

/** Everything the /fix page shows. Null = bad token. Tokens are never returned. */
export async function getFixByToken(token: string) {
  const found = await bySubToken(token);
  if (!found) return null;
  return fixView(found);
}

/** The sub's view of a defect - shared by the token page and the portal. */
export async function fixView(found: FoundDefect) {
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
      : found.kind === "item"
        ? {
            title: (row as ItemRow).title,
            detail: (row as ItemRow).detail,
            location: (row as ItemRow).location,
            category: (row as ItemRow).category,
          }
        : await (async () => {
            const c = await checkContext(row as CheckRow);
            const r = row as CheckRow;
            return {
              title: r.title,
              // The site team's note on the walk is what the sub answers to;
              // the generated "what good looks like" is the backstop.
              detail: [r.note, r.detail].filter(Boolean).join("\n\n") || null,
              location: [c.location, c.title].filter(Boolean).join(" · ") || null,
              category: r.category,
            };
          })();
  return {
    company,
    project,
    kind: found.kind,
    id: row.id,
    defect,
    status: row.closeoutStatus,
    hasFixPhoto: !!row.fixPhoto,
    reviewNote: row.closeoutStatus === "sent" ? row.reviewNote : null, // the bounce-back note, when there is one
    // The button is live only while the ball is with the sub.
    canSubmit: row.closeoutStatus === "sent",
    // The conversation so far, and whether a note can still be added (anything short of closed).
    messages: await defectMessagesFor(found.kind, row.id),
    canNote: row.closeoutStatus !== "closed",
    // Where the sub's own files on the thread go (direct-to-Blob, signed by the door).
    uploadPrefix: row.closeoutStatus !== "closed" ? defectBlobPrefix(row.projectId, row.id) : null,
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
  return markReadyRow(found, input);
}

export async function markReadyRow(
  found: FoundDefect,
  input: { photoBlobPath?: string | null; note?: string | null; via?: "link" | "portal" }
): Promise<{ ok: true } | { ok: false; error: string }> {
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
      : found.kind === "item"
        ? (await db.update(inspectionItems).set(set).where(and(eq(inspectionItems.id, row.id), eq(inspectionItems.closeoutStatus, "sent"))).returning())[0]
        : (await db.update(checklistItems).set(set).where(and(eq(checklistItems.id, row.id), eq(checklistItems.closeoutStatus, "sent"))).returning())[0];
  if (!claimed) {
    // Lost the claim: already ready / closed, or never sent.
    return { ok: false, error: row.closeoutStatus === "sent" ? "race" : "not-open" };
  }
  await logDefect(row, found.kind, { type: "ready", authorSide: "sub", authorName: subLine(found.kind, row), via: input.via ?? "link", body: note ?? "Marked fixed" });

  try {
    await notifyMc(found.kind, claimed as FlagRow | ItemRow | CheckRow, {
      kind: "ready",
      actorLine: subLine(found.kind, claimed as FlagRow | ItemRow | CheckRow),
      note,
      nextLine: found.kind === "item" ? "marked this fixed. Review it and close it out, or forward it to the consultant to sign off." : "marked this fixed. Review it and close it out.",
    });
  } catch (e) {
    console.error("qa markReady notice failed:", e);
  }
  return { ok: true };
}

// ─── per-item close and reopen (the site team, any kind, any stage) ─────────
//
// "Sometimes you might close a few or even one and work in the area can
// proceed" (Adam, 2026-09-09). A defect can be closed on its own at ANY stage
// short of closed - never sent, sent to a sub, marked ready - because the site
// team saw it fixed on the wall. reviewClose above stays the strict path
// (ready only); this is the direct one, with who closed it and a note on
// record. A consultant-report item closed directly is closed by the site team,
// not signed off by the consultant; the row says so (closed_by_name).

async function rowOf(scope: Scope, kind: CloseoutKind, id: string): Promise<FoundDefect | null> {
  if (kind === "flag") {
    const row = await ourFlag(scope, id);
    return row ? { kind: "flag", row } : null;
  }
  if (kind === "item") {
    const row = await ourItem(scope, id);
    return row ? { kind: "item", row } : null;
  }
  const [row] = await db.select().from(checklistItems).where(and(eq(checklistItems.id, id), eq(checklistItems.projectId, scope.projectId))).limit(1);
  return row ? { kind: "check", row } : null;
}

export async function closeDirect(
  scope: Scope,
  kind: CloseoutKind,
  id: string,
  input: { note?: string | null; byName?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const found = await rowOf(scope, kind, id);
  if (!found) return { ok: false, error: "not-found" };
  if (found.row.closeoutStatus === "closed") return { ok: false, error: "already-closed" };
  const now = new Date();
  const note = input.note?.trim().slice(0, 4000) || null;
  const byName = input.byName?.trim().slice(0, 120) || null;
  if (kind === "flag") {
    await db.update(qaFlags).set({ closeoutStatus: "closed", closedAt: now, closedByName: byName, reviewNote: note, status: "done", fixedAt: now }).where(eq(qaFlags.id, id));
  } else if (kind === "item") {
    await db.update(inspectionItems).set({ closeoutStatus: "closed", closedAt: now, closedByName: byName, reviewNote: note, workStatus: "done" }).where(eq(inspectionItems.id, id));
  } else {
    await db.update(checklistItems).set({ closeoutStatus: "closed", closedAt: now, closedByName: byName, reviewNote: note }).where(eq(checklistItems.id, id));
    await db.update(checklists).set({ updatedAt: now }).where(eq(checklists.id, (found.row as CheckRow).checklistId));
  }
  await logDefect(found.row, kind, { type: "closed", authorSide: "contractor", authorName: byName, body: note ?? "Closed out" });
  return { ok: true };
}

/** Undo a close: back to "sent" if it had gone to a sub (their link comes
 *  alive again), else "open". */
export async function reopenDefect(scope: Scope, kind: CloseoutKind, id: string, byName?: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const found = await rowOf(scope, kind, id);
  if (!found) return { ok: false, error: "not-found" };
  if (found.row.closeoutStatus !== "closed") return { ok: false, error: "not-closed" };
  const wasSent = !!(found.row as { sentAt?: Date | null }).sentAt || !!(found.row as { subToken?: string | null }).subToken;
  const back = wasSent ? "sent" : "open";
  if (kind === "flag") {
    await db.update(qaFlags).set({ closeoutStatus: back, closedAt: null, closedByName: null, status: wasSent ? "sent" : "open", fixedAt: null }).where(eq(qaFlags.id, id));
  } else if (kind === "item") {
    await db.update(inspectionItems).set({ closeoutStatus: back, closedAt: null, closedByName: null, workStatus: "not_done" }).where(eq(inspectionItems.id, id));
  } else {
    await db.update(checklistItems).set({ closeoutStatus: back, closedAt: null, closedByName: null }).where(eq(checklistItems.id, id));
  }
  await logDefect(found.row, kind, { type: "reopened", authorSide: "contractor", authorName: byName ?? null, body: back === "sent" ? "Reopened - back with the sub" : "Reopened" });
  return { ok: true };
}

/** Bounce a ready QA CHECK item back to the sub (flags/items use reject()). */
export async function rejectCheck(scope: Scope, id: string, note: string | null, byName?: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db
    .update(checklistItems)
    .set({ closeoutStatus: "sent", reviewNote: note?.trim().slice(0, 4000) || null })
    .where(and(eq(checklistItems.id, id), eq(checklistItems.projectId, scope.projectId), eq(checklistItems.closeoutStatus, "ready")))
    .returning();
  if (!row) return { ok: false, error: "not-ready" };
  await logDefect(row, "check", { type: "bounced", authorSide: "contractor", authorName: byName ?? null, body: note?.trim() || "Bounced back" });
  await notifySubBounced({ kind: "check", row }, byName ?? null, note?.trim() || null);
  return { ok: true };
}

// ─── the consultant's /signoff page (token-authorised, no login) ────────────

/** Everything the /signoff page shows, including the sub's fix note. The photo
 *  itself streams through the token-authorised photo route. Null = bad token. */
export async function getSignoffByToken(token: string) {
  const item = await byConsultantToken(token);
  if (!item) return null;
  return signoffView(item);
}

/** The consultant's view of a fixed defect - shared by the token page and the portal. */
export async function signoffView(item: ItemRow) {
  const scope = tokenScope(item);
  const { project, company } = await projectAndCompany(scope);
  return {
    company,
    project,
    id: item.id,
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
    // The whole back-and-forth (sent, the sub's questions, bounces, the
    // photo), so the consultant signs off on the history, not just the last note.
    messages: await defectMessagesFor("item", item.id),
    // A note (a question back to the builder) can be added short of closed;
    // files on it and on the decision go under the defect's own folder.
    canNote: item.closeoutStatus !== "closed",
    uploadPrefix: item.closeoutStatus !== "closed" ? defectBlobPrefix(item.projectId, item.id) : null,
  };
}

/** The consultant's decision. ATOMIC claim on closeout_status='submitted'.
 *  approve -> closed (closed_at set); bounce -> back to sent so the sub's
 *  ORIGINAL /fix link comes alive again (the sub_token is left in place - the
 *  status flip is what re-arms it). Then the MC is notified. */
export async function signoffByToken(
  token: string,
  input: { approve: boolean; note?: string | null; files?: Attachment[] }
): Promise<{ ok: true; approved: boolean } | { ok: false; error: string }> {
  const item = await byConsultantToken(token);
  if (!item) return { ok: false, error: "not-found" };
  return signoffRow(item, input);
}

export async function signoffRow(
  item: ItemRow,
  input: { approve: boolean; note?: string | null; via?: "link" | "portal"; files?: Attachment[] }
): Promise<{ ok: true; approved: boolean } | { ok: false; error: string }> {
  const now = new Date();
  const note = input.note?.trim().slice(0, 4000) || null;
  const files = input.files ?? [];

  const set = input.approve
    ? { closeoutStatus: "closed", closedAt: now, reviewNote: note, workStatus: "done" }
    : { closeoutStatus: "sent", reviewNote: note };
  const [claimed] = await db
    .update(inspectionItems)
    .set(set)
    .where(and(eq(inspectionItems.id, item.id), eq(inspectionItems.closeoutStatus, "submitted")))
    .returning();
  if (!claimed) return { ok: false, error: "not-open" };
  await logDefect(claimed, "item", {
    type: input.approve ? "signed_off" : "bounced",
    authorSide: "consultant",
    authorName: item.consultantName || item.consultantEmail || "The consultant",
    via: input.via ?? "link",
    body: note ?? (input.approve ? "Signed off" : "Bounced back"),
    attachments: files,
  });
  // The sub gets the consultant's files with the bounce (a marked-up photo of
  // what to redo); the builder gets them either way.
  if (!input.approve) await notifySubBounced({ kind: "item", row: claimed }, item.consultantName || item.consultantEmail || "The consultant", note, files);

  try {
    await notifyMc("item", claimed, {
      kind: input.approve ? "signed_off" : "bounced",
      actorLine: item.consultantName || item.consultantEmail || "The consultant",
      note,
      nextLine: input.approve
        ? "signed this off. It is closed - nothing further needed."
        : "bounced this back. It is back with the sub to redo, and the sub's fix link is live again.",
    }, files);
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
  input?: { note?: string | null; byName?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date();
  const note = input?.note?.trim().slice(0, 4000) || null;
  if (kind === "flag") {
    const [row] = await db
      .update(qaFlags)
      .set({ closeoutStatus: "closed", closedAt: now, reviewNote: note, status: "done", fixedAt: now })
      .where(and(eq(qaFlags.id, id), eq(qaFlags.projectId, scope.projectId), eq(qaFlags.closeoutStatus, "ready")))
      .returning();
    if (row) await logDefect(row, "flag", { type: "closed", authorSide: "contractor", authorName: input?.byName ?? null, body: note ?? "Closed out" });
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
  if (row) await logDefect(row, "item", { type: "closed", authorSide: "contractor", authorName: input?.byName ?? null, body: note ?? "Closed out" });
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
  await logDefect(claimed, "item", { type: "forwarded", authorSide: "contractor", authorName: input.byName ?? null, body: `Sent to ${name ? `${name} (${email})` : email} to sign off` });

  const { project, company } = await projectAndCompany(scope);
  const loginRequired = await companyRequiresLogin(scope.companyId);
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
    portalUrl: PORTAL_URL,
    loginRequired,
  });
  const result = await sendEmail({
    scope,
    kind: "inspection_items",
    recordType: "inspection_item",
    recordIds: [itemId],
    to: { name, email },
    fromName: `${company} (via Soterra)`,
    fromEmail: projectSenderAddress(project, scope.projectId),
    replyTo: (await replyAddress("so", token)) ?? claimed.senderEmail ?? null,
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
  input: { note?: string | null; byName?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const note = input.note?.trim().slice(0, 4000) || null;
  if (kind === "flag") {
    const [row] = await db
      .update(qaFlags)
      .set({ closeoutStatus: "sent", reviewNote: note })
      .where(and(eq(qaFlags.id, id), eq(qaFlags.projectId, scope.projectId), eq(qaFlags.closeoutStatus, "ready")))
      .returning();
    if (!row) return { ok: false, error: "not-ready" };
    await logDefect(row, "flag", { type: "bounced", authorSide: "contractor", authorName: input.byName ?? null, body: note ?? "Bounced back" });
    await notifySubBounced({ kind: "flag", row }, input.byName ?? null, note);
    return { ok: true };
  }
  const [row] = await db
    .update(inspectionItems)
    .set({ closeoutStatus: "sent", reviewNote: note })
    .where(and(eq(inspectionItems.id, id), eq(inspectionItems.projectId, scope.projectId), eq(inspectionItems.closeoutStatus, "ready")))
    .returning();
  if (!row) return { ok: false, error: "not-ready" };
  await logDefect(row, "item", { type: "bounced", authorSide: "contractor", authorName: input.byName ?? null, body: note ?? "Bounced back" });
  await notifySubBounced({ kind: "item", row }, input.byName ?? null, note);
  return { ok: true };
}

/** A bounce-back is a message to the sub: they hear about it by email, with
 *  their link back in, instead of finding out next time they open it. */
async function notifySubBounced(found: FoundDefect, byName: string | null, note: string | null, files: Attachment[] = []): Promise<void> {
  try {
    await passNoteToExternal({ ...found, side: "sub" }, { name: byName ?? "The site team", email: (found.row as { senderEmail?: string | null }).senderEmail ?? "" }, note ? `Bounced back: ${note}` : "Bounced back - please redo and mark it fixed again.", attachmentsLine(files), "bounced", files);
  } catch (e) {
    console.error("bounce notice to sub failed:", e);
  }
}

// ─── the MC notice ──────────────────────────────────────────────────────────

function subLine(kind: CloseoutKind, row: FlagRow | ItemRow | CheckRow): string {
  if (kind === "flag") return (row as FlagRow).subName || (row as FlagRow).subEmail || "The subcontractor";
  return (row as ItemRow | CheckRow).sentTo || "The subcontractor";
}

/** Tell whoever pressed Send that the ball moved. sender_email is stamped on the
 *  defect at send time; with no address there is nobody to notify (best-effort). */
async function notifyMc(
  kind: CloseoutKind,
  row: FlagRow | ItemRow | CheckRow,
  n: { kind: "ready" | "signed_off" | "bounced"; actorLine: string; note: string | null; nextLine: string },
  files: Attachment[] = []
): Promise<void> {
  const to = (row as { senderEmail?: string | null }).senderEmail?.trim();
  if (!to) return;
  const scope = tokenScope(row);
  const { project, company } = await projectAndCompany(scope);
  const title = row.title;
  // The other side's files ride along while the budget lasts; the rest are
  // named so the reader knows to open the item in Soterra.
  const packed = files.length ? await packForEmail(files) : { attachments: [], listed: [] };
  const line = files.length ? filesLine(packed, "the item in Soterra") : null;
  const rendered = renderQaCloseoutNotice({
    companyName: company,
    projectName: project,
    title,
    kind: n.kind,
    actorLine: n.actorLine,
    note: [n.note, line].filter(Boolean).join("\n\n") || null,
    nextLine: n.nextLine,
    appUrl: APP_URL,
    refLabel: `QA close-out · ${title}`.slice(0, 80),
  });
  await sendEmail({
    scope,
    kind: kind === "flag" ? "qa_flags" : "inspection_items",
    recordType: kind === "flag" ? "qa_flag" : kind === "item" ? "inspection_item" : "checklist_item",
    recordIds: [row.id],
    to: { email: to },
    fromName: "Soterra",
    fromEmail: projectSenderAddress(project, scope.projectId),
    subject: `${title} · ${n.kind === "ready" ? "marked fixed" : n.kind === "signed_off" ? "signed off" : "bounced back"} · ${project}`,
    html: rendered.html,
    text: rendered.text,
    attachments: packed.attachments,
    sentByName: n.actorLine,
  });
}

// ─── an email reply on a defect (lib/inbound.ts) ───────────────────────────
//
// Defects have no thread table: the sub's note and photo live on the row, the
// consultant's note too. So an email reply is logged in inbound_emails by the
// caller and passed on here by email to the OTHER side, so the conversation
// keeps moving without anyone watching two inboxes.

export async function emailReplyOnDefect(
  found: FoundDefect & { side: "sub" | "consultant" },
  from: { email: string; name: string },
  text: string,
  attachments: { filename: string; path: string; bytes: number; contentType: string }[]
): Promise<{ handled: "defect_note" | "defect_forwarded" | "rejected" }> {
  const row = found.row;
  const fromLower = from.email.toLowerCase();
  const senderLower = (row as { senderEmail?: string | null }).senderEmail?.toLowerCase() ?? null;
  const attLine = attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}: ${attachments.map((a) => a.filename).join(" · ")}` : null;
  const body = text.trim() || (attLine ? `(${attLine})` : "(empty reply)");

  // The other side wrote: it goes on the thread, and whoever pressed Send is told.
  if (!senderLower || fromLower !== senderLower) {
    if (!senderLower) return { handled: "rejected" };
    await logDefect(row, found.kind, { type: "note", authorSide: found.side, authorName: from.name || from.email, authorEmail: from.email, via: "email", body, attachments });
    await notifyMcOfNote(found, from, body, attLine, "email", attachments);
    return { handled: "defect_note" };
  }

  // Our sender replying from their inbox: on the thread, and passed on to the
  // external party with their link back in (and the files, while they fit).
  await logDefect(row, found.kind, { type: "note", authorSide: "contractor", authorName: from.name || from.email, authorEmail: from.email, via: "email", body, attachments });
  const passed = await passNoteToExternal(found, from, body, attLine, "note", attachments);
  return { handled: passed ? "defect_forwarded" : "rejected" };
}

/** "2 attachments: photo.jpg · sketch.pdf" for a notice, with the ones too big
 *  to ride in the email marked as on the page. */
function filesLine(packed: { listed: { filename: string; attached: boolean }[] }, where: string): string | null {
  return attachmentsLine(packed.listed.map((l) => ({ filename: l.attached ? l.filename : `${l.filename} (open it from ${where})` })));
}

/** A note from the sub or the consultant, written in the app (link or portal):
 *  on the thread, and emailed to whoever pressed Send. Files alone are a note
 *  too - a photo of the wall says enough. */
export async function noteFromExternal(
  found: FoundDefect & { side: "sub" | "consultant" },
  from: { name: string; email: string | null },
  text: string,
  via: "link" | "portal",
  files: Attachment[] = []
): Promise<{ ok: true } | { ok: false; error: string }> {
  const attLine = attachmentsLine(files);
  const body = text.trim() || (attLine ? `(${attLine})` : "");
  if (!body) return { ok: false, error: "empty" };
  if (found.row.closeoutStatus === "closed") return { ok: false, error: "closed" };
  await logDefect(found.row, found.kind, { type: "note", authorSide: found.side, authorName: from.name, authorEmail: from.email, via, body, attachments: files });
  try {
    await notifyMcOfNote(found, { name: from.name, email: from.email ?? "" }, body, attLine, via, files);
  } catch (e) {
    console.error("defect note notice failed:", e);
  }
  return { ok: true };
}
export async function noteByToken(token: string, text: string, name?: string | null, files: Attachment[] = []): Promise<{ ok: true } | { ok: false; error: string }> {
  const found = await bySubToken(token);
  if (!found) return { ok: false, error: "not-found" };
  const emails = subEmailsOf(found);
  return noteFromExternal({ ...found, side: "sub" }, { name: name?.trim() || subLine(found.kind, found.row), email: emails[0] ?? null }, text, "link", files);
}

/** The site team writes to the sub (or the consultant) from the item: on the
 *  thread, and emailed to them with their link back in - and the files, while
 *  they fit in the email; the rest open from their page. */
export async function noteFromBuilder(
  scope: Scope,
  kind: CloseoutKind,
  id: string,
  text: string,
  by: { name?: string | null; email?: string | null },
  files: Attachment[] = []
): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string }> {
  const found = await rowOf(scope, kind, id);
  if (!found) return { ok: false, error: "not-found" };
  const attLine = attachmentsLine(files);
  const body = text.trim() || (attLine ? `(${attLine})` : "");
  if (!body) return { ok: false, error: "empty" };
  await logDefect(found.row, kind, { type: "note", authorSide: "contractor", authorName: by.name ?? null, authorEmail: by.email ?? null, via: "app", body, attachments: files });
  // Whoever holds the ball hears about it: the consultant while it is with them, else the sub.
  const side: "sub" | "consultant" = found.kind === "item" && found.row.closeoutStatus === "submitted" ? "consultant" : "sub";
  let emailed = false;
  try {
    emailed = await passNoteToExternal({ ...found, side }, { name: by.name ?? "The site team", email: by.email ?? (found.row as { senderEmail?: string | null }).senderEmail ?? "" }, body, attLine, "note", files);
  } catch (e) {
    console.error("builder note to external failed:", e);
  }
  return { ok: true, emailed };
}

/** The defect behind an emailed link - the sub's OR the consultant's - for the
 *  thread-file upload door: the ids build the blob path, the emails feed the
 *  sign-in gate; a closed item takes no more files. */
export async function threadUploadTarget(token: string): Promise<{ side: "sub" | "consultant"; projectId: string; recordId: string; companyId: string; emails: string[]; canNote: boolean } | null> {
  const found = await bySubToken(token);
  if (found) return { side: "sub", projectId: found.row.projectId, recordId: found.row.id, companyId: found.row.companyId, emails: subEmailsOf(found), canNote: found.row.closeoutStatus !== "closed" };
  const item = await byConsultantToken(token);
  if (!item) return null;
  return { side: "consultant", projectId: item.projectId, recordId: item.id, companyId: item.companyId, emails: item.consultantEmail ? [normalizeEmail(item.consultantEmail)] : [], canNote: item.closeoutStatus !== "closed" };
}

/** The consultant writes back from the sign-off page without deciding (a
 *  question, "send me the north face"): on the thread, emailed to whoever
 *  pressed Send, with their files. */
export async function noteByConsultantToken(token: string, text: string, files: Attachment[] = []): Promise<{ ok: true } | { ok: false; error: string }> {
  const item = await byConsultantToken(token);
  if (!item) return { ok: false, error: "not-found" };
  return noteFromExternal({ kind: "item", row: item, side: "consultant" }, { name: item.consultantName || item.consultantEmail || "The consultant", email: item.consultantEmail ?? null }, text, "link", files);
}

/** Either side's token → the defect, for the thread-file streaming route (both
 *  the sub and the consultant are entitled to the files on the thread). */
export async function defectByAnyToken(token: string): Promise<FoundDefect | null> {
  const found = await bySubToken(token);
  if (found) return found;
  const item = await byConsultantToken(token);
  return item ? { kind: "item", row: item } : null;
}

/** One of OUR defects, scoped (the builder's door on the thread-file route). */
export async function defectForScope(scope: Scope, kind: CloseoutKind, id: string): Promise<FoundDefect | null> {
  return rowOf(scope, kind, id);
}

/** The thread on one of our defects (the builder's side). */
export async function threadFor(scope: Scope, kind: CloseoutKind, id: string) {
  const found = await rowOf(scope, kind, id);
  if (!found) return null;
  return defectMessagesFor(kind, id);
}

/** Tell whoever pressed Send that the other side wrote (link, portal or email).
 *  Their files ride in the email while the budget lasts; the rest open from the
 *  item in Soterra. */
async function notifyMcOfNote(found: FoundDefect & { side: "sub" | "consultant" }, from: { email: string; name: string }, body: string, attLine: string | null, via: string, files: Attachment[] = []): Promise<void> {
  const row = found.row;
  const scope = tokenScope(row);
  const { project, company } = await projectAndCompany(scope);
  const title = row.title;
  const senderLower = (row as { senderEmail?: string | null }).senderEmail?.toLowerCase() ?? null;
  if (!senderLower) return;
  {
    const packed = files.length ? await packForEmail(files) : { attachments: [], listed: [] };
    const rendered = renderThreadNotice({
      companyName: company,
      projectName: project,
      heading: `${found.side === "sub" ? "Sub" : "Consultant"} ${via === "email" ? "reply by email" : "wrote back"}`,
      subject: title,
      actorLine: from.name || from.email,
      lead: `wrote on this defect${via === "email" ? " by email" : ""}${found.side === "sub" ? "" : " (sign-off)"}. It is on the item's thread in Soterra; the link in the original email is still the way to mark it fixed or sign it off.`,
      body,
      attachmentsLine: files.length ? filesLine(packed, "the item in Soterra") : attLine,
      linkLabel: "Open Soterra",
      linkUrl: APP_URL,
      refLabel: `QA close-out · ${title}`.slice(0, 80),
      tone: "amber",
    });
    await sendEmail({
      scope,
      kind: "inbound",
      recordType: found.kind === "flag" ? "qa_flag" : found.kind === "item" ? "inspection_item" : "checklist_item",
      recordIds: [row.id],
      to: { email: senderLower },
      replyTo: from.email || null,
      fromName: "Soterra",
      fromEmail: projectSenderAddress(project, scope.projectId),
      subject: `${title} · ${via === "email" ? "reply by email" : "note"} · ${project}`,
      html: rendered.html,
      text: rendered.text,
      attachments: packed.attachments,
      sentByName: from.name || from.email,
    });
  }
}

/** Pass a builder-side message (a note, a bounce-back) to the external party
 *  holding the ball, with their link back in - and the files, while they fit.
 *  False when there is nobody to send to. */
async function passNoteToExternal(
  found: FoundDefect & { side: "sub" | "consultant" },
  from: { email: string; name: string },
  body: string,
  attLine: string | null,
  kindOfNote: "note" | "bounced",
  files: Attachment[] = []
): Promise<boolean> {
  const row = found.row;
  const scope = tokenScope(row);
  const { project, company } = await projectAndCompany(scope);
  const title = row.title;
  const loginRequired = await companyRequiresLogin(scope.companyId);
  const packed = files.length ? await packForEmail(files) : { attachments: [], listed: [] };
  const line = files.length ? filesLine(packed, "the link below") : attLine;
  let to: { name: string | null; email: string } | null = null;
  let link = APP_URL;
  let replyTo: string | null = null;
  if (found.side === "sub") {
    const emails = subEmailsOf(found);
    const token = (row as { subToken?: string | null }).subToken;
    if (emails.length && token) {
      to = { name: found.kind === "flag" ? (row as FlagRow).subName : (row as ItemRow | CheckRow).sentTo, email: emails[0] };
      link = fixUrl(token);
      replyTo = await replyAddress("fix", token);
    }
  } else {
    const item = row as ItemRow;
    if (item.consultantEmail && item.consultantToken) {
      to = { name: item.consultantName, email: item.consultantEmail };
      link = `${APP_URL}/signoff/${item.consultantToken}`;
      replyTo = await replyAddress("so", item.consultantToken);
    }
  }
  if (!to) return false;
  const rendered = renderThreadNotice({
    companyName: company,
    projectName: project,
    heading: kindOfNote === "bounced" ? "Bounced back" : "Note from the builder",
    subject: title,
    actorLine: `${from.name || from.email} · ${company}`,
    lead: kindOfNote === "bounced" ? "bounced this back - it needs another go before it can be closed." : "wrote about this defect.",
    body,
    attachmentsLine: line,
    tone: kindOfNote === "bounced" ? "amber" : "blue",
    linkLabel: found.side === "sub" ? "Open the item" : "Open the sign-off",
    linkUrl: link,
    linkNote: loginRequired ? "Opens for your Soterra account on the address this was sent to." : "No account needed.",
    refLabel: `QA close-out · ${title}`.slice(0, 80),
    portalUrl: PORTAL_URL,
    loginRequired,
  });
  await sendEmail({
    scope,
    kind: "inbound",
    recordType: found.kind === "flag" ? "qa_flag" : found.kind === "item" ? "inspection_item" : "checklist_item",
    recordIds: [row.id],
    to,
    replyTo: replyTo ?? from.email ?? null,
    fromName: `${company} (via Soterra)`,
    fromEmail: projectSenderAddress(project, scope.projectId),
    subject: `${title} · ${kindOfNote === "bounced" ? "bounced back" : "note"} · ${project}`,
    html: rendered.html,
    text: rendered.text,
    attachments: packed.attachments,
    sentByName: from.name || from.email,
  });
  return true;
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

/** Who a defect's links were sent to, for the sign-in gate on the token routes. */
export async function fixGateEmails(token: string): Promise<{ companyId: string; emails: string[] } | null> {
  const found = await bySubToken(token);
  if (!found) return null;
  return { companyId: found.row.companyId, emails: subEmailsOf(found) };
}
export async function signoffGateEmails(token: string): Promise<{ companyId: string; emails: string[] } | null> {
  const item = await byConsultantToken(token);
  if (!item) return null;
  return { companyId: item.companyId, emails: item.consultantEmail ? [item.consultantEmail.toLowerCase()] : [] };
}
/** Either side's emails for the photo route (sub's or consultant's token). */
export async function photoGateEmails(token: string): Promise<{ companyId: string; emails: string[] } | null> {
  return (await fixGateEmails(token)) ?? (await signoffGateEmails(token));
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

/** The photo stored on a defect row (either side's portal view). */
export function fixPhotoOf(found: FoundDefect): string | null {
  return found.row.fixPhoto ?? null;
}

/** The site team's own read of a defect's fix photo (any kind), scoped. */
export async function fixPhotoForScope(scope: Scope, kind: CloseoutKind, id: string): Promise<string | null> {
  const found = await rowOf(scope, kind, id);
  return found?.row.fixPhoto ?? null;
}

// ─── the scorecard ──────────────────────────────────────────────────────────

type Agg = { sub: string; status: string; sentAt: Date | null; readyAt: Date | null; closedAt: Date | null };

export async function analytics(scope: Scope, opts: { level?: "project" | "company" } = {}) {
  // Only defects that actually ENTERED the loop (were sent to a sub) count -
  // a never-sent 'open' item is backlog, not close-out tracking, and would
  // otherwise pile up under "Unassigned" and swamp the scorecard.
  // Default level is "project" — the scorecard lives on the site's own
  // Inspections tab. Both levels carry the companyId filter, so this read can
  // never widen past the proven company no matter what projectId says.
  const flagWhere =
    opts.level === "company"
      ? and(eq(qaFlags.companyId, scope.companyId), isNotNull(qaFlags.sentAt))
      : and(eq(qaFlags.companyId, scope.companyId), eq(qaFlags.projectId, scope.projectId), isNotNull(qaFlags.sentAt));
  const itemWhere =
    opts.level === "company"
      ? and(eq(inspectionItems.companyId, scope.companyId), isNotNull(inspectionItems.sentAt))
      : and(eq(inspectionItems.companyId, scope.companyId), eq(inspectionItems.projectId, scope.projectId), isNotNull(inspectionItems.sentAt));
  const checkWhere =
    opts.level === "company"
      ? and(eq(checklistItems.companyId, scope.companyId), isNotNull(checklistItems.sentAt))
      : and(eq(checklistItems.companyId, scope.companyId), eq(checklistItems.projectId, scope.projectId), isNotNull(checklistItems.sentAt));
  const flags = await db.select().from(qaFlags).where(flagWhere);
  const items = await db.select().from(inspectionItems).where(itemWhere);
  const checks = await db.select().from(checklistItems).where(checkWhere);
  const now = new Date();

  const rows: Agg[] = [
    ...flags.map((f) => ({ sub: f.subName || f.subEmail || "Unassigned", status: f.closeoutStatus, sentAt: f.sentAt, readyAt: f.readyAt, closedAt: f.closedAt })),
    ...items.map((i) => ({ sub: i.sentTo || "Unassigned", status: i.closeoutStatus, sentAt: i.sentAt, readyAt: i.readyAt, closedAt: i.closedAt })),
    ...checks.map((c) => ({ sub: c.sentTo || "Unassigned", status: c.closeoutStatus, sentAt: c.sentAt, readyAt: c.readyAt, closedAt: c.closedAt })),
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
