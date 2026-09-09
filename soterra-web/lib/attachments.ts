import { get } from "@vercel/blob";
import type { EmailAttachment } from "./email";

// ─── Attachments on a communication record (RFIs, and the same shape the
// correspondence register uses) ────────────────────────────────────────────
//
// Files are uploaded straight from the browser into the PRIVATE Blob store
// (/api/upload/token and the external-door variants sign the path); the
// record keeps a JSON list of {filename, path, bytes, contentType}. Reads go
// through a streaming route that checks the path is on THAT record's list,
// so a file is never reachable by URL alone.

export type Attachment = {
  filename: string;
  path: string; // private Blob pathname
  bytes: number;
  contentType: string;
  /** Set once a PDF was filed into Documents (correspondence transmittals). */
  filedAs?: { doc: string; docType: string } | null;
};

/** What every upload door accepts: drawings, photos, office documents, zips. */
export const FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "application/acad",
  "image/vnd.dwg",
  "application/octet-stream",
];
export const MAX_FILE_BYTES = 100 * 1024 * 1024; // a drawing set

/** Email attachments ride along up to this much in total; the rest are
 *  "download from the page". Resend caps a message at 40 MB; 10 keeps the
 *  email itself deliverable through corporate gateways. */
export const EMAIL_ATTACH_BUDGET = 10 * 1024 * 1024;

export function parseAttachments(json: string | null | undefined): Attachment[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as Attachment[]).filter((a) => a && typeof a.path === "string") : [];
  } catch {
    return [];
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** A request body's file list, kept only where the path sits under one of
 *  the allowed prefixes (the record's own folder) - anything else is dropped,
 *  never errored, so a stale client can't block the message itself. */
export function sanitizeFiles(input: unknown, prefixes: string[], max = 10): Attachment[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((f) => {
      const r = (f ?? {}) as Record<string, unknown>;
      return {
        filename: String(r.filename ?? "").trim().slice(0, 160),
        path: String(r.path ?? ""),
        bytes: Math.max(0, Math.floor(Number(r.bytes ?? 0)) || 0),
        contentType: String(r.contentType ?? "application/octet-stream").slice(0, 120),
      };
    })
    .filter((f) => f.filename && f.path && prefixes.some((p) => f.path.startsWith(p)))
    .slice(0, max);
}

/** "2 attachments: A-201 Rev C.pdf · photo.jpg" - for notices. */
export function attachmentsLine(atts: { filename: string }[]): string | null {
  if (!atts.length) return null;
  return `${atts.length} attachment${atts.length === 1 ? "" : "s"}: ${atts.map((a) => a.filename).join(" · ")}`;
}

export async function readPrivateBlob(path: string): Promise<Buffer | null> {
  try {
    const got = await get(path, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return null;
    return Buffer.from(await new Response(got.stream).arrayBuffer());
  } catch (e) {
    console.error("blob read failed:", path, e);
    return null;
  }
}

/** Pack a record's files into an email while the budget lasts (small first,
 *  so the most files make it in); the rest are listed as "download from the
 *  page". `alreadyUsed` = bytes other attachments on the same email take. */
export async function packForEmail(
  atts: Attachment[],
  alreadyUsed = 0
): Promise<{ attachments: EmailAttachment[]; listed: { filename: string; attached: boolean; bytesLabel: string }[] }> {
  const attachments: EmailAttachment[] = [];
  const listed: { filename: string; attached: boolean; bytesLabel: string }[] = [];
  let used = alreadyUsed;
  for (const a of [...atts].sort((x, y) => x.bytes - y.bytes)) {
    let attached = false;
    if (a.bytes > 0 && used + a.bytes <= EMAIL_ATTACH_BUDGET) {
      const buf = await readPrivateBlob(a.path);
      // The declared size came from the browser; the real one decides, so a
      // stale or low `bytes` can never push the message past the provider cap.
      if (buf && used + buf.length <= EMAIL_ATTACH_BUDGET) {
        attachments.push({ filename: a.filename, content: buf.toString("base64") });
        used += buf.length;
        attached = true;
      }
    }
    listed.push({ filename: a.filename, attached, bytesLabel: formatBytes(a.bytes) });
  }
  listed.sort((x, y) => x.filename.localeCompare(y.filename));
  return { attachments, listed };
}
