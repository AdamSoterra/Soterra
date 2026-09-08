import { auth, currentUser } from "@clerk/nextjs/server";
import { verifiedEmails } from "@/lib/externalAuth";
import {
  answerAsConsultant,
  commentAsConsultant,
  rfiLabel,
  rfiRecipients,
  rfiThreadView,
  rfisForEmails,
  sentRfiById,
} from "@/lib/rfi";
import { corrForEmail, corrForEmails, corrLabel, corrTypeLabel, corrView, replyAsExternal, type CorrAttachment } from "@/lib/correspondence";
import { defectForEmail, defectsForEmails, fixView, markReadyRow, signoffRow, signoffView } from "@/lib/qaCloseout";
import { db } from "@/lib/db";
import { companies, projects } from "@/lib/schema";
import { inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

// The consultant / subcontractor portal - soterra.co.nz/portal.
//
// A signed-in Soterra account with NO company of its own (or with one - it
// makes no difference) sees every item that was emailed to one of its VERIFIED
// addresses, across every builder and project using Soterra: RFIs to answer,
// defects to fix, sign-offs to give, correspondence to read or respond to.
// Nothing else. The match is on the verified email only; the item ids are
// checked again on every read and write (defectForEmail / corrForEmail /
// rfiRecipients), so a guessed id reaches nothing.
//
//   GET  /api/portal                     → the list, grouped for the page
//   GET  /api/portal?kind=rfi&id=…       → one item's view (same shapes as the
//        kind=fix|signoff|corr             token pages, so the UI is shared)
//   POST /api/portal {kind, id, action…} → the same actions the token pages take

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function me() {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  const emails = verifiedEmails(user as never);
  const name = user?.firstName ? `${user.firstName}${user.lastName ? " " + user.lastName : ""}` : user?.username || emails[0]?.split("@")[0] || "";
  return { userId, emails, name };
}

async function names(projectIds: string[], companyIds: string[]) {
  const projs = projectIds.length ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, [...new Set(projectIds)])) : [];
  const cos = companyIds.length ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, [...new Set(companyIds)])) : [];
  return { project: new Map(projs.map((p) => [p.id, p.name])), company: new Map(cos.map((c) => [c.id, c.name])) };
}

