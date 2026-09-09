// ─── General correspondence — the register next to RFIs ──────────────────
//
// Everything a builder sends out that is NOT a question: a notice, a site
// instruction, a transmittal (plans, shop drawings, documents going to the
// other side) or a general letter. Same rails as an RFI: Soterra sends it
// from the project's own address, records the send (lib/email), the other
// side opens a private link (or just replies to the email) and the whole
// thread lives here. Unlike an RFI there is no answer/ball machine; the only
// clock is "response required by" when the sender asks for one.
//
// Status: draft → sent → responded (the other side wrote back) → closed.
//         void from draft or sent. Reopen = closed → sent.
// Numbers are per project PER TYPE, burned on send: NOT-001, SI-001, TR-001,
// COR-001. A draft burns nothing.
//
// Adam's brief (2026-09-09): "general correspondence could be good for
// anything like notices, sending plans, shop drawings, whatever - the more
// info goes through the system the better." Hence the transmittal option to
// file the PDFs straight into the project's Documents (plan_pages), where the
// assistant and the QA generator see them.
//
// TOKENS ARE THE AUTHORISATION for the external side, exactly as in lib/rfi.ts:
// the recipient's link carries the item's token; scope is rebuilt from the
// ROW's own company/project ids, never the client. The token never reaches a
// browser payload (publicCorr strips it). The sign-in gate on top of that is
// lib/externalAuth.ts.

import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { get } from "@vercel/blob";
import { db } from "./db";
import { consultants, correspondence, correspondenceMessages, projects, subs } from "./schema";
import type { Correspondence, CorrespondenceMessage } from "./schema";
import type { Scope } from "./company";
import { companyName } from "./company";
import { companyRequiresLogin } from "./externalAuth";
import { projectSenderAddress, sendEmail, type EmailAttachment } from "./email";
import { normalizeEmail } from "./externalAuth";
import { instructionForCorr } from "./instructions";
import { renderCorrespondenceEmail, renderThreadNotice } from "./emailTemplates";
import { indexPdf, docNameFromFilename } from "./indexPdf";
import { invalidateProjectIndex } from "./projectIndex";
import { DOC_TYPES, type DocType } from "./docType";
import { replyAddress } from "./inboundAddress";

const APP_URL = (process.env.APP_BASE_URL ?? "https://soterra.co.nz").replace(/\/+$/, "");
export const PORTAL_URL = `${APP_URL}/portal`;

export const CORR_TYPES = ["notice", "instruction", "transmittal", "general"] as const;
export type CorrType = (typeof CORR_TYPES)[number];
export const CORR_PREFIX: Record<CorrType, string> = { notice: "NOT", instruction: "SI", transmittal: "TR", general: "COR" };
export const CORR_TYPE_LABEL: Record<CorrType, string> = {
  notice: "Notice",
  instruction: "Site instruction",
  transmittal: "Transmittal",
  general: "General",
};
export const isCorrType = (v: unknown): v is CorrType => typeof v === "string" && (CORR_TYPES as readonly string[]).includes(v);

/** Email attachments ride along up to this much in total; the rest are
 *  "download from the page". Resend caps a message at 40 MB; 10 keeps the
 *  email itself deliverable through corporate gateways. */
const EMAIL_ATTACH_BUDGET = 10 * 1024 * 1024;

