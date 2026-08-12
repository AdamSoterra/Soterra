import { auth, currentUser } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { planPins, planPages, projects, qaFlags, subs } from "@/lib/schema";
import { resolveScope, companyName } from "@/lib/company";
import { isCategory } from "@/lib/categories";
import { emailEnabled, projectSenderAddress, sendEmail, type EmailAttachment } from "@/lib/email";
import { renderItemsEmail } from "@/lib/emailTemplates";
import { renderSheetWithPins } from "@/lib/pinSnapshot";

export const runtime = "nodejs";
// Sending renders the drawing snapshot.
export const maxDuration = 120;

// QA flags (Feature 7): pin a mistake on a drawing → note → send to the sub,
// recorded. The pin lives on plan_pins (recordType "qa_flag"); this route owns
// the flag record and its send.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/flags?doc=<title>            → flags on a drawing (all pages)
// GET /api/flags?doc=<title>&page=<n>   → flags on one page
// GET /api/flags?id=<uuid>              → one flag
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (id) {
    if (!UUID_RE.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
    const [flag] = await db.select().from(qaFlags).where(and(eq(qaFlags.id, id), eq(qaFlags.projectId, scope.projectId))).limit(1);
    if (!flag) return Response.json({ error: "Flag not found" }, { status: 404 });
    return Response.json({ flag });
  }
  const doc = url.searchParams.get("doc")?.trim();
  if (!doc) return Response.json({ error: "Pass doc or id" }, { status: 400 });
  const pageParam = url.searchParams.get("page");
  const page = Number(pageParam);
  const where = pageParam == null
    ? and(eq(qaFlags.projectId, scope.projectId), eq(qaFlags.doc, doc))
    : Number.isInteger(page) && page >= 1
      ? and(eq(qaFlags.projectId, scope.projectId), eq(qaFlags.doc, doc), eq(qaFlags.page, page))
      : null;
  if (!where) return Response.json({ error: "Bad page" }, { status: 400 });
  const flags = await db.select().from(qaFlags).where(where).orderBy(asc(qaFlags.n));
  return Response.json({ flags });
}

// POST /api/flags { doc, page, x, y, title, trade?, note?, subId? }
// Creates the flag AND its pin in one go (the pin's label = the flag number).
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

  const doc = String(body.doc ?? "").trim();
  const page = Number(body.page);
  const x = Number(body.x);
  const y = Number(body.y);
  const title = String(body.title ?? "").trim().slice(0, 200);
  const trade = String(body.trade ?? "").trim();
  const note = String(body.note ?? "").trim().slice(0, 2000) || null;
  const subId = String(body.subId ?? "").trim() || null;

  if (!doc || doc.length > 300) return Response.json({ error: "Bad doc" }, { status: 400 });
  if (!Number.isInteger(page) || page < 1) return Response.json({ error: "Bad page" }, { status: 400 });
  if (!Number.isFinite(x) || x < 0 || x > 100 || !Number.isFinite(y) || y < 0 || y > 100)
    return Response.json({ error: "x/y must be 0-100" }, { status: 400 });
  if (!title) return Response.json({ error: "Say what the issue is" }, { status: 400 });

  // The sheet must exist on this site (same integrity rule as /api/pins).
  const [sheet] = await db
    .select({ id: planPages.id })
    .from(planPages)
    .where(and(eq(planPages.projectId, scope.projectId), eq(planPages.doc, doc), eq(planPages.page, page)))
    .limit(1);
  if (!sheet) return Response.json({ error: "No such sheet page on this site" }, { status: 404 });

  let subName: string | null = null;
  let subEmail: string | null = null;
  if (subId) {
    if (!UUID_RE.test(subId)) return Response.json({ error: "Bad subId" }, { status: 400 });
    const [sub] = await db.select().from(subs).where(and(eq(subs.id, subId), eq(subs.companyId, scope.companyId))).limit(1);
    if (!sub) return Response.json({ error: "Unknown sub" }, { status: 400 });
    subName = sub.name;
    subEmail = sub.email;
  }

  // Next display number ON THIS SHEET (doc-wide, matching the mock).
  const existing = await db
    .select({ n: qaFlags.n })
    .from(qaFlags)
    .where(and(eq(qaFlags.projectId, scope.projectId), eq(qaFlags.doc, doc)));
  const n = existing.reduce((m, r) => Math.max(m, r.n), 0) + 1;

  const user = await currentUser();
  const byName = user?.firstName || user?.username || null;
  const [flag] = await db
    .insert(qaFlags)
    .values({
      companyId: scope.companyId,
      projectId: scope.projectId,
      doc,
      page,
      n,
      title,
      trade: isCategory(trade) ? trade : null,
      note,
      subName,
      subEmail,
      createdBy: scope.userId,
      createdByName: byName,
    })
    .returning();
  await db.insert(planPins).values({
    companyId: scope.companyId,
    projectId: scope.projectId,
    doc,
    page,
    x,
    y,
    recordType: "qa_flag",
    recordId: flag.id,
    label: String(n),
    createdBy: scope.userId,
  });
  return Response.json({ flag }, { status: 201 });
}