export async function GET(req: Request) {
  const who = await me();
  if (!who) return Response.json({ error: "Not signed in", loginRequired: true }, { status: 401 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id");

  if (kind && id) {
    if (!UUID_RE.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
    if (kind === "rfi") {
      const rfi = await sentRfiById(id);
      if (!rfi || !rfiRecipients(rfi).some((e) => who.emails.includes(e))) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(await rfiThreadView(rfi), { headers: { "Cache-Control": "no-store" } });
    }
    if (kind === "fix") {
      const t = url.searchParams.get("table");
      const table = t === "flag" ? "flag" : t === "check" ? "check" : "item";
      const found = await defectForEmail(table, id, who.emails, "sub");
      if (!found) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(await fixView(found), { headers: { "Cache-Control": "no-store" } });
    }
    if (kind === "signoff") {
      const found = await defectForEmail("item", id, who.emails, "consultant");
      if (!found || found.kind !== "item") return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(await signoffView(found.row), { headers: { "Cache-Control": "no-store" } });
    }
    if (kind === "corr") {
      const row = await corrForEmail(id, who.emails);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(await corrView(row), { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Unknown kind" }, { status: 400 });
  }

  // The list.
  const [rfis, corr, defects] = await Promise.all([rfisForEmails(who.emails), corrForEmails(who.emails), defectsForEmails(who.emails)]);
  const pids = [...rfis.map((r) => r.projectId), ...corr.map((c) => c.projectId), ...defects.fixes.map((f) => f.row.projectId), ...defects.signoffs.map((s) => s.projectId)];
  const cids = [...rfis.map((r) => r.companyId), ...corr.map((c) => c.companyId), ...defects.fixes.map((f) => f.row.companyId), ...defects.signoffs.map((s) => s.companyId)];
  const n = await names(pids, cids);
  const now = Date.now();
  const items = [
    ...rfis.map((r) => ({
      kind: "rfi" as const,
      id: r.id,
      label: rfiLabel(r),
      title: r.subject,
      project: n.project.get(r.projectId) ?? "Project",
      company: n.company.get(r.companyId) ?? "Builder",
      status: r.status,
      needsYou: r.status === "open",
      overdue: r.status === "open" && !!r.dateRequiredBy && now > r.dateRequiredBy.getTime(),
      due: r.dateRequiredBy,
      at: r.updatedAt,
      meta: [r.discipline, r.location].filter(Boolean).join(" · "),
    })),
    ...corr.map((c) => ({
      kind: "corr" as const,
      id: c.id,
      label: corrLabel(c),
      title: c.subject,
      project: n.project.get(c.projectId) ?? "Project",
      company: n.company.get(c.companyId) ?? "Builder",
      status: c.status,
      needsYou: c.status === "sent" && c.responseRequired,
      overdue: c.status === "sent" && c.responseRequired && !!c.dateDue && now > c.dateDue.getTime(),
      due: c.dateDue,
      at: c.updatedAt,
      meta: corrTypeLabel(c.type),
    })),
    ...defects.fixes.map((f) => ({
      kind: "fix" as const,
      id: f.row.id,
      table: f.kind,
      label: "Defect",
      title: f.row.title,
      project: n.project.get(f.row.projectId) ?? "Project",
      company: n.company.get(f.row.companyId) ?? "Builder",
      status: f.row.closeoutStatus,
      needsYou: f.row.closeoutStatus === "sent",
      overdue: false,
      due: null as Date | null,
      at: f.row.readyAt ?? f.row.sentAt ?? f.row.createdAt,
      meta: [
        f.kind === "flag" ? f.row.trade : f.row.category,
        f.kind === "flag" ? `${f.row.doc} · p${f.row.page}` : f.kind === "item" ? f.row.location : "QA check",
      ].filter(Boolean).join(" · "),
    })),
    ...defects.signoffs.map((s) => ({
      kind: "signoff" as const,
      id: s.id,
      label: "Sign-off",
      title: s.title,
      project: n.project.get(s.projectId) ?? "Project",
      company: n.company.get(s.companyId) ?? "Builder",
      status: s.closeoutStatus,
      needsYou: s.closeoutStatus === "submitted",
      overdue: false,
      due: null as Date | null,
      at: s.submittedAt ?? s.closedAt ?? s.createdAt,
      meta: [s.category, s.location].filter(Boolean).join(" · "),
    })),
  ].sort((a, b) => (b.at?.getTime?.() ?? 0) - (a.at?.getTime?.() ?? 0));
  return Response.json({ me: { name: who.name, emails: who.emails }, items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const who = await me();
  if (!who) return Response.json({ error: "Not signed in", loginRequired: true }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const kind = String(body.kind ?? "");
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  const text = String(body.body ?? "").trim();
  const name = (typeof body.authorName === "string" && body.authorName.trim()) || who.name || null;
  if (text.length > 20000) return Response.json({ error: "That is too long." }, { status: 413 });

  try {
    if (kind === "rfi") {
      const rfi = await sentRfiById(id);
      if (!rfi || !rfiRecipients(rfi).some((e) => who.emails.includes(e))) return Response.json({ error: "Not found" }, { status: 404 });
      const action = String(body.action ?? "");
      if (action !== "answer" && action !== "comment") return Response.json({ error: "Unknown action" }, { status: 400 });
      if (!text) return Response.json({ error: "Write the response first." }, { status: 400 });
      const res = action === "answer" ? await answerAsConsultant(rfi, text, name, "portal") : await commentAsConsultant(rfi, text, name, "portal");
      if (!res.ok) {
        if (res.error === "not-open") return Response.json({ error: "This RFI already has an answer logged. Add a comment instead." }, { status: 409 });
        return Response.json({ error: "This RFI is closed - nothing further is needed." }, { status: 409 });
      }
      const fresh = await sentRfiById(id);
      return Response.json({ ok: true, view: fresh ? await rfiThreadView(fresh) : null });
    }
    if (kind === "fix") {
      const t = String(body.table ?? "item");
      const table = t === "flag" ? "flag" : t === "check" ? "check" : "item";
      const found = await defectForEmail(table, id, who.emails, "sub");
      if (!found) return Response.json({ error: "Not found" }, { status: 404 });
      const photoPath = typeof body.photoPath === "string" ? body.photoPath : null;
      const res = await markReadyRow(found, { photoBlobPath: photoPath, note: text });
      if (!res.ok) return Response.json({ error: "This item has already been marked fixed." }, { status: 409 });
      const again = await defectForEmail(table, id, who.emails, "sub");
      return Response.json({ ok: true, view: again ? await fixView(again) : null });
    }
    if (kind === "signoff") {
      const found = await defectForEmail("item", id, who.emails, "consultant");
      if (!found || found.kind !== "item") return Response.json({ error: "Not found" }, { status: 404 });
      const decision = String(body.decision ?? "");
      if (decision !== "approve" && decision !== "reject") return Response.json({ error: "Unknown decision" }, { status: 400 });
      if (decision === "reject" && !text) return Response.json({ error: "Add a note so the sub knows what to put right." }, { status: 400 });
      const res = await signoffRow(found.row, { approve: decision === "approve", note: text });
      if (!res.ok) return Response.json({ error: "This item has already been actioned." }, { status: 409 });
      const again = await defectForEmail("item", id, who.emails, "consultant");
      return Response.json({ ok: true, approved: res.approved, view: again && again.kind === "item" ? await signoffView(again.row) : null });
    }
    if (kind === "corr") {
      const row = await corrForEmail(id, who.emails);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const prefix = `${row.projectId}/correspondence/${row.id}/`;
      const files: CorrAttachment[] = Array.isArray(body.files)
        ? body.files
            .map((f) => ({
              filename: String((f as Record<string, unknown>)?.filename ?? "").slice(0, 160),
              path: String((f as Record<string, unknown>)?.path ?? ""),
              bytes: Math.max(0, Math.floor(Number((f as Record<string, unknown>)?.bytes ?? 0))),
              contentType: String((f as Record<string, unknown>)?.contentType ?? "application/octet-stream").slice(0, 120),
            }))
            .filter((f) => f.path.startsWith(prefix) && f.filename)
            .slice(0, 10)
        : [];
      if (!text && !files.length) return Response.json({ error: "Write the reply first." }, { status: 400 });
      const res = await replyAsExternal(row, text, { name, email: who.emails.find((e) => (row.toEmail ?? "") === e) ?? who.emails[0] }, "portal", files);
      if (!res.ok) return Response.json({ error: "This item is closed - nothing further is needed." }, { status: 409 });
      const again = await corrForEmail(id, who.emails);
      return Response.json({ ok: true, view: again ? await corrView(again) : null });
    }
    return Response.json({ error: "Unknown kind" }, { status: 400 });
  } catch (e) {
    console.error("portal POST failed:", e);
    return Response.json({ error: "That didn't go through. Try again in a moment." }, { status: 500 });
  }
}