export type CorrAttachment = {
  filename: string;
  path: string; // private Blob pathname under <projectId>/correspondence/<id>/…
  bytes: number;
  contentType: string;
  /** Set once the PDF was filed into Documents (plan_pages). */
  filedAs?: { doc: string; docType: string } | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function corrLabel(c: { type: string; number: number | null }): string {
  if (c.number == null) return "Draft";
  const prefix = CORR_PREFIX[(isCorrType(c.type) ? c.type : "general") as CorrType];
  return `${prefix}-${String(c.number).padStart(3, "0")}`;
}
export function corrTypeLabel(t: string): string {
  return CORR_TYPE_LABEL[(isCorrType(t) ? t : "general") as CorrType];
}

export function parseAttachments(json: string | null | undefined): CorrAttachment[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as CorrAttachment[]).filter((a) => a && typeof a.path === "string") : [];
  } catch {
    return [];
  }
}
function parseCc(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map((s) => String(s).toLowerCase()) : [];
  } catch {
    return [];
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** The token stays server-side (see the header note). */
export function publicCorr(row: Correspondence): Omit<Correspondence, "token"> {
  const { token: _secret, ...pub } = row;
  return pub;
}

// ─── blob helpers ──────────────────────────────────────────────────────────

/** Where a piece of correspondence's files live. Namespaced by project + item
 *  so one item's link can never reach another's files. */
export function corrBlobPrefix(projectId: string, corrId: string): string {
  return `${projectId}/correspondence/${corrId}/`;
}

async function readPrivateBlob(path: string): Promise<Buffer | null> {
  try {
    const got = await get(path, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return null;
    return Buffer.from(await new Response(got.stream).arrayBuffer());
  } catch (e) {
    console.error("correspondence blob read failed:", path, e);
    return null;
  }
}

// ─── CRUD (the builder's side, authed through resolveScope by the caller) ──

export type CorrInput = {
  type: CorrType;
  subject: string;
  body: string;
  responseRequired?: boolean;
  dateDue?: Date | null;
  toKind?: "consultant" | "sub" | "other" | null;
  toName?: string | null;
  toCompany?: string | null;
  toEmail?: string | null;
  cc?: string[];
  fileAsDocs?: boolean;
  docType?: DocType | null;
};

function cleanInput(input: Partial<CorrInput>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = {};
  if (input.type !== undefined) set.type = isCorrType(input.type) ? input.type : "general";
  if (input.subject !== undefined) set.subject = input.subject.trim().slice(0, 200);
  if (input.body !== undefined) set.body = input.body.trim();
  if (input.responseRequired !== undefined) set.responseRequired = !!input.responseRequired;
  if (input.dateDue !== undefined) set.dateDue = input.dateDue ?? null;
  if (input.toKind !== undefined) set.toKind = input.toKind ?? null;
  if (input.toName !== undefined) set.toName = input.toName?.trim().slice(0, 120) || null;
  if (input.toCompany !== undefined) set.toCompany = input.toCompany?.trim().slice(0, 120) || null;
  if (input.toEmail !== undefined) set.toEmail = input.toEmail?.trim().toLowerCase().slice(0, 200) || null;
  if (input.cc !== undefined) {
    const cc = (input.cc ?? []).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s)).slice(0, 10);
    set.cc = cc.length ? JSON.stringify(cc) : null;
  }
  if (input.fileAsDocs !== undefined) set.fileAsDocs = !!input.fileAsDocs;
  if (input.docType !== undefined) set.docType = input.docType && (DOC_TYPES as readonly string[]).includes(input.docType) ? input.docType : null;
  return set;
}

export async function createDraft(
  scope: Scope,
  input: CorrInput,
  by: { userId?: string | null; name?: string | null },
  /** Files picked before the draft existed (staged under <projectId>/correspondence/pending/…). */
  attachments?: { filename: string; path: string; bytes: number; contentType: string }[]
): Promise<Correspondence> {
  const set = cleanInput(input);
  const root = `${scope.projectId}/correspondence/`;
  const staged: CorrAttachment[] = (attachments ?? [])
    .filter((f) => f.path.startsWith(root))
    .slice(0, 30)
    .map((f) => ({ filename: f.filename.trim().slice(0, 160) || "file", path: f.path, bytes: Math.max(0, Math.floor(f.bytes || 0)), contentType: (f.contentType || "application/octet-stream").slice(0, 120) }));
  const [row] = await db
    .insert(correspondence)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      attachments: staged.length ? JSON.stringify(staged) : null,
      type: set.type ?? "general",
      subject: set.subject ?? "",
      body: set.body ?? "",
      responseRequired: set.responseRequired ?? false,
      dateDue: set.dateDue ?? null,
      toKind: set.toKind ?? null,
      toName: set.toName ?? null,
      toCompany: set.toCompany ?? null,
      toEmail: set.toEmail ?? null,
      cc: set.cc ?? null,
      fileAsDocs: set.fileAsDocs ?? false,
      docType: set.docType ?? null,
      createdBy: by.userId ?? null,
      createdByName: by.name ?? null,
    })
    .returning();
  return row;
}

async function ours(scope: Scope, id: string): Promise<Correspondence | null> {
  const [row] = await db
    .select()
    .from(correspondence)
    .where(and(eq(correspondence.id, id), eq(correspondence.projectId, scope.projectId)))
    .limit(1);
  return row ?? null;
}

export async function updateDraft(scope: Scope, id: string, input: Partial<CorrInput>): Promise<Correspondence> {
  const row = await ours(scope, id);
  if (!row) throw new Error("Not found");
  if (row.status !== "draft") throw new Error("Only a draft can be edited");
  const set = cleanInput(input);
  set.updatedAt = new Date();
  const [updated] = await db.update(correspondence).set(set).where(eq(correspondence.id, id)).returning();
  return updated;
}

/** Attach files already uploaded (direct-to-Blob) under this item's own prefix.
 *  The prefix check is what stops a path from another site/item being linked. */