// PATCH /api/flags { id, action: "send" | "done" | "reopen", subId? , message? }
export async function PATCH(req: Request) {
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
  const id = String(body.id ?? "").trim();
  if (!UUID_RE.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  const [flag] = await db.select().from(qaFlags).where(and(eq(qaFlags.id, id), eq(qaFlags.projectId, scope.projectId))).limit(1);
  if (!flag) return Response.json({ error: "Flag not found" }, { status: 404 });
  const action = String(body.action ?? "");

  if (action === "done") {
    const [row] = await db.update(qaFlags).set({ status: "done", fixedAt: new Date() }).where(eq(qaFlags.id, id)).returning();
    return Response.json({ flag: row });
  }
  if (action === "reopen") {
    const [row] = await db.update(qaFlags).set({ status: flag.sentAt ? "sent" : "open", fixedAt: null }).where(eq(qaFlags.id, id)).returning();
    return Response.json({ flag: row });
  }
  if (action !== "send") return Response.json({ error: "Unknown action" }, { status: 400 });

  // ── send (or resend/remind) ──
  let subName = flag.subName;
  let subEmail = flag.subEmail;
  const subId = String(body.subId ?? "").trim();
  if (subId) {
    if (!UUID_RE.test(subId)) return Response.json({ error: "Bad subId" }, { status: 400 });
    const [sub] = await db.select().from(subs).where(and(eq(subs.id, subId), eq(subs.companyId, scope.companyId))).limit(1);
    if (!sub) return Response.json({ error: "Unknown sub" }, { status: 400 });
    subName = sub.name;
    subEmail = sub.email;
  }
  if (!subEmail || !subName) return Response.json({ error: "Pick the sub to send this to" }, { status: 400 });

  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const projectName = proj?.name ?? "This project";
  const company = (await companyName(scope.companyId)) ?? "Your builder";
  const user = await currentUser();
  const senderName = user?.firstName || user?.username || "the site team";
  const senderEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || null;
  const message = String(body.message ?? "").trim().slice(0, 1000) || null;

  // The pin, drawn on the sheet, attached.
  const pins = await db
    .select()
    .from(planPins)
    .where(and(eq(planPins.projectId, scope.projectId), eq(planPins.recordType, "qa_flag"), eq(planPins.recordId, flag.id)));
  const attachments: EmailAttachment[] = [];
  let snapshotAttached = false;
  if (pins.length) {
    const png = await renderSheetWithPins(scope.projectId, flag.doc, flag.page, pins.map((p) => ({ x: p.x, y: p.y, label: String(flag.n) })));
    if (png) {
      const safe = flag.doc.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 60);
      attachments.push({ filename: `${safe}-p${flag.page}-flag${flag.n}.png`, content: png.toString("base64") });
      snapshotAttached = true;
    }
  }

  const rendered = renderItemsEmail({
    companyName: company,
    contextLine: `${projectName} · ${flag.doc} · ${new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" })}`,
    intro:
      message ||
      `Hi team, this came up on ${projectName}. It's pinned on the drawing${snapshotAttached ? " (snapshot attached)" : ""}. Please put it right and reply with a photo when done.`,
    items: [{
      n: flag.n,
      title: flag.title,
      meta: [flag.trade, `${flag.doc} · p${flag.page}${snapshotAttached ? " (pinned, snapshot attached)" : ""}`].filter(Boolean).join(" · "),
      note: flag.note,
    }],
    numberColor: "amber",
    snapshotCaption: snapshotAttached ? `${flag.doc} · p${flag.page} (snapshot with the pin, attached full-size)` : null,
    replyName: `${senderName} at ${company}`,
    footerNote: "Sent with Soterra · recorded on the project QA log",
    refLabel: `Flag ${flag.n} · ${flag.doc}`,
  });

  const result = await sendEmail({
    scope,
    kind: "qa_flags",
    recordType: "qa_flag",
    recordIds: [flag.id],
    to: { name: subName, email: subEmail },
    fromName: `${company} (via Soterra)`,
    fromEmail: projectSenderAddress(projectName, scope.projectId),
    replyTo: senderEmail,
    subject: `${projectName} · 1 item to put right · ${flag.trade || "QA"} · ${flag.doc}`,
    html: rendered.html,
    text: rendered.text,
    attachments,
    sentBy: scope.userId,
    sentByName: senderName,
  });

  if (result.status === "failed") {
    return Response.json({ error: `Couldn't email ${subName} - recorded as failed, nothing delivered. Check the address and try again.`, flag }, { status: 502 });
  }
  const [row] = await db
    .update(qaFlags)
    .set({ status: "sent", subName, subEmail, sentAt: new Date(), sentStatus: result.status })
    .where(eq(qaFlags.id, id))
    .returning();
  return Response.json({ flag: row, transmitting: emailEnabled() });
}

// DELETE /api/flags?id=<uuid> — removes the flag AND its pin
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!UUID_RE.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  const deleted = await db
    .delete(qaFlags)
    .where(and(eq(qaFlags.id, id), eq(qaFlags.projectId, scope.projectId)))
    .returning({ id: qaFlags.id });
  if (!deleted.length) return Response.json({ error: "Not found" }, { status: 404 });
  await db.delete(planPins).where(and(eq(planPins.projectId, scope.projectId), eq(planPins.recordType, "qa_flag"), eq(planPins.recordId, id)));
  return Response.json({ ok: true });
}
