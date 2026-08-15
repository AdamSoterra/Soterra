import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { get } from "@vercel/blob";
import { db } from "@/lib/db";
import { checklistItems, projects, subs } from "@/lib/schema";
import { resolveScope } from "@/lib/company";
import { companyName } from "@/lib/company";
import { getChecklist } from "@/lib/checklist";
import { emailEnabled, projectSenderAddress, sendEmail, type EmailAttachment } from "@/lib/email";
import { renderItemsEmail, type EmailItem } from "@/lib/emailTemplates";
import { renderSheetWithPins } from "@/lib/pinSnapshot";
import { resolveRecipients, recipientsLabel } from "@/lib/sendRecipients";

export const runtime = "nodejs";
// Renders drawing snapshots and fetches photos — give it room.
export const maxDuration = 300;

// POST /api/checklists/send-fixes
//   { checklistId, subIds: [id], extras: [{ name?, email }], message? }
//
// ONE recipient pool per send (Adam's simplification): every recipient gets
// the same email carrying ALL the Needs-fixing items, the drawing snapshots
// with the pins drawn on, and the site photos. subIds are saved subs; extras
// are one-off addresses that don't create a sub. Every send is recorded on
// email_log (Foundation 1) and the items are stamped sentTo/sentAt — that
// stamp is what the checklist shows.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Keep the total attachment payload sane: Resend caps requests at 40MB; base64
// inflates by a third. 20MB of raw bytes is a safe ceiling.
const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const checklistId = String(body.checklistId ?? "").trim();
  if (!UUID_RE.test(checklistId)) return Response.json({ error: "Bad checklistId" }, { status: 400 });
  const message = String(body.message ?? "").trim().slice(0, 1000) || null;

  const full = await getChecklist(scope, checklistId);
  if (!full) return Response.json({ error: "Checklist not found" }, { status: 404 });
  const { checklist, items } = full;
  // getChecklist scopes by company; a send must additionally belong to the
  // CURRENT project — the sender address and record are project-labelled.
  if (checklist.projectId !== scope.projectId) {
    return Response.json({ error: "That checklist belongs to a different site" }, { status: 403 });
  }

  const companySubs = await db.select().from(subs).where(eq(subs.companyId, scope.companyId));
  const recipients = resolveRecipients(body, companySubs);
  if (typeof recipients === "string") return Response.json({ error: recipients }, { status: 400 });
  if (!recipients.length) return Response.json({ error: "Pick at least one recipient" }, { status: 400 });

  // Every recipient gets the SAME email: all the Needs-fixing items.
  const sendItems = items.map((it, idx) => ({ ...it, n: idx + 1 })).filter((it) => it.status === "issue");
  if (!sendItems.length) return Response.json({ error: "Nothing marked Needs fixing to send" }, { status: 400 });

  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const projectName = proj?.name ?? "This project";
  const company = (await companyName(scope.companyId)) ?? "Your builder";
  const user = await currentUser();
  const senderName = user?.firstName || user?.username || "the site team";
  const senderEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || null;
  const dateLabel = new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });

  // ── Attachments FIRST, tracking what actually made it — the email body
  // may only claim what is truly attached (it is the evidentiary record).
  // Built ONCE: every recipient gets the identical email.
  const attachments: EmailAttachment[] = [];
  let attachBytes = 0;
  const pinsBySheet = new Map<string, { doc: string; page: number; pins: { x: number; y: number; label: string }[]; itemIds: string[] }>();
  for (const it of sendItems) {
    for (const pin of it.pins ?? []) {
      const key = `${pin.doc}::${pin.page}`;
      const entry = pinsBySheet.get(key) ?? { doc: pin.doc, page: pin.page, pins: [], itemIds: [] };
      entry.pins.push({ x: pin.x, y: pin.y, label: pin.label || String(it.n) });
      entry.itemIds.push(it.id);
      pinsBySheet.set(key, entry);
    }
  }
  let snapshotCount = 0;
  const snapshotOk = new Set<string>(); // items whose pins ARE on an attached snapshot
  for (const sheet of pinsBySheet.values()) {
    if (snapshotCount >= 6 || attachBytes >= MAX_ATTACH_BYTES) break; // cap renders per send
    const png = await renderSheetWithPins(scope.projectId, sheet.doc, sheet.page, sheet.pins);
    if (png && attachBytes + png.length <= MAX_ATTACH_BYTES) {
      const safe = sheet.doc.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 60);
      attachments.push({ filename: `${safe}-p${sheet.page}-pins.png`, content: png.toString("base64") });
      attachBytes += png.length;
      snapshotCount++;
      for (const id of sheet.itemIds) snapshotOk.add(id);
    }
  }
  const photoAttached = new Map<string, number>(); // itemId → photos actually attached
  let photosFetched = 0;
  for (const it of sendItems) {
    for (const [pi, photo] of (it.photos ?? []).entries()) {
      if (photosFetched >= 20 || attachBytes >= MAX_ATTACH_BYTES) break; // cap blob fetches per send
      try {
        const got = await get(photo.url, { access: "private" });
        if (!got || got.statusCode !== 200 || !got.stream) continue;
        const buf = Buffer.from(await new Response(got.stream).arrayBuffer());
        photosFetched++;
        if (attachBytes + buf.length > MAX_ATTACH_BYTES) continue;
        // Every checklist photo is re-encoded to JPEG client-side before
        // upload, so the honest extension is .jpg whatever the source name.
        attachments.push({ filename: `item${it.n}-photo${pi + 1}.jpg`, content: buf.toString("base64") });
        attachBytes += buf.length;
        photoAttached.set(it.id, (photoAttached.get(it.id) ?? 0) + 1);
      } catch {
        /* a missing photo must not sink the send */
      }
    }
  }

  // ── Now the body, claiming only what's real.
  const emailItems: EmailItem[] = sendItems.map((it) => {
    const attached = photoAttached.get(it.id) ?? 0;
    const total = it.photos.length;
    return {
      n: it.n,
      title: it.title,
      meta: [
        it.category,
        it.pins?.[0] ? `${it.pins[0].doc}${snapshotOk.has(it.id) ? " (pinned, snapshot attached)" : ""}` : null,
        checklist.location,
      ].filter(Boolean).join(" · ") || "QA check",
      note: it.note || it.detail || null,
      photoNote:
        attached === 0
          ? null
          : attached === total
            ? `${attached} site photo${attached === 1 ? "" : "s"} attached`
            : `${attached} of ${total} site photos attached`,
    };
  });

  const rendered = renderItemsEmail({
    companyName: company,
    contextLine: `${projectName} · ${checklist.title} · ${dateLabel}`,
    intro:
      message ||
      `Hi team, these ${sendItems.length === 1 ? "came up" : `${sendItems.length} came up`} on today's ${checklist.title}. Please put them right and reply with a photo when done.`,
    items: emailItems,
    numberColor: "amber",
    snapshotCaption: snapshotCount
      ? `Drawing snapshot${snapshotCount === 1 ? "" : "s"} with the numbered pins attached full-size`
      : null,
    replyName: `${senderName} at ${company}`,
    footerNote: "Sent with Soterra · recorded on the project QA log",
    refLabel: `${checklist.title} · item${sendItems.length === 1 ? "" : "s"} ${sendItems.map((i) => i.n).join(", ")}`,
  });

  const results: { sub: string; items: number; status: string }[] = [];
  const okStatuses = new Set<string>();
  const okRecipients: { name: string; email: string }[] = [];
  for (const recipient of recipients) {
    const result = await sendEmail({
      scope,
      kind: "qa_flags",
      recordType: "checklist_item",
      recordIds: sendItems.map((i) => i.id),
      to: recipient,
      fromName: `${company} (via Soterra)`,
      fromEmail: projectSenderAddress(projectName, scope.projectId),
      replyTo: senderEmail,
      subject: `${projectName} · ${sendItems.length} item${sendItems.length === 1 ? "" : "s"} to put right · ${checklist.title}`,
      html: rendered.html,
      text: rendered.text,
      attachments,
      sentBy: scope.userId,
      sentByName: senderName,
    });
    if (result.status !== "failed") { okStatuses.add(result.status); okRecipients.push(recipient); }
    results.push({ sub: recipient.name, items: sendItems.length, status: result.status });
  }

  // Stamp the items once — with the HONEST status: "sent" only when a provider
  // accepted it, "recorded" in record-only mode (the UI words them apart).
  // The stamp names only the recipients whose send went through; all-failed
  // stamps nothing so the UI never claims a dead send.
  if (okRecipients.length) {
    await db
      .update(checklistItems)
      .set({
        sentTo: recipientsLabel(okRecipients),
        sentAt: new Date(),
        sentStatus: okStatuses.has("sent") ? "sent" : "recorded",
      })
      .where(and(eq(checklistItems.companyId, scope.companyId), inArray(checklistItems.id, sendItems.map((i) => i.id))));
  }

  return Response.json({ sent: results, transmitting: emailEnabled() });
}
