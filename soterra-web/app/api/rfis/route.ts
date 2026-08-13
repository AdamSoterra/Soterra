import { auth, currentUser } from "@clerk/nextjs/server";
import { resolveScope } from "@/lib/company";
import {
  DISCIPLINES,
  addFollowup,
  createCi,
  createDraft,
  getRfi,
  listRfis,
  logAnswer,
  rfiAnalytics,
  sendRfi,
  setRfiStatus,
  updateRfiImpact,
} from "@/lib/rfi";

export const runtime = "nodejs";
// Sending renders drawing snapshots; give it room.
export const maxDuration = 300;

type Clerkish = { firstName?: string | null; username?: string | null; primaryEmailAddress?: { emailAddress?: string } | null } | null;
const displayName = (u: Clerkish) => u?.firstName || u?.username || u?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/rfis                → the register (+ analytics when ?analytics=1)
// GET /api/rfis?id=<uuid>      → one RFI: thread, transitions, pins, CI
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    if (!UUID_RE.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
    const full = await getRfi(scope, id);
    if (!full) return Response.json({ error: "RFI not found" }, { status: 404 });
    return Response.json(full);
  }
  if (url.searchParams.get("analytics") === "1") {
    return Response.json(await rfiAnalytics(scope));
  }
  return Response.json({ rfis: await listRfis(scope), disciplines: DISCIPLINES });
}

// POST /api/rfis → create a draft (no number burned)
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

  const subject = String(body.subject ?? "").trim();
  const question = String(body.question ?? "").trim();
  if (!subject) return Response.json({ error: "Give the RFI a subject" }, { status: 400 });
  if (!question) return Response.json({ error: "Write the question" }, { status: 400 });

  const asStrArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 10) : [];
  const user = await currentUser();
  const discipline = String(body.discipline ?? "").trim();
  const priority = ["normal", "high", "critical"].includes(String(body.priority)) ? (String(body.priority) as "normal" | "high" | "critical") : "normal";
  const impact = (v: unknown): "none" | "unknown" | "yes" => (["none", "unknown", "yes"].includes(String(v)) ? (String(v) as "none" | "unknown" | "yes") : "unknown");

  const requiredByRaw = String(body.requiredBy ?? "").trim();
  const requiredBy = requiredByRaw && !Number.isNaN(Date.parse(requiredByRaw)) ? new Date(requiredByRaw) : null;

  const rfi = await createDraft(scope, {
    subject,
    question,
    discipline: (DISCIPLINES as readonly string[]).includes(discipline) ? discipline : null,
    priority,
    location: String(body.location ?? "").trim() || null,
    proposedSolution: String(body.proposedSolution ?? "").trim() || null,
    codeRefs: asStrArray(body.codeRefs),
    consultantName: String(body.consultantName ?? "").trim() || null,
    consultantCompany: String(body.consultantCompany ?? "").trim() || null,
    consultantEmail: String(body.consultantEmail ?? "").trim() || null,
    cc: asStrArray(body.cc),
    costImpact: impact(body.costImpact),
    costEstimate: String(body.costEstimate ?? "").trim() || null,
    programmeImpact: impact(body.programmeImpact),
    programmeDays: Number.isInteger(Number(body.programmeDays)) && Number(body.programmeDays) > 0 ? Number(body.programmeDays) : null,
    criticalPath: body.criticalPath === true,
    requiredBy,
    raisedByName: displayName(user),
  });
  return Response.json({ rfi }, { status: 201 });
}

// PATCH /api/rfis — the lifecycle. { id, action, ... }
//   action: "send" | "log_answer" (body) | "followup" (body, bounce?) |
//           "close" | "reopen" | "void" | "create_ci" (title, amendsDrawings?, cost?)
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
  const action = String(body.action ?? "");
  const user = await currentUser();
  const by = {
    userId,
    name: displayName(user),
    email: user?.primaryEmailAddress?.emailAddress || null,
  };

  try {
    if (action === "send") {
      const { rfi, emailStatus } = await sendRfi(scope, id, by);
      return Response.json({ rfi, emailStatus });
    }
    if (action === "log_answer") {
      const text = String(body.body ?? "").trim();
      if (!text) return Response.json({ error: "Paste the consultant's answer" }, { status: 400 });
      const rfi = await logAnswer(scope, id, text, { ...by, consultantName: String(body.consultantName ?? "").trim() || null });
      return Response.json({ rfi });
    }
    if (action === "followup") {
      const text = String(body.body ?? "").trim();
      if (!text) return Response.json({ error: "Write the follow-up" }, { status: 400 });
      const rfi = await addFollowup(scope, id, text, by, { bounce: body.bounce === true });
      return Response.json({ rfi });
    }
    if (action === "close" || action === "void") {
      const rfi = await setRfiStatus(scope, id, action === "close" ? "closed" : "void", by, String(body.comment ?? "").trim() || undefined);
      return Response.json({ rfi });
    }
    if (action === "reopen") {
      const rfi = await setRfiStatus(scope, id, "open", by, String(body.comment ?? "").trim() || "reopened");
      return Response.json({ rfi });
    }
    if (action === "update_impact") {
      const impact = (v: unknown): "none" | "unknown" | "yes" | undefined =>
        ["none", "unknown", "yes"].includes(String(v)) ? (String(v) as "none" | "unknown" | "yes") : undefined;
      const rfi = await updateRfiImpact(scope, id, {
        criticalPath: body.criticalPath === undefined ? undefined : body.criticalPath === true,
        costImpact: impact(body.costImpact),
        costEstimate: body.costEstimate === undefined ? undefined : String(body.costEstimate ?? ""),
        programmeImpact: impact(body.programmeImpact),
        programmeDays:
          body.programmeDays === undefined
            ? undefined
            : Number.isInteger(Number(body.programmeDays)) && Number(body.programmeDays) > 0
              ? Number(body.programmeDays)
              : null,
      });
      return Response.json({ rfi });
    }
    if (action === "create_ci") {
      const title = String(body.title ?? "").trim();
      if (!title) return Response.json({ error: "Give the CI a title" }, { status: 400 });
      const amends = Array.isArray(body.amendsDrawings)
        ? body.amendsDrawings
            .map((d) => ({
              doc: String((d as Record<string, unknown>)?.doc ?? "").trim(),
              fromRev: String((d as Record<string, unknown>)?.fromRev ?? "").trim() || undefined,
              toRev: String((d as Record<string, unknown>)?.toRev ?? "").trim() || undefined,
            }))
            .filter((d) => d.doc)
            .slice(0, 10)
        : [];
      const ci = await createCi(scope, id, { title, amendsDrawings: amends, cost: String(body.cost ?? "").trim() || null }, by);
      return Response.json({ ci });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "That didn't work" }, { status: 400 });
  }
}
