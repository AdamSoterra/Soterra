// ─── Inbound email: a plain reply lands in the thread ─────────────────────
//
// Until now every external email said "or simply reply" and the reply went
// to the sender's own inbox - real, but invisible to Soterra. With inbound
// on, the Reply-To is a per-item address (lib/inboundAddress.ts), Resend
// receives the mail on the inbound domain and calls /api/email/inbound with
// an `email.received` event. This module does the rest:
//
//   1. verify the webhook signature (Svix scheme: HMAC-SHA256 over
//      "<id>.<timestamp>.<raw body>" with the base64 secret after "whsec_")
//   2. fetch the full email + attachments from Resend (the event carries
//      only metadata)
//   3. find the reply address among the recipients → kind + token → the row
//   4. strip the quoted history off the reply, store the attachments in the
//      item's own private Blob folder
//   5. write it into the item's thread (RFI / correspondence), or log it
//      against the defect and pass it on (fix / sign-off), and tell the
//      other side by email so nobody watches two inboxes
//   6. record every arrival in inbound_emails (unique on Resend's id, so a
//      redelivered webhook can never post twice)
//
// Nothing here trusts the email's From for authorisation: the reply ADDRESS
// carries the token, and the token is what authorises writing to the item -
// the same rule as the emailed links. The From only decides which side of
// the thread the line sits on.

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db } from "./db";
import { inboundEmails } from "./schema";
import { resendKey } from "./email";
import { getSetting } from "./settings";
import { bareAddress, displayNameOf, parseReplyAddress, type InboundKind } from "./inboundAddress";
import { rfiByToken, emailReplyOnRfi } from "./rfi";
import { corrByToken, replyAsExternal, corrRecipients, type CorrAttachment } from "./correspondence";
import { defectByReplyToken, emailReplyOnDefect } from "./qaCloseout";

const RESEND = "https://api.resend.com";
const MAX_ATTACHMENT = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// ─── 1. signature ─────────────────────────────────────────────────────────

export async function webhookSecret(): Promise<string | null> {
  return getSetting("resend_webhook_secret", "RESEND_WEBHOOK_SECRET");
}

/** Svix-style verification, done by hand so no extra dependency rides along.
 *  Tolerance 5 minutes either way on the timestamp. */
export function verifySvix(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  for (const part of headers.signature.split(/\s+/)) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    let given: Buffer;
    try {
      given = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

// ─── 2. fetch from Resend ─────────────────────────────────────────────────

export type InboundAttachment = { filename: string; contentType: string; bytes: Buffer };
export type ParsedInbound = {
  providerId: string;
  messageId: string | null;
  from: { email: string; name: string };
  recipients: string[]; // to + cc + received_for, bare lowercase
  subject: string;
  text: string; // the reply with quoted history stripped
  attachments: InboundAttachment[];
};

type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  received_for?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  message_id?: string | null;
  headers?: Record<string, string>;
  attachments?: { id: string; filename?: string; content_type?: string; content_disposition?: string | null; size?: number }[];
};

/** Reading received mail needs a FULL-ACCESS Resend key: the sending key in
 *  RESEND_API_KEY is deliberately restricted to sends ("This API key is
 *  restricted to only send emails"). RESEND_INBOUND_API_KEY (or the
 *  app_settings row resend_inbound_api_key) holds the receiving one; with
 *  neither, we fall back to the send key and let Resend say no. */
async function inboundKey(): Promise<string> {
  const k = await getSetting("resend_inbound_api_key", "RESEND_INBOUND_API_KEY");
  return (k ?? resendKey()).replace(/[^\x21-\x7e]/g, "");
}

async function resendGet<T>(path: string): Promise<T> {
  const r = await fetch(`${RESEND}${path}`, { headers: { Authorization: `Bearer ${await inboundKey()}` } });
  if (!r.ok) throw new Error(`Resend ${r.status} on ${path}`);
  return (await r.json()) as T;
}

export async function fetchReceivedEmail(emailId: string): Promise<ParsedInbound> {
  const mail = await resendGet<ReceivedEmail>(`/emails/receiving/${encodeURIComponent(emailId)}`);
  const rawText = mail.text?.trim() || (mail.html ? htmlToText(mail.html) : "");
  const attachments: InboundAttachment[] = [];
  const listed = (mail.attachments ?? []).filter((a) => a.content_disposition !== "inline").slice(0, MAX_ATTACHMENTS);
  if (listed.length) {
    try {
      const list = await resendGet<{ data: { id: string; filename?: string; content_type?: string; size?: number; download_url?: string }[] }>(
        `/emails/receiving/${encodeURIComponent(emailId)}/attachments`
      );
      for (const a of list.data ?? []) {
        if (!listed.some((l) => l.id === a.id) || !a.download_url) continue;
        if ((a.size ?? 0) > MAX_ATTACHMENT) continue;
        const res = await fetch(a.download_url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_ATTACHMENT) continue;
        attachments.push({ filename: safeFilename(a.filename || "attachment"), contentType: a.content_type || "application/octet-stream", bytes: buf });
      }
    } catch (e) {
      console.error("inbound attachments fetch failed:", e);
    }
  }
  const recipients = [...(mail.to ?? []), ...(mail.cc ?? []), ...(mail.received_for ?? [])].map(bareAddress).filter(Boolean);
  return {
    providerId: mail.id,
    messageId: mail.message_id ?? mail.headers?.["message-id"] ?? null,
    from: { email: bareAddress(mail.from), name: displayNameOf(mail.from) },
    recipients,
    subject: (mail.subject ?? "").trim(),
    text: stripQuoted(rawText),
    attachments,
  };
}

// ─── 3/4. helpers ─────────────────────────────────────────────────────────

export function safeFilename(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\r\n]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean || "attachment";
}