export async function attachFiles(
  scope: Scope,
  id: string,
  files: { filename: string; path: string; bytes: number; contentType: string }[]
): Promise<Correspondence> {
  const row = await ours(scope, id);
  if (!row) throw new Error("Not found");
  if (row.status === "void" || row.status === "closed") throw new Error("This item is closed");
  // The item's own folder, or the form's staging folder (files picked before
  // the draft existed). Reads never trust the folder: pathBelongsTo checks the list.
  const prefix = `${scope.projectId}/correspondence/`;
  const existing = parseAttachments(row.attachments);
  for (const f of files) {
    if (!f.path.startsWith(prefix)) throw new Error("Bad file path");
    if (existing.some((e) => e.path === f.path)) continue;
    existing.push({
      filename: f.filename.trim().slice(0, 160) || "file",
      path: f.path,
      bytes: Math.max(0, Math.floor(f.bytes || 0)),
      contentType: (f.contentType || "application/octet-stream").slice(0, 120),
    });
  }
  if (existing.length > 30) throw new Error("Too many attachments on one item");
  const [updated] = await db
    .update(correspondence)
    .set({ attachments: JSON.stringify(existing), updatedAt: new Date() })
    .where(eq(correspondence.id, id))
    .returning();
  return updated;
}

export async function removeAttachment(scope: Scope, id: string, path: string): Promise<Correspondence> {
  const row = await ours(scope, id);
  if (!row) throw new Error("Not found");
  if (row.status !== "draft") throw new Error("Attachments can only be removed from a draft");
  const kept = parseAttachments(row.attachments).filter((a) => a.path !== path);
  const [updated] = await db
    .update(correspondence)
    .set({ attachments: kept.length ? JSON.stringify(kept) : null, updatedAt: new Date() })
    .where(eq(correspondence.id, id))
    .returning();
  return updated;
}

async function projectAndCompany(scope: Scope): Promise<{ project: string; company: string }> {
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const company = (await companyName(scope.companyId)) ?? "The builder";
  return { project: proj?.name ?? "The project", company };
}

const nzDate = (d: Date) =>
  d.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });
const nzShort = (d: Date) => d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });

/** File one PDF attachment into the project's Documents. Best-effort per
 *  file: an unreadable PDF (a scan) just stays an attachment. */
async function fileOne(scope: Scope, att: CorrAttachment, docType: DocType | null): Promise<CorrAttachment> {
  if (att.filedAs) return att;
  if (!/\.pdf$/i.test(att.filename) && att.contentType !== "application/pdf") return att;
  const bytes = await readPrivateBlob(att.path);
  if (!bytes) return att;
  const doc = docNameFromFilename(att.filename);
  try {
    const res = await indexPdf({ projectId: scope.projectId, doc, bytes: new Uint8Array(bytes), file: att.path, docType });
    if (res.ok) {
      invalidateProjectIndex(scope.projectId);
      return { ...att, filedAs: { doc: res.doc, docType: docType ?? "drawings" } };
    }
  } catch (e) {
    console.error("correspondence file-as-document failed:", att.filename, e);
  }
  return att;
}

/** Send: burn the type's next number, mint the link token, file the PDFs if
 *  asked, email the recipient. The email leaves through lib/email so it is
 *  recorded whatever happens to transmission. */
