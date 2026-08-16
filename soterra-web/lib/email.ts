// ─── Outbound email — Foundation 1 ───────────────────────────────────────
//
// Soterra sends on behalf of a company from a per-project address on the
// verified send domain (kauri-tower@send.soterra.co.nz). These are labels,
// not mailboxes: the domain is verified with Resend once, then any address
// on it is a valid sender, so a new company needs zero email setup.
//
// RECORD FIRST. Every send is written to email_log BEFORE any transmit
// attempt — the log row, not the provider, is what the RFI analytics, the QA
// record and the EOT evidence pack read. With no RESEND_API_KEY the send
// stops there (status "recorded"): the whole feature works end-to-end in
// record-only mode and flips to real transmission the moment the key exists.
//
// Replies: Reply-To is the person who pressed Send, so answers land in their
// normal inbox. Inbound capture is a deliberate fast-follow, not v1.

import { eq } from "drizzle-orm";
import { db } from "./db";
import { emailLog } from "./schema";
import type { Scope } from "./company";

const SEND_DOMAIN = process.env.EMAIL_SEND_DOMAIN || "send.soterra.co.nz";
const RESEND_URL = "https://api.resend.com/emails";

/** True when EMAIL_TRANSMIT is on. TRIMMED, deliberately: a value set from a
 *  Windows shell arrives as "1\r", which an exact === "1" silently rejects —
 *  that bug kept the whole app in record-only mode with the switch "on". */
export function emailTransmitOn(): boolean {
  return process.env.EMAIL_TRANSMIT?.trim() === "1";
}

export function emailEnabled(): boolean {
  // Two-part switch: the key must exist AND transmission must be explicitly
  // turned on. EMAIL_TRANSMIT stays unset until send.soterra.co.nz verifies —
  // otherwise every send would reach Resend just to be rejected ("domain not
  // verified") and the log would fill with failures that aren't ours.
  return !!process.env.RESEND_API_KEY && emailTransmitOn();
}

/** "Kauri Tower" + its project id → kauri-tower-7b6663@send.soterra.co.nz.
 *  The id token makes the address unique PER PROJECT: without it, two
 *  companies with same-named projects would emit byte-identical, DKIM-valid
 *  sender addresses (and any future inbound reply-routing keyed on the
 *  address would cross tenants — the isolation invariant, in email form). */
export function projectSenderAddress(projectName: string, projectId: string): string {
  const slug =
    projectName
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "project";
  const token = projectId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "0";
  return `${slug}-${token}@${SEND_DOMAIN}`;
}

/** Display-name sanitiser for the From/To headers: strips characters that
 *  would break `Name <addr>` parsing, then quotes the whole name. */
function headerName(name: string): string {
  const clean = name.replace(/["<>\r\n\\]/g, "").trim();
  return clean ? `"${clean}"` : "";
}

export type EmailAttachment = {
  filename: string;
  /** base64-encoded file content */
  content: string;
};

export type SendEmailInput = {
  scope: Scope;
  kind: "qa_flags" | "rfi" | "inspection_items" | "test";
  recordType?: "qa_flag" | "rfi" | "inspection_item" | "checklist_item" | null;
  recordIds?: string[];
  to: { name?: string | null; email: string };
  cc?: string[];
  /** e.g. "Kauri Construction (via Soterra)" */
  fromName: string;
  /** projectSenderAddress(project.name) */
  fromEmail: string;
  /** the sender's real inbox — where a plain Reply lands */
  replyTo?: string | null;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  sentBy?: string | null;
  sentByName?: string | null;
};

export type SendEmailResult = {
  id: string; // email_log id
  status: "recorded" | "sent" | "failed";
  providerId?: string | null;
  error?: string | null;
};

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // 1) Record. companyId/projectId come from the verified Scope only.
  //    Attachment CONTENT is not stored (base64 blobs don't belong in the
  //    log); filenames + sizes are, so the record shows what evidence rode
  //    along with the send.
  const attachmentsMeta = input.attachments?.length
    ? JSON.stringify(
        input.attachments.map((a) => ({
          filename: a.filename,
          bytes: Math.floor((a.content.length * 3) / 4),
        }))
      )
    : null;
  const [row] = await db
    .insert(emailLog)
    .values({
      companyId: input.scope.companyId,
      projectId: input.scope.projectId,
      kind: input.kind,
      recordType: input.recordType ?? null,
      recordIds: input.recordIds?.length ? JSON.stringify(input.recordIds) : null,
      toName: input.to.name ?? null,
      toEmail: input.to.email,
      cc: input.cc?.length ? JSON.stringify(input.cc) : null,
      fromEmail: input.fromEmail,
      replyTo: input.replyTo ?? null,
      subject: input.subject,
      html: input.html,
      attachments: attachmentsMeta,
      sentBy: input.sentBy ?? null,
      sentByName: input.sentByName ?? null,
    })
    .returning({ id: emailLog.id });

  // 2) Transmit — only when the provider key exists. The try covers ONLY the
  //    provider exchange: once Resend has accepted the email, a bookkeeping
  //    failure must never mark the row "failed" — a delivered RFI recorded as
  //    failed invites a duplicate resend to a real consultant.
  if (!emailEnabled()) return { id: row.id, status: "recorded" };

  let providerId: string | null = null;
  try {
    const toField = input.to.name
      ? `${headerName(input.to.name)} <${input.to.email}>`
      : input.to.email;
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${headerName(input.fromName)} <${input.fromEmail}>`,
        to: [toField],
        ...(input.cc?.length ? { cc: input.cc } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
    });
    const data: { id?: string; message?: string } = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${data?.message || "send rejected"}`);
    }
    providerId = data.id ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await db
        .update(emailLog)
        .set({ status: "failed", error: msg.slice(0, 1000) })
        .where(eq(emailLog.id, row.id));
    } catch {
      // DB outage on the failure write: the row stays "recorded"; the result
      // below still tells the caller what actually happened.
    }
    return { id: row.id, status: "failed", error: msg };
  }

  // 3) Bookkeeping, OUTSIDE the transmit try — the email is genuinely sent.
  try {
    await db
      .update(emailLog)
      .set({ status: "sent", providerId, sentAt: new Date() })
      .where(eq(emailLog.id, row.id));
  } catch {
    // Transient DB error on the status flip: the send still happened, so the
    // caller is told "sent". The row stays at "recorded" (never "failed"),
    // which no retry logic treats as a resend signal.
  }
  return { id: row.id, status: "sent", providerId };
}
