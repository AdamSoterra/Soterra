import { auth, currentUser } from "@clerk/nextjs/server";
import { resolveScope } from "@/lib/company";
import {
  ISSUERS,
  attachInstructionFile,
  createInstruction,
  getInstruction,
  listInstructions,
  setInstructionStatus,
  updateInstruction,
  type CiInput,
  type Issuer,
} from "@/lib/instructions";
import { CATEGORIES } from "@/lib/categories";

export const runtime = "nodejs";
// Attaching a PDF extracts its text.
export const maxDuration = 120;

type Clerkish = { firstName?: string | null; username?: string | null; primaryEmailAddress?: { emailAddress?: string } | null } | null;
const displayName = (u: Clerkish) => u?.firstName || u?.username || u?.primaryEmailAddress?.emailAddress?.split("@")[0] || null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The client / contract instruction register.
//   GET   /api/instructions             → the register (+ categories, issuers)
//   GET   /api/instructions?id=…        → one instruction
//   POST  /api/instructions {…}         → raise one (number burned on creation)
//   PATCH /api/instructions {id, action, …}
//         action "update" (fields) | "status" (status) | "attach" (path, filename)

function readInput(body: Record<string, unknown>, partial: boolean): Partial<CiInput> {
  const out: Partial<CiInput> = {};
  const has = (k: string) => !partial || body[k] !== undefined;
  if (has("title")) out.title = String(body.title ?? "");
  if (has("body")) out.body = String(body.body ?? "");
  if (has("issuedBy")) {
    const v = String(body.issuedBy ?? "");
    out.issuedBy = (ISSUERS as readonly string[]).includes(v) ? (v as Issuer) : null;
  }
  if (has("issuedByName")) out.issuedByName = String(body.issuedByName ?? "");
  if (has("dateIssued")) {
    const raw = String(body.dateIssued ?? "").trim();
    out.dateIssued = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : null;
  }
  if (has("location")) out.location = String(body.location ?? "");
  if (has("trades")) out.trades = Array.isArray(body.trades) ? body.trades.map((t) => String(t)) : [];
  if (has("amendsDrawings")) {
    out.amendsDrawings = Array.isArray(body.amendsDrawings)
      ? body.amendsDrawings.map((d) => ({ doc: String((d as Record<string, unknown>)?.doc ?? ""), fromRev: String((d as Record<string, unknown>)?.fromRev ?? "") || undefined, toRev: String((d as Record<string, unknown>)?.toRev ?? "") || undefined }))
      : String(body.amendsDrawings ?? "").split(/[,;\n]+/).map((s) => ({ doc: s.trim() })).filter((d) => d.doc);
  }
  if (has("cost")) out.cost = String(body.cost ?? "");
  return out;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!UUID_RE.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
    const item = await getInstruction(scope, id);
    if (!item) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ item });
  }
  return Response.json({ items: await listInstructions(scope), categories: CATEGORIES, issuers: ISSUERS });
}

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
  const input = readInput(body, false) as CiInput;
  if (!input.title?.trim()) return Response.json({ error: "Give the instruction a title" }, { status: 400 });
  const user = await currentUser();
  const row = await createInstruction(scope, input, { userId, name: displayName(user) });
  return Response.json({ item: await getInstruction(scope, row.id) }, { status: 201 });
}

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
  const action = String(body.action ?? "update");
  try {
    if (action === "update") {
      await updateInstruction(scope, id, readInput(body, true));
    } else if (action === "status") {
      const s = String(body.status ?? "");
      if (s !== "open" && s !== "done" && s !== "void") return Response.json({ error: "Bad status" }, { status: 400 });
      await setInstructionStatus(scope, id, s);
    } else if (action === "attach") {
      const path = String(body.path ?? "");
      const filename = String(body.filename ?? "").trim() || "document";
      if (!path) return Response.json({ error: "No file" }, { status: 400 });
      await attachInstructionFile(scope, id, path, filename);
    } else {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }
    return Response.json({ item: await getInstruction(scope, id) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "That didn't work" }, { status: 400 });
  }
}