export async function sendCorrespondence(
  scope: Scope,
  id: string,
  by: { userId?: string | null; name?: string | null; email?: string | null }
): Promise<{ row: Correspondence; emailStatus: string }> {
  const row = await ours(scope, id);
  if (!row) throw new Error("Not found");
  if (row.status !== "draft") throw new Error("Only a draft can be sent");
  if (!row.toEmail || !EMAIL_RE.test(row.toEmail)) throw new Error("Give it a recipient email first");
  if (!row.subject.trim()) throw new Error("Give it a subject first");

  const type = (isCorrType(row.type) ? row.type : "general") as CorrType;
  const [maxRow] = await db
    .select({ number: correspondence.number })
    .from(correspondence)
    .where(and(eq(correspondence.projectId, scope.projectId), eq(correspondence.type, type)))
    .orderBy(desc(correspondence.number))
    .limit(1);
  const number = (maxRow?.number ?? 0) + 1;
  const now = new Date();
  const token = row.token ?? randomBytes(24).toString("base64url");

  // Transmittal filing happens BEFORE the send so the email can say "filed".
  // A transmittal's PDFs ALWAYS file into Documents (drawings and specs are
  // the whole point of one - Adam 2026-09-10: "this should automatically be
  // done"); other types file on request, one tap per PDF.
  let attachments = parseAttachments(row.attachments);
  if ((type === "transmittal" || row.fileAsDocs) && attachments.length) {
    const docType = row.docType && (DOC_TYPES as readonly string[]).includes(row.docType) ? (row.docType as DocType) : "drawings";
    attachments = await Promise.all(attachments.map((a) => fileOne(scope, a, docType)));
  }

  const [sent] = await db
    .update(correspondence)
    .set({
      number,
      token,
      status: "sent",
      dateSent: now,
      sentBy: by.userId ?? null,
      sentByName: by.name ?? null,
      senderEmail: by.email ?? null,
      attachments: attachments.length ? JSON.stringify(attachments) : null,
      updatedAt: now,
    })
    .where(and(eq(correspondence.id, id), eq(correspondence.status, "draft")))
    .returning();
  if (!sent) throw new Error("Already sent");

  const { project, company } = await projectAndCompany(scope);
  const label = corrLabel(sent);
  const loginRequired = await companyRequiresLogin(scope.companyId);
  const replyTo = (await replyAddress("cor", token)) ?? by.email ?? null;
  const replyLogged = replyTo !== (by.email ?? null) && !!replyTo;

  // Attachments ride in the email while the budget lasts; the rest download
  // from the page. Small first so the most files make it in.
  const emailAttachments: EmailAttachment[] = [];
  const listed: { filename: string; attached: boolean; bytesLabel: string }[] = [];
  let used = 0;
  for (const a of [...attachments].sort((x, y) => x.bytes - y.bytes)) {
    let attached = false;
    if (a.bytes > 0 && used + a.bytes <= EMAIL_ATTACH_BUDGET) {
      const buf = await readPrivateBlob(a.path);
      // The declared size came from the browser; the real one decides.
      if (buf && used + buf.length <= EMAIL_ATTACH_BUDGET) {
        emailAttachments.push({ filename: a.filename, content: buf.toString("base64") });
        used += buf.length;
        attached = true;
      }
    }
    listed.push({ filename: a.filename, attached, bytesLabel: formatBytes(a.bytes) });
  }
  listed.sort((x, y) => x.filename.localeCompare(y.filename));

  const rendered = renderCorrespondenceEmail({
    companyName: company,
    contextLine: `${project} · Sent by ${by.name ?? "the site team"} · ${nzShort(now)}`,
    label,
    typeLabel: corrTypeLabel(type),
    subject: sent.subject,
    body: sent.body,
    responseRequired: sent.responseRequired,
    dueLabel: sent.dateDue ? nzDate(sent.dateDue) : null,
    toLine: [sent.toName, sent.toCompany].filter(Boolean).join(" · ") || sent.toEmail,
    attachments: listed,
    openUrl: `${APP_URL}/correspondence/${token}`,
    replyName: by.name ?? "the sender",
    refLabel: `${label} · ${project}`.slice(0, 80),
    portalUrl: PORTAL_URL,
    loginRequired,
    replyLogged,
  });
  const cc = parseCc(sent.cc);
  const subjectLine = `${label} · ${project} · ${sent.subject}${sent.responseRequired && sent.dateDue ? ` · response needed by ${nzDate(sent.dateDue)}` : ""}`;
  const result = await sendEmail({
    scope,
    kind: "correspondence",
    recordType: "correspondence",
    recordIds: [id],
    to: { name: sent.toName || sent.toCompany, email: sent.toEmail! },
    cc,
    fromName: `${company} (via Soterra)`,
    fromEmail: projectSenderAddress(project, scope.projectId),
    replyTo,
    subject: subjectLine,
    html: rendered.html,
    text: rendered.text,
    attachments: emailAttachments,
    sentBy: by.userId ?? null,
    sentByName: by.name ?? null,
  });
  await db.update(correspondence).set({ emailLogId: result.id }).where(eq(correspondence.id, id));
  await db.insert(correspondenceMessages).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    corrId: id,
    type: "system",
    authorSide: "contractor",
    authorName: by.name ?? null,
    via: "app",
    body:
      (result.status === "sent" ? "Sent to " : "Recorded for ") +
      ([sent.toName, sent.toCompany].filter(Boolean).join(" ") || sent.toEmail) +
      (cc.length ? ` · cc ${cc.join(", ")}` : "") +
      (attachments.some((a) => a.filedAs) ? ` · ${attachments.filter((a) => a.filedAs).length} file(s) filed in Documents` : "") +
      (result.status === "sent" ? "" : " (email sending not yet live)"),
  });

  // Remember the recipient in the Directory (best-effort, never fails a send).
  try {
    const email = sent.toEmail!;
    if (sent.toKind === "sub") {
      const [existing] = await db.select({ id: subs.id }).from(subs).where(and(eq(subs.companyId, scope.companyId), eq(subs.email, email))).limit(1);
      if (!existing) await db.insert(subs).values({ companyId: scope.companyId, name: sent.toName || sent.toCompany || email, email, createdBy: by.userId ?? null });
    } else if (sent.toKind === "consultant") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details: Record<string, any> = {};
      if (sent.toName) details.name = sent.toName;
      if (sent.toCompany) details.company = sent.toCompany;
      await db
        .insert(consultants)
        .values({ companyId: scope.companyId, email, ...details, createdBy: by.userId ?? null })
        .onConflictDoUpdate({ target: [consultants.companyId, consultants.email], set: Object.keys(details).length ? details : { email } });
    }
  } catch (e) {
    console.error("correspondence directory upsert failed:", e);
  }

  const fresh = await ours(scope, id);
  return { row: fresh ?? sent, emailStatus: result.status };
}

