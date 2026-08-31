import { auth, currentUser } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, trialUsage } from "@/lib/schema";
import { resendKey } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/leads   { email, name?, company? }
//
// The trial wall's "leave your email" form. Record-first: the lead row IS the
// record (one per user, latest details win); the email notification to Adam is
// best-effort on top. This deliberately does NOT go through lib/email.ts —
// that path is built around a verified company Scope and its audit log, and a
// lead has neither. A direct provider call with no attachments is the honest
// shape of "notify the founder".

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTIFY_TO = "adam@soterra.co.nz";
const SEND_DOMAIN = process.env.EMAIL_SEND_DOMAIN || "send.soterra.co.nz";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  const name = String(body.name ?? "").trim().slice(0, 120) || null;
  const company = String(body.company ?? "").trim().slice(0, 160) || null;
  if (!EMAIL_RE.test(email)) return Response.json({ error: "That doesn't look like an email address" }, { status: 400 });

  // Notify only on a NEW lead or a changed email — a signed-in user looping
  // this endpoint must not be able to flood the founder's inbox; the row
  // itself still updates every time.
  const [existing] = await db.select({ email: leads.email }).from(leads).where(sql`${leads.userId} = ${userId}`).limit(1);
  const shouldNotify = !existing || existing.email !== email;

  await db
    .insert(leads)
    .values({ userId, email, name, company, source: "trial_wall" })
    .onConflictDoUpdate({ target: leads.userId, set: { email, name, company } });

  // Best-effort instant heads-up. A notification failure must never lose the
  // lead — the row above is already committed.
  if (shouldNotify && process.env.RESEND_API_KEY && process.env.EMAIL_TRANSMIT?.trim() === "1") {
    try {
      const [u] = await db.select({ count: trialUsage.count }).from(trialUsage).where(sql`${trialUsage.userId} = ${userId}`).limit(1);
      const user = await currentUser().catch(() => null);
      const signupEmail = user?.primaryEmailAddress?.emailAddress || null;
      const lines = [
        `Someone finished the free trial and left their details.`,
        ``,
        `Email:   ${email}`,
        `Name:    ${name || "-"}`,
        `Company: ${company || "-"}`,
        `Signed up as: ${signupEmail || "-"}`,
        `Questions used: ${u?.count ?? "?"}`,
        ``,
        `Reply to them directly, or set them up with the access code.`,
      ];
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `Soterra <leads@${SEND_DOMAIN}>`,
          to: [NOTIFY_TO],
          reply_to: email,
          subject: `New Soterra lead: ${company || name || email}`,
          text: lines.join("\n"),
        }),
      });
    } catch (e) {
      console.error("lead notify failed (lead saved):", e);
    }
  }

  return Response.json({ ok: true });
}