/** Very small HTML → text: enough for a reply body when there is no text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut the reply off where the quoted original starts. Covers Gmail,
 *  Outlook, Apple Mail and plain ">" quoting. Conservative: when no marker is
 *  found the whole text is kept. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const markers: RegExp[] = [
    /^On .{3,200} wrote:\s*$/i, // Gmail / Apple Mail
    /^-{2,}\s*Original Message\s*-{2,}\s*$/i, // Outlook
    /^From:\s.+$/i, // Outlook header block (followed by Sent:/To:)
    /^Sent from my (iPhone|iPad|Samsung|Galaxy|Android)/i,
    /^_{5,}\s*$/, // Outlook divider
    /^Le .{3,200} a écrit\s*:\s*$/i,
  ];
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith(">")) {
      cut = Math.min(cut, i);
      break;
    }
    if (markers.some((m) => m.test(l))) {
      // "From:" only counts as a header block when a "Sent:" / "To:" follows.
      if (/^From:/i.test(l) && !lines.slice(i + 1, i + 4).some((x) => /^(Sent|To|Date):/i.test(x.trim()))) continue;
      cut = Math.min(cut, i);
      break;
    }
  }
  // A line like "On Tue, 9 Sep 2026 at 10:15, Adam <adam@…>" may wrap over
  // two lines: drop a trailing unfinished "On …" line too.
  let out = lines.slice(0, cut);
  while (out.length && /^On .{3,200}$/i.test(out[out.length - 1].trim()) && !/wrote:$/i.test(out[out.length - 1].trim())) out.pop();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Store the attachments under the item's own private folder. */
async function storeAttachments(projectId: string, recordId: string, atts: InboundAttachment[]): Promise<CorrAttachment[]> {
  const out: CorrAttachment[] = [];
  if (!BLOB_TOKEN) return out;
  for (const a of atts) {
    try {
      const { pathname } = await put(`${projectId}/inbound/${recordId}/${a.filename}`, a.bytes, {
        access: "private",
        addRandomSuffix: true,
        contentType: a.contentType,
        token: BLOB_TOKEN,
      });
      out.push({ filename: a.filename, path: pathname, bytes: a.bytes.length, contentType: a.contentType });
    } catch (e) {
      console.error("inbound attachment store failed:", a.filename, e);
    }
  }
  return out;
}

// ─── 5/6. dispatch ────────────────────────────────────────────────────────

export type InboundResult = { handled: string; recordType?: string | null; recordId?: string | null };