/** Our follow-up on a sent item: logged in the thread, emailed to the other
 *  side with the link (best-effort). Attachments must sit under this item's
 *  blob prefix, same rule as attachFiles. */
export async function addOurMessage(
  scope: Scope,
  id: string,
  body: string,
  by: { userId?: string | null; name?: string | null; email?: string | null },
  attachments?: { filename: string; path: string; bytes: number; contentType: string }[]
): Promise<CorrespondenceMessage> {
  const row = await ours(scope, id);
  if (!row) throw new Error("Not found");
  if (row.status === "draft" || row.status === "void") throw new Error("Send it first");
  const prefix = corrBlobPrefix(scope.projectId, id);
  const atts: CorrAttachment[] = (attachments ?? [])
    .filter((f) => f.path.startsWith(prefix))
    .slice(0, 10)
    .map((f) => ({ filename: f.filename.trim().slice(0, 160) || "file", path: f.path, bytes: Math.max(0, Math.floor(f.bytes || 0)), contentType: (f.contentType || "application/octet-stream").slice(0, 120) }));
  const [msg] = await db
    .insert(correspondenceMessages)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      corrId: id,
      type: "message",
      authorSide: "contractor",
      authorName: by.name ?? null,
      authorEmail: by.email ?? null,
      via: "app",
      body: body.trim(),
      attachments: atts.length ? JSON.stringify(atts) : null,
    })
    .returning();
  await db.update(correspondence).set({ updatedAt: new Date() }).where(eq(correspondence.id, id));
  try {
    await notifyExternal(scope, row, by.name ?? "The site team", msg.body, atts, by.email ?? null);
  } catch (e) {
    console.error("correspondence follow-up notice failed:", e);
  }
  return msg;
}

export async function setCorrStatus(
  scope: Scope,
  id: string,
  to: "closed" | "sent" | "void",
  by: { userId?: string | null; name?: string | null },
  note?: string | null
): Promise<Correspondence> {
  const row = await ours(scope, id);
  if (!row) throw new Error("Not found");
  const allowed: Record<string, string[]> = {
    draft: ["void"],
    sent: ["closed", "void"],
    responded: ["closed"],
    closed: ["sent"],
    void: [],
  };
  if (!allowed[row.status]?.includes(to)) throw new Error(`Can't go ${row.status} → ${to}`);
  const now = new Date();
  const [updated] = await db
    .update(correspondence)
    .set({ status: to, dateClosed: to === "closed" ? now : to === "sent" ? null : row.dateClosed, updatedAt: now })
    .where(eq(correspondence.id, id))
    .returning();
  await db.insert(correspondenceMessages).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    corrId: id,
    type: "system",
    authorSide: "contractor",
    authorName: by.name ?? null,
    via: "app",
    body: (to === "closed" ? "Closed" : to === "sent" ? "Reopened" : "Voided") + (note ? ` · ${note.trim().slice(0, 300)}` : ""),
  });
  return updated;
}

/** The one-tap "file this in Documents" on any PDF attachment of a sent item
 *  (ours or theirs), typed by the caller. */
export async function fileAttachment(scope: Scope, id: string, path: string, docType: DocType): Promise<{ ok: boolean; doc?: string }> {
  const row = await ours(scope, id);
  if (!row) throw new Error("Not found");
  const prefix = corrBlobPrefix(scope.projectId, id);
  const inboundPrefix = `${scope.projectId}/inbound/${id}/`;
  if (!path.startsWith(prefix) && !path.startsWith(inboundPrefix)) throw new Error("Bad file path");
  // The file may sit on the item or on one of its messages.
  const onItem = parseAttachments(row.attachments).find((a) => a.path === path);
  const msgs = onItem ? [] : await db.select().from(correspondenceMessages).where(eq(correspondenceMessages.corrId, id));
  const holder = onItem ? null : msgs.find((m) => parseAttachments(m.attachments).some((a) => a.path === path));
  const att = onItem ?? (holder ? parseAttachments(holder.attachments).find((a) => a.path === path) : null);
  if (!att) throw new Error("No such attachment");
  const filed = await fileOne(scope, att, docType);
  if (!filed.filedAs) return { ok: false };
  if (onItem) {
    const next = parseAttachments(row.attachments).map((a) => (a.path === path ? filed : a));
    await db.update(correspondence).set({ attachments: JSON.stringify(next), updatedAt: new Date() }).where(eq(correspondence.id, id));
  } else if (holder) {
    const next = parseAttachments(holder.attachments).map((a) => (a.path === path ? filed : a));
    await db.update(correspondenceMessages).set({ attachments: JSON.stringify(next) }).where(eq(correspondenceMessages.id, holder.id));
  }
  return { ok: true, doc: filed.filedAs.doc };
}

