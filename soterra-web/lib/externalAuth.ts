// ─── The sign-in gate on external links ──────────────────────────────────
//
// Every private link Soterra emails out (RFI answer, defect fix, sign-off,
// correspondence) is authorised by its token: holding it proves you were sent
// that exact item. That was the whole story until 2026-09-09, when Adam asked
// for passwords on all external parties: "these info can be sensitive so all
// parties need PW."
//
// So a company can require that a link opens ONLY for a signed-in Soterra
// account whose VERIFIED email is one the item was addressed to. The token
// still scopes what the page can reach; the account proves who is looking.
// companies.external_login_required is on by default; the Directory screen
// can switch it off for a company that wants the frictionless flow back.
//
// The verified-email check is the important bit: Clerk verifies an address at
// sign-up, and a forwarded link + a fresh account on some other address gets
// "mismatch", not access.

import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { companies } from "./schema";

export type ExternalGate =
  | { ok: true; userId: string | null; email: string | null; required: boolean }
  | { ok: false; reason: "login" | "mismatch"; required: true };

type ClerkUserLike = {
  id: string;
  emailAddresses?: { emailAddress: string; verification?: { status?: string | null } | null }[];
  primaryEmailAddress?: { emailAddress?: string } | null;
} | null;

/** One mailbox, one string: lowercased, and a "+tag" in the local part dropped
 *  (jane+kauri@firm.co.nz is jane@firm.co.nz for every major mail provider).
 *  Every match between "who is signed in" and "who the item went to" runs
 *  through this, so a consultant using a plus-tagged address still gets in. */
export function normalizeEmail(e: string): string {
  const s = e.trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at < 0) return s;
  const local = s.slice(0, at).replace(/\+.*$/, "");
  return `${local}${s.slice(at)}`;
}

/** The signed-in user's VERIFIED email addresses, normalized (see normalizeEmail). */
export function verifiedEmails(user: ClerkUserLike): string[] {
  if (!user) return [];
  const out = new Set<string>();
  for (const e of user.emailAddresses ?? []) {
    if (e.verification?.status === "verified" && e.emailAddress) out.add(normalizeEmail(e.emailAddress));
  }
  return [...out];
}

export async function companyRequiresLogin(companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ req: companies.externalLoginRequired })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  // Unknown company (should not happen) fails CLOSED: require the login.
  return row ? !!row.req : true;
}

/**
 * Gate an external, token-authorised request. `allowed` are the addresses the
 * item was sent to (any case, nulls tolerated). Returns ok when the company
 * does not require login, or when a signed-in account's verified email is in
 * the allowed set.
 */
export async function gateExternal(companyId: string, allowed: (string | null | undefined)[]): Promise<ExternalGate> {
  const required = await companyRequiresLogin(companyId);
  const { userId } = await auth();
  if (!required) return { ok: true, userId: userId ?? null, email: null, required: false };
  if (!userId) return { ok: false, reason: "login", required: true };
  const user = (await currentUser()) as ClerkUserLike;
  const mine = verifiedEmails(user);
  const want = new Set(allowed.filter((a): a is string => !!a).map(normalizeEmail));
  const match = mine.find((m) => want.has(m));
  if (!match) return { ok: false, reason: "mismatch", required: true };
  return { ok: true, userId, email: match, required: true };
}

/** The JSON the token routes return when the gate says no. The pages key off
 *  `loginRequired` (show the sign-in) vs `mismatch` (explain). */
export function gateResponse(g: Extract<ExternalGate, { ok: false }>): Response {
  if (g.reason === "login") {
    return Response.json(
      { error: "Sign in to open this.", loginRequired: true },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  return Response.json(
    {
      error: "This link was sent to a different email address. Sign in with the address the email was sent to.",
      mismatch: true,
    },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}
