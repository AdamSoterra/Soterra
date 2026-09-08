// ─── Reply addresses: the per-item mailbox a plain email reply lands in ──
//
// When inbound capture is configured (an MX record on the inbound domain
// pointing at Resend, and the domain set in EMAIL_INBOUND_DOMAIN or the
// app_settings row "inbound_domain"), every outbound external email is stamped
// with a Reply-To of the form
//
//     <kind>-<token>@reply.soterra.co.nz
//
// where <token> is the item's own link secret (the same one in the emailed
// button) and <kind> says which table to look in:
//
//     rfi  → rfis.answer_token             (consultant's RFI answer link)
//     cor  → correspondence.token          (the recipient's "Open in Soterra")
//     fix  → sub_token on qa_flags / inspection_items   (the sub's fix link)
//     so   → inspection_items.consultant_token          (consultant sign-off)
//
// Holding the token = being the person we emailed, so a reply to that address
// is authorised the same way a click on the link is. With no inbound domain
// set, nothing changes: Reply-To stays the sender's own inbox, exactly as
// before (lib/email.ts header note).
//
// Kept free of any DB table imports so lib/rfi.ts, lib/correspondence.ts and
// lib/qaCloseout.ts can all use it without a circular import.

import { promises as dns } from "node:dns";
import { getSetting } from "./settings";

export const INBOUND_KINDS = ["rfi", "cor", "fix", "so"] as const;
export type InboundKind = (typeof INBOUND_KINDS)[number];

const TOKEN_RE = "[A-Za-z0-9_-]{20,64}";
const ADDR_RE = new RegExp(`^(rfi|cor|fix|so)-(${TOKEN_RE})@([^@\\s>]+)$`, "i");

/** The inbound domain as CONFIGURED (setting or env), whether or not DNS is
 *  ready for it. inboundDomain() below is the live one. */
export async function configuredInboundDomain(): Promise<string | null> {
  const d = await getSetting("inbound_domain", "EMAIL_INBOUND_DOMAIN");
  return d ? d.toLowerCase().replace(/^@/, "") : null;
}

// SELF-ACTIVATING. A Reply-To on the inbound domain is only safe once that
// domain's MX record points at the mail receiver — before that every reply
// would bounce, which is worse than today's "goes to the sender's inbox".
// So the domain counts as live only when DNS actually shows an MX record for
// it. The check is cached per warm server for ten minutes: DNS changes once,
// not per request. A resolver failure (no network, transient) reads as "not
// live" and the sender's inbox stays the Reply-To - the safe side.
const mxCache = new Map<string, { live: boolean; at: number }>();
const MX_TTL_MS = 10 * 60_000;

export async function domainHasMx(domain: string): Promise<boolean> {
  const hit = mxCache.get(domain);
  if (hit && Date.now() - hit.at < MX_TTL_MS) return hit.live;
  let live = false;
  try {
    const records = await dns.resolveMx(domain);
    live = records.length > 0;
  } catch {
    live = false;
  }
  mxCache.set(domain, { live, at: Date.now() });
  return live;
}

/** The inbound domain, or null when replies should go to the sender's inbox
 *  (not configured, or configured but its MX record is not in DNS yet). */
export async function inboundDomain(): Promise<string | null> {
  const d = await configuredInboundDomain();
  if (!d) return null;
  return (await domainHasMx(d)) ? d : null;
}

export async function inboundEnabled(): Promise<boolean> {
  return !!(await inboundDomain());
}

/** The Reply-To for one item, or null when inbound is off. */
export async function replyAddress(kind: InboundKind, token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  const domain = await inboundDomain();
  return domain ? `${kind}-${token}@${domain}` : null;
}

/** "rfi-abc…@reply.soterra.co.nz" → { kind, token, domain }; anything else → null.
 *  Accepts a bare address or a "Name <address>" form. */
export function parseReplyAddress(raw: string): { kind: InboundKind; token: string; domain: string } | null {
  const m = raw.match(/<([^>]+)>/);
  const addr = (m ? m[1] : raw).trim().toLowerCase();
  const hit = addr.match(ADDR_RE);
  if (!hit) return null;
  return { kind: hit[1] as InboundKind, token: hit[2], domain: hit[3] };
}

/** Bare lowercase address out of "Name <addr>" / "addr". */
export function bareAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

/** Display name out of "Name <addr>", else the part before @. */
export function displayNameOf(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = raw.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  if (m && m[1].trim()) return m[1].trim();
  const bare = bareAddress(raw);
  return bare.split("@")[0] || bare;
}