// ─── reads (the builder's side) ────────────────────────────────────────────

export async function listCorrespondence(scope: Scope) {
  const rows = await db
    .select()
    .from(correspondence)
    .where(eq(correspondence.projectId, scope.projectId))
    .orderBy(desc(correspondence.updatedAt));
  // The thread at a glance: how many replies, and when the last one landed.
  const counts = await db
    .select({ corrId: correspondenceMessages.corrId, n: sql<number>`count(*)::int`, last: sql<string>`max(${correspondenceMessages.createdAt})` })
    .from(correspondenceMessages)
    .where(and(eq(correspondenceMessages.projectId, scope.projectId), eq(correspondenceMessages.type, "message")))
    .groupBy(correspondenceMessages.corrId);
  const byId = new Map(counts.map((c) => [c.corrId, c]));
  const now = new Date();
  return rows.map((r) => ({
    ...publicCorr(r),
    label: corrLabel(r),
    typeLabel: corrTypeLabel(r.type),
    attachmentCount: parseAttachments(r.attachments).length,
    messageCount: byId.get(r.id)?.n ?? 0,
    lastAt: byId.get(r.id)?.last ?? null,
    overdue: r.status === "sent" && r.responseRequired && !!r.dateDue && now > r.dateDue,
  }));
}

export async function getCorrespondence(scope: Scope, id: string) {
  const row = await ours(scope, id);
  if (!row) return null;
  const messages = await db
    .select()
    .from(correspondenceMessages)
    .where(eq(correspondenceMessages.corrId, id))
    .orderBy(correspondenceMessages.createdAt);
  const now = new Date();
  return {
    item: {
      ...publicCorr(row),
      label: corrLabel(row),
      typeLabel: corrTypeLabel(row.type),
      attachments: parseAttachments(row.attachments),
      ccList: parseCc(row.cc),
      overdue: row.status === "sent" && row.responseRequired && !!row.dateDue && now > row.dateDue,
    },
    messages: messages.map((m) => ({ ...m, attachments: parseAttachments(m.attachments) })),
    // A client instruction raised from this item lives inside it.
    ci: await instructionForCorr(scope, id),
  };
}

/** Is this blob path one of the item's files (the item's own or a message's)? */
export async function pathBelongsTo(row: Correspondence, path: string): Promise<CorrAttachment | null> {
  const own = parseAttachments(row.attachments).find((a) => a.path === path);
  if (own) return own;
  const msgs = await db.select({ attachments: correspondenceMessages.attachments }).from(correspondenceMessages).where(eq(correspondenceMessages.corrId, row.id));
  for (const m of msgs) {
    const hit = parseAttachments(m.attachments).find((a) => a.path === path);
    if (hit) return hit;
  }
  return null;
}

export async function corrById(scope: Scope, id: string): Promise<Correspondence | null> {
  return ours(scope, id);
}

// ─── the external side (token-authorised link, the portal, email replies) ──

async function byToken(token: string): Promise<Correspondence | null> {
  const clean = token.trim();
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(clean)) return null;
  // lower() on both sides: an MTA may fold the local part of a reply address.
  const [row] = await db.select().from(correspondence).where(sql`lower(${correspondence.token}) = ${clean.toLowerCase()}`).limit(1);
  return row ?? null;
}
export async function corrByToken(token: string): Promise<Correspondence | null> {
  const row = await byToken(token);
  if (!row || row.status === "draft" || row.status === "void" || row.number == null) return null;
  return row;
}

/** Ids come from the ROW, never the client. */
function tokenScope(row: Correspondence): Scope {
  return { projectId: row.projectId, companyId: row.companyId as Scope["companyId"], userId: "", role: "external-link" };
}

/** The addresses an item was sent to — what the sign-in gate and the portal match on. */
export function corrRecipients(row: Correspondence): string[] {
  return [row.toEmail, ...parseCc(row.cc)].filter((e): e is string => !!e).map(normalizeEmail);
}

export type CorrView = {
  company: string;
  project: string;
  item: {
    id: string;
    label: string;
    type: string;
    typeLabel: string;
    subject: string;
    body: string;
    status: string;
    responseRequired: boolean;
    dateDue: Date | null;
    dateSent: Date | null;
    toName: string | null;
    toCompany: string | null;
    sentByName: string | null;
    attachments: { filename: string; path: string; bytes: number; contentType: string }[];
    /** Where a reply's files must be uploaded (the item's own private folder). */
    uploadPrefix: string;
  };
  messages: { id: string; authorSide: string; authorName: string | null; via: string | null; body: string; createdAt: Date; attachments: { filename: string; path: string; bytes: number; contentType: string }[] }[];
  canReply: boolean;
};

