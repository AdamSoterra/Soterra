import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { defectMessages } from "./schema";
import { parseAttachments, type Attachment } from "./attachments";

// ─── The thread on a QA defect ────────────────────────────────────────────
//
// Every defect (a QA flag, a failed report item, a Needs-fixing check item)
// carries one conversation: what was sent, what the sub said, marked fixed,
// bounced back, closed, signed off. The status columns on the row stay the
// LOCK (lib/qaCloseout.ts); these lines are the record of how it got there,
// shown on the sub's page and under the item on the builder's side.

export type DefectKind = "flag" | "item" | "check";
export type DefectMsgType = "sent" | "note" | "ready" | "bounced" | "closed" | "forwarded" | "signed_off" | "reopened";
export type DefectSide = "contractor" | "sub" | "consultant";

export type DefectMsg = {
  id: string;
  type: DefectMsgType | string;
  authorSide: DefectSide | string;
  authorName: string | null;
  via: string | null;
  body: string;
  attachments: Attachment[];
  createdAt: string;
};

export async function logDefect(
  row: { id: string; companyId: string; projectId: string },
  kind: DefectKind,
  line: { type: DefectMsgType; authorSide: DefectSide; authorName?: string | null; authorEmail?: string | null; via?: string | null; body: string; attachments?: Attachment[] }
): Promise<void> {
  try {
    await db.insert(defectMessages).values({
      companyId: row.companyId,
      projectId: row.projectId,
      kind,
      recordId: row.id,
      type: line.type,
      authorSide: line.authorSide,
      authorName: line.authorName?.trim().slice(0, 160) || null,
      authorEmail: line.authorEmail?.trim().toLowerCase().slice(0, 200) || null,
      via: line.via ?? "app",
      body: line.body.trim().slice(0, 8000) || "(no text)",
      attachments: line.attachments?.length ? JSON.stringify(line.attachments) : null,
    });
  } catch (e) {
    // The thread is the record, not the lock: a failed line must never fail the action.
    console.error("defect thread write failed:", e);
  }
}

export async function defectMessagesFor(kind: DefectKind, recordId: string): Promise<DefectMsg[]> {
  const rows = await db
    .select()
    .from(defectMessages)
    .where(and(eq(defectMessages.kind, kind), eq(defectMessages.recordId, recordId)))
    .orderBy(defectMessages.createdAt);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    authorSide: r.authorSide,
    authorName: r.authorName,
    via: r.via,
    body: r.body,
    attachments: parseAttachments(r.attachments),
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Where the files on a defect's thread live: namespaced by project + defect so
 *  one item's link can never write into (or later read) another's. The sub's
 *  "Mark it fixed" photo has its own folder (qa-fix/); email-reply files land
 *  under inbound/ - both are reachable only through defectPathBelongsTo. */
export function defectBlobPrefix(projectId: string, recordId: string): string {
  return `${projectId}/defects/${recordId}/`;
}

/** Is this blob path one of the files on THIS defect's thread? The streaming
 *  route asks before it serves anything - a path alone is never enough. */
export async function defectPathBelongsTo(kind: DefectKind, recordId: string, path: string): Promise<Attachment | null> {
  if (!path) return null;
  const rows = await db
    .select({ attachments: defectMessages.attachments })
    .from(defectMessages)
    .where(and(eq(defectMessages.kind, kind), eq(defectMessages.recordId, recordId)));
  for (const r of rows) {
    const hit = parseAttachments(r.attachments).find((a) => a.path === path);
    if (hit) return hit;
  }
  return null;
}

/** How many lines each of these defects has (for the builder's item list). */
export async function defectMessageCounts(kind: DefectKind, recordIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!recordIds.length) return out;
  const rows = await db
    .select({ recordId: defectMessages.recordId, n: sql<number>`count(*)::int` })
    .from(defectMessages)
    .where(and(eq(defectMessages.kind, kind), inArray(defectMessages.recordId, recordIds)))
    .groupBy(defectMessages.recordId);
  for (const r of rows) out.set(r.recordId, Number(r.n));
  return out;
}

/** The latest line on a defect, for a "last activity" glance. */
export async function lastDefectMessage(kind: DefectKind, recordId: string): Promise<DefectMsg | null> {
  const [r] = await db
    .select()
    .from(defectMessages)
    .where(and(eq(defectMessages.kind, kind), eq(defectMessages.recordId, recordId)))
    .orderBy(desc(defectMessages.createdAt))
    .limit(1);
  return r ? { id: r.id, type: r.type, authorSide: r.authorSide, authorName: r.authorName, via: r.via, body: r.body, attachments: parseAttachments(r.attachments), createdAt: r.createdAt.toISOString() } : null;
}
