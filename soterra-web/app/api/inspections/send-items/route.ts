import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspectionItems, projects, subs } from "@/lib/schema";
import { resolveScope, companyName } from "@/lib/company";
import { inspectionDetail } from "@/lib/history";
import { emailEnabled, projectSenderAddress, sendEmail } from "@/lib/email";
import { renderItemsEmail, type EmailItem } from "@/lib/emailTemplates";
import { resolveRecipients, recipientsLabel } from "@/lib/sendRecipients";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/inspections/send-items
//   { inspectionId, subIds: [id], extras: [{ name?, email }], message? }
//
// Feature 6: the still-open items off a filed inspection report, emailed with
// the inspector's own wording quoted, recorded through Foundation 1 and
// stamped on each item. ONE recipient pool per send (Adam's simplification):
// every recipient gets the same full list.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const inspectionId = String(body.inspectionId ?? "").trim();
  if (!UUID_RE.test(inspectionId)) return Response.json({ error: "Bad inspectionId" }, { status: 400 });
  const message = String(body.message ?? "").trim().slice(0, 1000) || null;

  const detail = await inspectionDetail(scope, inspectionId);
  if (!detail) return Response.json({ error: "Inspection not found" }, { status: 404 });
  const { inspection, items } = detail;
  // inspectionDetail scopes by company; the send is labelled with THIS project.
  if (inspection.projectId !== scope.projectId) {
    return Response.json({ error: "That report belongs to a different site" }, { status: 403 });
  }

  const companySubs = await db.select().from(subs).where(eq(subs.companyId, scope.companyId));
  const recipients = resolveRecipients(body, companySubs);
  if (typeof recipients === "string") return Response.json({ error: recipients }, { status: 400 });
  if (!recipients.length) return Response.json({ error: "Pick at least one recipient" }, { status: 400 });

  // Every recipient gets the SAME email: all the still-open items.
  const sendItems = items.map((it, idx) => ({ ...it, n: idx + 1 })).filter((it) => (it.workStatus ?? "not_done") !== "done");
  if (!sendItems.length) return Response.json({ error: "Every item on this report is already done" }, { status: 400 });

  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const projectName = proj?.name ?? "This project";
  const company = (await companyName(scope.companyId)) ?? "Your builder";
  const user = await currentUser();
  const senderName = user?.firstName || user?.username || "the site team";
  const senderEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || null;
  const inspectionLabel = inspection.inspectionType || inspection.doc;
  const failedLabel = inspection.inspectedOn ? `inspected ${inspection.inspectedOn}` : "from the filed report";

  // Composed ONCE — every recipient gets the identical email.
  const emailItems: EmailItem[] = sendItems.map((it) => ({
    n: it.n,
    title: it.title,
    meta: [it.category, it.location].filter(Boolean).join(" · ") || "Inspection item",
    // The inspector's own wording, quoted — that's what the sub answers to.
    note: it.detail ? `Inspector: "${it.detail}"` : null,
    statusLabel: it.workStatus === "in_progress" ? "in progress" : "not done",
  }));

  const rendered = renderItemsEmail({
    companyName: company,
    contextLine: `${projectName} · ${inspectionLabel} · ${failedLabel}`,
    intro:
      message ||
      `The ${inspectionLabel} inspection failed the item${sendItems.length === 1 ? "" : "s"} below, listed exactly as the inspector wrote ${sendItems.length === 1 ? "it" : "them"}. Please work through the list and reply when each is done; we re-book the inspection once all are closed.`,
    items: emailItems,
    numberColor: "red",
    replyName: `${senderName} at ${company}`,
    replyExtra: "Each item is tracked on the project until it is closed.",
    footerNote: "Sent with Soterra · from the filed inspection report",
    refLabel: `${inspectionLabel} · item${sendItems.length === 1 ? "" : "s"} ${sendItems.map((i) => i.n).join(", ")}`,
  });

  const results: { sub: string; items: number; status: string }[] = [];
  const okStatuses = new Set<string>();
  const okRecipients: { name: string; email: string }[] = [];
  for (const recipient of recipients) {
    const result = await sendEmail({
      scope,
      kind: "inspection_items",
      recordType: "inspection_item",
      recordIds: sendItems.map((i) => i.id),
      to: recipient,
      fromName: `${company} (via Soterra)`,
      fromEmail: projectSenderAddress(projectName, scope.projectId),
      replyTo: senderEmail,
      subject: `${projectName} · ${sendItems.length} failed inspection item${sendItems.length === 1 ? "" : "s"} to close out · ${inspectionLabel}`,
      html: rendered.html,
      text: rendered.text,
      sentBy: scope.userId,
      sentByName: senderName,
    });
    if (result.status !== "failed") { okStatuses.add(result.status); okRecipients.push(recipient); }
    results.push({ sub: recipient.name, items: sendItems.length, status: result.status });
  }

  // Stamp once, naming only the recipients whose send went through;
  // all-failed stamps nothing so the UI never claims a dead send.
  if (okRecipients.length) {
    await db
      .update(inspectionItems)
      .set({
        sentTo: recipientsLabel(okRecipients),
        sentAt: new Date(),
        sentStatus: okStatuses.has("sent") ? "sent" : "recorded",
      })
      .where(and(eq(inspectionItems.companyId, scope.companyId), inArray(inspectionItems.id, sendItems.map((i) => i.id))));
  }

  return Response.json({ sent: results, transmitting: emailEnabled() });
}
