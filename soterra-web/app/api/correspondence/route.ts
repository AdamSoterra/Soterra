import { auth, currentUser } from "@clerk/nextjs/server";
import { sanitizeFiles } from "@/lib/attachments";
import { resolveScope } from "@/lib/company";
import {
  CORR_TYPES,
  addOurMessage,
  attachFiles,
  createDraft,
  fileAttachment,
  getCorrespondence,
  listCorrespondence,
  publicCorr,
  removeAttachment,
  sendCorrespondence,
  setCorrStatus,
  updateDraft,
  isCorrType,
  type CorrInput,
} from "@/lib/correspondence";
import { DOC_TYPES, type DocType } from "@/lib/docType";

export const runtime = "nodejs";
// Sending may file PDFs into Documents (text extraction) and attach files.
export const maxDuration = 300;

type Clerkish = { firstName?: string | null; username?: string | null; primaryEmailAddress?: { emailAddress?: string } | null } | null;
const displayName = (u: Clerkish) => u?.firstName || u?.username || u?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/correspondence            → the register
// GET /api/correspondence?id=<uuid>  → one item: thread + attachments
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!UUID_RE.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
    const full = await getCorrespondence(scope, id);
    if (!full) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(full);
  }
  return Response.json({ items: await listCorrespondence(scope), types: CORR_TYPES });
}

function readInput(body: Record<string, unknown>, partial: boolean): Partial<CorrInput> {
  const out: Partial<CorrInput> = {};
  const has = (k: string) => !partial || body[k] !== undefined;
  if (has("type")) out.type = isCorrType(body.type) ? body.type : "general";
  if (has("subject")) out.subject = String(body.subject ?? "");
  if (has("body")) out.body = String(body.body ?? "");
  if (has("responseRequired")) out.responseRequired = body.responseRequired === true;
  if (has("dateDue")) {
    const raw = String(body.dateDue ?? "").trim();
    out.dateDue = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : null;
  }
  if (has("toKind")) {
    const k = String(body.toKind ?? "");
    out.toKind = k === "consultant" || k === "sub" ? k : "other";
  }
  if (has("toName")) out.toName = String(body.toName ?? "");
  if (has("toCompany")) out.toCompany = String(body.toCompany ?? "");
  if (has("toEmail")) out.toEmail = String(body.toEmail ?? "");
  if (has("cc")) out.cc = Array.isArray(body.cc) ? body.cc.map((x) => String(x)) : String(body.cc ?? "").split(/[,;\s]+/);
  if (has("fileAsDocs")) out.fileAsDocs = body.fileAsDocs === true;
  if (has("docType")) {
    const d = String(body.docType ?? "");
    out.docType = (DOC_TYPES as readonly string[]).includes(d) ? (d as DocType) : null;
  }
  return out;
}

// POST /api/correspondence → create a draft
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
  const input = readInput(body, false) as CorrInput;
  if (!input.subject?.trim()) return Response.json({ error: "Give it a subject" }, { status: 400 });
  if (!input.body?.trim()) return Response.json({ error: "Write the message" }, { status: 400 });
  if (input.toEmail && !EMAIL_RE.test(input.toEmail.trim())) return Response.json({ error: "That email doesn't look right" }, { status: 400 });
  const user = await currentUser();
  // Files picked on the form before Save went to Blob under this site's
  // correspondence/ folder (the upload token signs only that).
  const staged = sanitizeFiles(body.attachments, [`${scope.projectId}/correspondence/`], 30);
  const row = await createDraft(scope, input, { userId, name: displayName(user) }, staged);
  return Response.json({ item: publicCorr(row) }, { status: 201 });
}

// PATCH /api/correspondence { id, action, ... }
//   action: "update" (draft fields) | "attach" (files[]) | "detach" (path) |
//           "send" | "message" (body, files?) | "close" | "reopen" | "void" |
//           "file_document" (path, docType)
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
  const by = { userId, name: displayName(user), email: user?.primaryEmailAddress?.emailAddress || null };
  const files = Array.isArray(body.files)
    ? body.files
        .map((f) => ({
          filename: String((f as Record<string, unknown>)?.filename ?? ""),
          path: String((f as Record<string, unknown>)?.path ?? ""),
          bytes: Number((f as Record<string, unknown>)?.bytes ?? 0),
          contentType: String((f as Record<string, unknown>)?.contentType ?? ""),
        }))
        .filter((f) => f.path && f.filename)
        .slice(0, 30)
    : [];

  try {
    if (action === "update") {
      const row = await updateDraft(scope, id, readInput(body, true));
      return Response.json({ item: publicCorr(row) });
    }
    if (action === "attach") {
      if (!files.length) return Response.json({ error: "No files" }, { status: 400 });
      const row = await attachFiles(scope, id, files);
      return Response.json({ item: publicCorr(row) });
    }
    if (action === "detach") {
      const row = await removeAttachment(scope, id, String(body.path ?? ""));
      return Response.json({ item: publicCorr(row) });
    }
    if (action === "send") {
      const { row, emailStatus } = await sendCorrespondence(scope, id, by);
      return Response.json({ item: publicCorr(row), emailStatus });
    }
    if (action === "message") {
      const text = String(body.body ?? "").trim();
      if (!text && !files.length) return Response.json({ error: "Write the message" }, { status: 400 });
      const msg = await addOurMessage(scope, id, text || "(attachment)", by, files);
      return Response.json({ message: msg });
    }
    if (action === "close" || action === "reopen" || action === "void") {
      const row = await setCorrStatus(scope, id, action === "close" ? "closed" : action === "reopen" ? "sent" : "void", by, String(body.note ?? "") || null);
      return Response.json({ item: publicCorr(row) });
    }
    if (action === "file_document") {
      const d = String(body.docType ?? "drawings");
      const docType = ((DOC_TYPES as readonly string[]).includes(d) ? d : "drawings") as DocType;
      const res = await fileAttachment(scope, id, String(body.path ?? ""), docType);
      return Response.json(res.ok ? { ok: true, doc: res.doc } : { error: "Couldn't read that PDF - it may be a scan (no text)." }, { status: res.ok ? 200 : 422 });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "That didn't work" }, { status: 400 });
  }
}
