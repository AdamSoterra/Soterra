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

export const runtime = "nodejs";
// Renders drawing snapshots and fetches photos — give it room.
export const maxDuration = 300;

// POST /api/checklists/send-fixes
//   { checklistId, assignments: [{ itemId, subId }], message? }
//
// Sends each assigned Needs-fixing item to its sub: one email PER SUB carrying
// all their items, the drawing snapshot with their pins drawn on it, and the
// site photos. Every send is recorded on email_log (Foundation 1) and each
// item is stamped sentTo/sentAt — that stamp is what the checklist shows.

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
  const rawAssignments = Array.isArray(body.assignments) ? body.assignments : [];
  const message = String(body.message ?? "").trim().slice(0, 1000) || null;

  const full = await getChecklist(scope, checklistId);
  if (!full) return Response.json({ error: "Checklist not found" }, { status: 404 });
  const { checklist, items } = full;

  const companySubs = await db.select().from(subs).where(eq(subs.companyId, scope.companyId));
  const subById = new Map(companySubs.map((s) => [s.id, s]));
  const itemById = new Map(items.map((it, idx) => [it.id, { ...it, n: idx + 1 }]));

  // Validate every assignment against THIS checklist's issue items and THIS
  // company's subs — anything else is a bug or a probe.
  const assignments: { item: (typeof items)[number] & { n: number }; sub: (typeof companySubs)[number] }[] = [];
  for (const a of rawAssignments) {
    const itemId = String((a as Record<string, unknown>)?.itemId ?? "");
    const subId = String((a as Record<string, unknown>)?.subId ?? "");
    const item = itemById.get(itemId);
    const sub = subById.get(subId);
    if (!item || !sub) return Response.json({ error: "Unknown item or sub in assignments" }, { status: 400 });
    if (item.status !== "issue") return Response.json({ error: `"${item.title}" isn't marked Needs fixing` }, { status: 400 });
    assignments.push({ item, sub });
  }
  if (!assignments.length) return Response.json({ error: "Nothing assigned to send" }, { status: 400 });

  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const projectName = proj?.name ?? "This project";
  const company = (await companyName(scope.companyId)) ?? "Your builder";
  const user = await currentUser();
  const senderName = user?.firstName || user?.username || "the site team";
  const senderEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || null;
  const dateLabel = new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });

  // One email per sub, carrying all their items.
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
      meta: [it.category, it.pins?.[0] ? `${it.pins[0].doc} (pinned)` : null, checklist.location].filter(Boolean).join(" · ") || "QA check",
      note: it.note || it.detail || null,
      photoNote: it.photos.length ? `${it.photos.length} site photo${it.photos.length === 1 ? "" : "s"} attached` : null,
    }));

    // Attachments: the drawing snapshot(s) with this sub's pins, then photos.
    const attachments: EmailAttachment[] = [];
    let attachBytes = 0;
    const pinsBySheet = new Map<string, { doc: string; page: number; pins: { x: number; y: number; label: string }[] }>();
    for (const it of groupItems) {
      for (const pin of it.pins ?? []) {
        const key = `${pin.doc}::${pin.page}`;
        const entry = pinsBySheet.get(key) ?? { doc: pin.doc, page: pin.page, pins: [] };
        entry.pins.push({ x: pin.x, y: pin.y, label: pin.label || String(it.n) });
        pinsBySheet.set(key, entry);
      }
    }
    let snapshotCount = 0;
    for (const sheet of pinsBySheet.values()) {
      const png = await renderSheetWithPins(scope.projectId, sheet.doc, sheet.page, sheet.pins);
      if (png && attachBytes + png.length <= MAX_ATTACH_BYTES) {
        const safe = sheet.doc.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 60);
        attachments.push({ filename: `${safe}-p${sheet.page}-pins.png`, content: png.toString("base64") });
        attachBytes += png.length;
        snapshotCount++;
      }
    }
    for (const it of groupItems) {
      for (const [pi, photo] of (it.photos ?? []).entries()) {
        try {
          const got = await get(photo.url, { access: "private" });
          if (!got || got.statusCode !== 200 || !got.stream) continue;
          const buf = Buffer.from(await new Response(got.stream).arrayBuffer());
          if (attachBytes + buf.length > MAX_ATTACH_BYTES) continue;
          const ext = photo.url.split(".").pop()?.slice(0, 4) || "jpg";
          attachments.push({ filename: `item${it.n}-photo${pi + 1}.${ext}`, content: buf.toString("base64") });
          attachBytes += buf.length;
        } catch {
          /* a missing photo must not sink the send */
        }
      }
    }

    const rendered = renderItemsEmail({
      companyName: company,
      contextLine: `${projectName} · ${checklist.title} · ${dateLabel}`,
      intro:
        message ||
        `Hi team, these ${groupItems.length === 1 ? "came up" : `${groupItems.length} came up`} on today's ${checklist.title}. Please put them right and reply with a photo when done.`,
      items: emailItems,
      numberColor: "amber",
      snapshotCaption: snapshotCount
        ? `Drawing snapshot${snapshotCount === 1 ? "" : "s"} with the numbered pins attached full-size`
        : null,
      replyName: `${senderName} at ${company}`,
      footerNote: "Sent with Soterra · recorded on the project QA log",
      refLabel: `${checklist.title} · item${groupItems.length === 1 ? "" : "s"} ${groupItems.map((i) => i.n).join(", ")}`,
    });

    const result = await sendEmail({
      scope,
      kind: "qa_flags",
      recordType: "checklist_item",
      recordIds: groupItems.map((i) => i.id),
      to: { name: sub.name, email: sub.email },
      fromName: `${company} (via Soterra)`,
      fromEmail: projectSenderAddress(projectName, scope.projectId),
      replyTo: senderEmail,
      subject: `${projectName} · ${groupItems.length} item${groupItems.length === 1 ? "" : "s"} to put right · ${sub.trade || "QA"} · ${checklist.title}`,
      html: rendered.html,
      text: rendered.text,
      attachments,
      sentBy: scope.userId,
      sentByName: senderName,
    });

    // Stamp the items as sent — the checklist's "recorded" state. A "failed"
    // transmit still stamps nothing so the UI never claims a send that died.
    if (result.status !== "failed") {
      await db
        .update(checklistItems)
        .set({ sentTo: sub.name, sentAt: new Date() })
        .where(and(eq(checklistItems.companyId, scope.companyId), inArray(checklistItems.id, groupItems.map((i) => i.id))));
    }
    results.push({ sub: sub.name, items: groupItems.length, status: result.status });
  }

  return Response.json({ sent: results, transmitting: emailEnabled() });
}