/** Everything the external page (link or portal) shows. filedAs is stripped:
 *  what we did with their file internally is ours. */
export async function corrView(row: Correspondence): Promise<CorrView> {
  const scope = tokenScope(row);
  const { project, company } = await projectAndCompany(scope);
  const messages = await db
    .select()
    .from(correspondenceMessages)
    .where(and(eq(correspondenceMessages.corrId, row.id), eq(correspondenceMessages.type, "message")))
    .orderBy(correspondenceMessages.createdAt);
  const strip = (a: CorrAttachment) => ({ filename: a.filename, path: a.path, bytes: a.bytes, contentType: a.contentType });
  return {
    company,
    project,
    item: {
      id: row.id,
      label: corrLabel(row),
      type: row.type,
      typeLabel: corrTypeLabel(row.type),
      subject: row.subject,
      body: row.body,
      status: row.status,
      responseRequired: row.responseRequired,
      dateDue: row.dateDue,
      dateSent: row.dateSent,
      toName: row.toName,
      toCompany: row.toCompany,
      sentByName: row.sentByName,
      attachments: parseAttachments(row.attachments).map(strip),
      uploadPrefix: corrBlobPrefix(row.projectId, row.id),
    },
    messages: messages.map((m) => ({
      id: m.id,
      authorSide: m.authorSide,
      authorName: m.authorName,
      via: m.via,
      body: m.body,
      createdAt: m.createdAt,
      attachments: parseAttachments(m.attachments).map(strip),
    })),
    canReply: row.status === "sent" || row.status === "responded",
  };
}

/** The other side wrote back (from the link, the portal, or a plain email).
 *  sent → responded on the first reply; the sender is notified. */
export async function replyAsExternal(
  row: Correspondence,
  body: string,
  author: { name?: string | null; email?: string | null },
  via: "link" | "portal" | "email",
  attachments?: CorrAttachment[]
): Promise<{ ok: true; message: CorrespondenceMessage } | { ok: false; error: string }> {
  // An EMAIL reply to a closed item is still kept on the thread (and the
  // sender told): with inbound on the Reply-To is ours, so dropping it would
  // lose the message entirely. The status stays closed. Link/portal replies
  // on a closed item are refused as before (the page says so).
  if (row.status !== "sent" && row.status !== "responded" && !(via === "email" && row.status === "closed")) return { ok: false, error: "closed" };
  const text = body.trim();
  if (!text && !(attachments?.length)) return { ok: false, error: "empty" };
  const name = author.name?.trim().slice(0, 120) || row.toName || row.toCompany || author.email || "The recipient";
  const [msg] = await db
    .insert(correspondenceMessages)
    .values({
      companyId: row.companyId,
      projectId: row.projectId,
      corrId: row.id,
      type: "message",
      authorSide: "external",
      authorName: name,
      authorEmail: author.email?.toLowerCase() ?? null,
      via,
      body: text || "(attachment)",
      attachments: attachments?.length ? JSON.stringify(attachments) : null,
    })
    .returning();
  const now = new Date();
  await db
    .update(correspondence)
    .set(row.status === "sent" ? { status: "responded", dateResponded: now, updatedAt: now } : { updatedAt: now })
    .where(eq(correspondence.id, row.id));
  try {
    await notifySender(row, name, text, attachments ?? [], via);
  } catch (e) {
    console.error("correspondence reply notice failed:", e);
  }
  return { ok: true, message: msg };
}

export async function replyByToken(token: string, body: string, name?: string | null, attachments?: CorrAttachment[], email?: string | null) {
  const row = await corrByToken(token);
  if (!row) return { ok: false as const, error: "not-found" };
  // The gate's matched address when there is one (a cc'd engineer replying),
  // else the To party.
  return replyAsExternal(row, body, { name, email: email || row.toEmail }, "link", attachments);
}

// ─── notices ───────────────────────────────────────────────────────────────

