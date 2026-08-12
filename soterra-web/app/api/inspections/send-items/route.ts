import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspectionItems, projects, subs } from "@/lib/schema";
import { resolveScope, companyName } from "@/lib/company";
import { inspectionDetail } from "@/lib/history";
import { emailEnabled, projectSenderAddress, sendEmail } from "@/lib/email";
import { renderItemsEmail, type EmailItem } from "@/lib/emailTemplates";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/inspections/send-items
//   { inspectionId, assignments: [{ itemId, subId }], message? }
//
// Feature 6: the failed items off a filed inspection report, emailed to the
// subs responsible — one email per sub, the inspector's own wording quoted,
// recorded through Foundation 1 and stamped on each item. "We generate this
// nice list; why not send them out and record them."

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
  const rawAssignments = Array.isArray(body.assignments) ? body.assignments : [];
  if (rawAssignments.length > 100) return Response.json({ error: "Too many assignments in one send" }, { status: 400 });
  const message = String(body.message ?? "").trim().slice(0, 1000) || null;

  const detail = await inspectionDetail(scope, inspectionId);
  if (!detail) return Response.json({ error: "Inspection not found" }, { status: 404 });
  const { inspection, items } = detail;
  // inspectionDetail scopes by company; the send is labelled with THIS project.
  if (inspection.projectId !== scope.projectId) {
    return Response.json({ error: "That report belongs to a different site" }, { status: 403 });
  }

  const companySubs = await db.select().from(subs).where(eq(subs.companyId, scope.companyId));
  const subById = new Map(companySubs.map((s) => [s.id, s]));
  const itemById = new Map(items.map((it, idx) => [it.id, { ...it, n: idx + 1 }]));

  const seenPair = new Set<string>();
  const assignments: { item: (typeof items)[number] & { n: number }; sub: (typeof companySubs)[number] }[] = [];
  for (const a of rawAssignments) {
    const itemId = String((a as Record<string, unknown>)?.itemId ?? "");
    const subId = String((a as Record<string, unknown>)?.subId ?? "");
    const pair = `${itemId}::${subId}`;
    if (seenPair.has(pair)) continue;
    seenPair.add(pair);
    const item = itemById.get(itemId);
    const sub = subById.get(subId);
    if (!item || !sub) return Response.json({ error: "Unknown item or sub in assignments" }, { status: 400 });
    assignments.push({ item, sub });
  }
  if (!assignments.length) return Response.json({ error: "Nothing assigned to send" }, { status: 400 });

  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const projectName = proj?.name ?? "This project";
  const company = (await companyName(scope.companyId)) ?? "Your builder";
  const user = await currentUser();
  const senderName = user?.firstName || user?.username || "the site team";
  const senderEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || null;
  const inspectionLabel = inspection.inspectionType || inspection.doc;
  const failedLabel = inspection.inspectedOn ? `inspected ${inspection.inspectedOn}` : "from the filed report";

  const bySub = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = bySub.get(a.sub.id) ?? [];
    list.push(a);
    bySub.set(a.sub.id, list);
  }

  const results: { sub: string; items: number; status: string }[] = [];
  for (const group of bySub.values()) {
    const sub = group[0].sub;
    const groupItems = group.map((g) => g.item).sort((a, b) => a.n - b.n);

    const emailItems: EmailItem[] = groupItems.map((it) => ({
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
        `The ${inspectionLabel} inspection failed ${groupItems.length === 1 ? "an item that sits" : `${groupItems.length} items that sit`} with you, listed below exactly as the inspector wrote ${groupItems.length === 1 ? "it" : "them"}. Please work through the list and reply when each is done; we re-book the inspection once all are closed.`,
      items: emailItems,
      numberColor: "red",
      replyName: `${senderName} at ${company}`,
      replyExtra: "Each item is tracked on the project until it is closed.",
      footerNote: "Sent with Soterra · from the filed inspection report",
      refLabel: `${inspectionLabel} · item${groupItems.length === 1 ? "" : "s"} ${groupItems.map((i) => i.n).join(", ")}`,
    });

    const result = await sendEmail({
      scope,
      kind: "inspection_items",
      recordType: "inspection_item",
      recordIds: groupItems.map((i) => i.id),
      to: { name: sub.name, email: sub.email },
      fromName: `${company} (via Soterra)`,
      fromEmail: projectSenderAddress(projectName, scope.projectId),
      replyTo: senderEmail,
      subject: `${projectName} · ${groupItems.length} failed inspection item${groupItems.length === 1 ? "" : "s"} for you · ${inspectionLabel}`,
      html: rendered.html,
      text: rendered.text,
      sentBy: scope.userId,
      sentByName: senderName,
    });

    if (result.status !== "failed") {
      await db
        .update(inspectionItems)
        .set({ sentTo: sub.name, sentAt: new Date(), sentStatus: result.status })
        .where(and(eq(inspectionItems.companyId, scope.companyId), inArray(inspectionItems.id, groupItems.map((i) => i.id))));
    }
    results.push({ sub: sub.name, items: groupItems.length, status: result.status });
  }

  return Response.json({ sent: results, transmitting: emailEnabled() });
}