export async function handleInbound(p: ParsedInbound): Promise<InboundResult> {
  // Idempotent on Resend's id: a webhook retry after a slow first run must
  // not post the reply twice.
  const [seen] = await db.select({ id: inboundEmails.id, handled: inboundEmails.handled }).from(inboundEmails).where(eq(inboundEmails.providerId, p.providerId)).limit(1);
  if (seen) return { handled: `duplicate:${seen.handled}` };

  let target: { kind: InboundKind; token: string } | null = null;
  let toAddress: string | null = null;
  for (const r of p.recipients) {
    const hit = parseReplyAddress(r);
    if (hit) {
      target = { kind: hit.kind, token: hit.token };
      toAddress = r;
      break;
    }
  }

  const record = async (fields: {
    companyId?: string | null;
    projectId?: string | null;
    recordType?: string | null;
    recordId?: string | null;
    attachments?: CorrAttachment[];
    handled: string;
  }) => {
    try {
      await db.insert(inboundEmails).values({
        companyId: fields.companyId ?? null,
        projectId: fields.projectId ?? null,
        recordType: fields.recordType ?? null,
        recordId: fields.recordId ?? null,
        providerId: p.providerId,
        messageId: p.messageId,
        fromEmail: p.from.email,
        fromName: p.from.name,
        toAddress,
        subject: p.subject,
        text: p.text.slice(0, 20000),
        attachments: fields.attachments?.length ? JSON.stringify(fields.attachments) : null,
        handled: fields.handled,
      });
    } catch (e) {
      console.error("inbound log write failed:", e);
    }
    return { handled: fields.handled, recordType: fields.recordType ?? null, recordId: fields.recordId ?? null };
  };

  if (!target) return record({ handled: "unmatched" });
  const attLine = (atts: { filename: string }[]) => (atts.length ? `${atts.length} attachment${atts.length === 1 ? "" : "s"}: ${atts.map((a) => a.filename).join(" · ")}` : null);

  if (target.kind === "rfi") {
    const rfi = await rfiByToken(target.token);
    if (!rfi) return record({ handled: "unmatched" });
    const stored = await storeAttachments(rfi.projectId, rfi.id, p.attachments);
    const line = attLine(stored);
    const text = line && !p.text ? `(${line})` : p.text;
    const res = await emailReplyOnRfi(rfi, p.from, text, stored);
    return record({ companyId: rfi.companyId, projectId: rfi.projectId, recordType: "rfi", recordId: rfi.id, attachments: stored, handled: res.handled });
  }

  if (target.kind === "cor") {
    const row = await corrByToken(target.token);
    if (!row) return record({ handled: "unmatched" });
    const stored = await storeAttachments(row.projectId, row.id, p.attachments);
    const fromLower = p.from.email.toLowerCase();
    const isOurSender = !!row.senderEmail && fromLower === row.senderEmail.toLowerCase();
    if (isOurSender) {
      // Our own sender replying from their inbox: their words go in as OUR
      // follow-up (no notice back to ourselves).
      const { addOurMessage } = await import("./correspondence");
      const scope = { projectId: row.projectId, companyId: row.companyId as never, userId: row.sentBy ?? "", role: "email" };
      try {
        await addOurMessage(scope, row.id, p.text || "(see attachments)", { userId: row.sentBy, name: p.from.name, email: p.from.email }, stored);
      } catch (e) {
        console.error("inbound our-side correspondence reply failed:", e);
        return record({ companyId: row.companyId, projectId: row.projectId, recordType: "correspondence", recordId: row.id, attachments: stored, handled: "rejected" });
      }
      return record({ companyId: row.companyId, projectId: row.projectId, recordType: "correspondence", recordId: row.id, attachments: stored, handled: "corr_followup" });
    }
    const known = corrRecipients(row).includes(fromLower);
    const name = known ? (fromLower === row.toEmail ? row.toName || p.from.name : p.from.name) : p.from.name || p.from.email;
    const res = await replyAsExternal(row, p.text, { name, email: p.from.email }, "email", stored);
    return record({
      companyId: row.companyId,
      projectId: row.projectId,
      recordType: "correspondence",
      recordId: row.id,
      attachments: stored,
      handled: res.ok ? "corr_reply" : `rejected:${res.error}`,
    });
  }

  // fix / so: a defect. No thread table - the note is logged here and passed
  // on to the other side by email (lib/qaCloseout.ts).
  const found = await defectByReplyToken(target.kind, target.token);
  if (!found) return record({ handled: "unmatched" });
  const stored = await storeAttachments(found.row.projectId, found.row.id, p.attachments);
  const res = await emailReplyOnDefect(found, p.from, p.text, stored);
  return record({
    companyId: found.row.companyId,
    projectId: found.row.projectId,
    recordType: found.kind === "flag" ? "qa_flag" : "inspection_item",
    recordId: found.row.id,
    attachments: stored,
    handled: res.handled,
  });
}
