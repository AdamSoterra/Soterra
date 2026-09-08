import { fetchReceivedEmail, handleInbound, verifySvix, webhookSecret } from "@/lib/inbound";
import { configuredInboundDomain, domainHasMx } from "@/lib/inboundAddress";

// Resend → Soterra: an email arrived on the inbound domain.
//
//   POST /api/email/inbound   the `email.received` webhook (Svix-signed)
//   GET  /api/email/inbound   a health line: is inbound configured?
//
// The body is verified BEFORE it is parsed (raw bytes, exact), then the full
// email is pulled from Resend and dispatched by lib/inbound.ts. Every path
// answers 200 once the event is authentic: a non-200 makes Resend retry, and a
// retry of an email we could not match would just be unmatched again.
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const domain = await configuredInboundDomain();
  const secret = await webhookSecret();
  const mxLive = domain ? await domainHasMx(domain) : false;
  return Response.json(
    { ok: true, inboundDomain: domain, mxLive, webhookConfigured: !!secret, live: !!domain && mxLive && !!secret },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = await webhookSecret();
  if (!secret) return Response.json({ error: "Inbound is not configured" }, { status: 503 });
  const ok = verifySvix(
    raw,
    { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") },
    secret
  );
  if (!ok) return Response.json({ error: "Bad signature" }, { status: 401 });

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (event.type !== "email.received" || !event.data?.email_id) {
    return Response.json({ ok: true, ignored: event.type ?? "unknown" });
  }
  try {
    const parsed = await fetchReceivedEmail(event.data.email_id);
    const result = await handleInbound(parsed);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("inbound webhook failed:", e);
    // 500 → Resend retries with backoff; the id-level dedupe makes that safe.
    return Response.json({ error: "Could not process the email" }, { status: 500 });
  }
}