/** Tell whoever pressed Send that the other side wrote back. */
async function notifySender(row: Correspondence, actor: string, text: string, atts: CorrAttachment[], via: string) {
  const to = row.senderEmail?.trim();
  if (!to) return;
  const scope = tokenScope(row);
  const { project, company } = await projectAndCompany(scope);
  const label = corrLabel(row);
  const rendered = renderThreadNotice({
    companyName: company,
    projectName: project,
    heading: `${label} · reply received`,
    subject: row.subject,
    actorLine: actor,
    lead: `replied on ${label}${via === "email" ? " by email" : ""}.`,
    body: text || null,
    attachmentsLine: atts.length ? `${atts.length} attachment${atts.length === 1 ? "" : "s"}: ${atts.map((a) => a.filename).join(" · ")}` : null,
    linkLabel: "Open it in Soterra",
    linkUrl: APP_URL,
    linkNote: "The reply is in the thread. Close the item, or write back from there.",
    refLabel: `${label} · ${project}`.slice(0, 80),
    tone: "green",
  });
  await sendEmail({
    scope,
    kind: "correspondence",
    recordType: "correspondence",
    recordIds: [row.id],
    to: { email: to },
    replyTo: (await replyAddress("cor", row.token)) ?? row.toEmail ?? null,
    fromName: "Soterra",
    fromEmail: projectSenderAddress(project, scope.projectId),
    subject: `${label} reply · ${project} · ${row.subject}`,
    html: rendered.html,
    text: rendered.text,
    sentByName: actor,
  });
}

/** Tell the other side we wrote a follow-up (with the link back in). */
async function notifyExternal(scope: Scope, row: Correspondence, actor: string, text: string, atts: CorrAttachment[], senderEmail: string | null) {
  if (!row.toEmail || !row.token) return;
  const { project, company } = await projectAndCompany(scope);
  const label = corrLabel(row);
  const loginRequired = await companyRequiresLogin(scope.companyId);
  const rendered = renderThreadNotice({
    companyName: company,
    projectName: project,
    heading: `${label} · update`,
    subject: row.subject,
    actorLine: `${actor} · ${company}`,
    lead: `added to ${label}.`,
    body: text,
    attachmentsLine: atts.length ? `${atts.length} attachment${atts.length === 1 ? "" : "s"}: ${atts.map((a) => a.filename).join(" · ")}` : null,
    linkLabel: "Open in Soterra",
    linkUrl: `${APP_URL}/correspondence/${row.token}`,
    linkNote: loginRequired ? "Opens for your Soterra account on the address this was sent to." : "No account needed.",
    refLabel: `${label} · ${project}`.slice(0, 80),
    tone: "blue",
    portalUrl: PORTAL_URL,
    loginRequired,
  });
  const replyTo = (await replyAddress("cor", row.token)) ?? senderEmail ?? row.senderEmail ?? null;
  await sendEmail({
    scope,
    kind: "correspondence",
    recordType: "correspondence",
    recordIds: [row.id],
    to: { name: row.toName || row.toCompany, email: row.toEmail },
    cc: parseCc(row.cc),
    fromName: `${company} (via Soterra)`,
    fromEmail: projectSenderAddress(project, scope.projectId),
    replyTo,
    subject: `${label} · ${project} · ${row.subject}`,
    html: rendered.html,
    text: rendered.text,
    sentBy: scope.userId || null,
    sentByName: actor,
  });
}

// ─── the portal: everything addressed to a set of verified emails ─────────

export async function corrForEmails(emails: string[]) {
  if (!emails.length) return [] as Correspondence[];
  const lower = emails.map((e) => e.toLowerCase());
  // A row addressed to "local+tag@domain" belongs to the account on
  // "local@domain" (normalizeEmail). The SQL pre-filter lets exact, tagged and
  // cc'd rows through (escaping _ and % rather than deleting them); the exact
  // match on corrRecipients decides, so a substring like "an@x.nz" never
  // lists "dan@x.nz"'s items.
  const variants = lower.map((e) => {
    const clean = e.replace(/[\\%_]/g, "\\$&");
    const at = clean.lastIndexOf("@");
    return { e, clean, tagged: at > 0 ? `${clean.slice(0, at)}+%${clean.slice(at)}` : null };
  });
  const clauses = variants.flatMap((v) => [
    sql`lower(${correspondence.toEmail}) = ${v.e}`,
    sql`${correspondence.cc} ILIKE ${"%" + v.clean + "%"}`,
    ...(v.tagged ? [sql`lower(${correspondence.toEmail}) LIKE ${v.tagged}`, sql`${correspondence.cc} ILIKE ${"%" + v.tagged + "%"}`] : []),
  ]);
  const rows = await db
    .select()
    .from(correspondence)
    .where(and(inArray(correspondence.status, ["sent", "responded", "closed"]), sql`(${sql.join(clauses, sql` OR `)})`))
    .orderBy(desc(correspondence.updatedAt));
  return rows.filter((r) => corrRecipients(r).some((x) => lower.includes(x)));
}

/** One item for the portal, only if it was addressed to one of these emails. */
export async function corrForEmail(id: string, emails: string[]): Promise<Correspondence | null> {
  const [row] = await db.select().from(correspondence).where(eq(correspondence.id, id)).limit(1);
  if (!row || row.status === "draft" || row.status === "void") return null;
  const mine = new Set(emails.map((e) => e.toLowerCase()));
  return corrRecipients(row).some((r) => mine.has(r)) ? row : null;
}

export type { Correspondence, CorrespondenceMessage };
