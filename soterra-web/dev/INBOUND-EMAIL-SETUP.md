# Inbound email (plain replies land in the thread) — setup

Built 2026-09-09. The code is live and self-activating; three outside steps
remain, all in dashboards Adam owns. Nothing changes for senders until every
step is done — until then every external email keeps the sender's own inbox
as its Reply-To, exactly as before.

## What it does once live

Every external email (RFI, defect fix, sign-off, correspondence) is sent with
`Reply-To: <kind>-<token>@reply.soterra.co.nz`. Resend receives the reply on
that domain and calls `POST /api/email/inbound`. Soterra verifies the
signature, pulls the email + attachments, matches the token to the item and:

- RFI → consultant note in the thread (the site team can promote it to the
  official answer with one click), sender notified
- Correspondence → reply in the thread, status → responded, sender notified
- Defect (fix / sign-off links) → logged in `inbound_emails`, passed on to
  the other side by email

Every arrival is in `inbound_emails` (unique on Resend's email id).

## The three steps

1. **Resend → Domains → Add domain** `reply.soterra.co.nz`, region as the
   sending domain. Enable **Receiving** on it (sending can stay off). Resend
   shows one **MX record** for receiving. Add that MX record at the DNS host
   for soterra.co.nz (the nameservers are ns1/ns2.secureparkme.com — the
   registrar's DNS panel), host `reply`, the value + priority Resend shows.
   soterra.co.nz's own MX (Microsoft 365) is untouched: the subdomain has its
   own MX.

2. **Resend → Webhooks → Add**: endpoint `https://soterra.co.nz/api/email/inbound`,
   event `email.received`. Copy the **signing secret** (`whsec_…`).

3. **Resend → API keys**: the key in production (`RESEND_API_KEY`) is
   *sending-only*, and reading received mail needs full access. Create a
   full-access key.

Then set, in Vercel (project soterra-web → Settings → Environment variables)
and redeploy:

```
EMAIL_INBOUND_DOMAIN=reply.soterra.co.nz
RESEND_WEBHOOK_SECRET=whsec_…
RESEND_INBOUND_API_KEY=re_…
```

OR, without a redeploy, the same three as rows in the `app_settings` table
(keys `inbound_domain`, `resend_webhook_secret`, `resend_inbound_api_key`) —
`lib/settings.ts` reads env first, then the table. A dev script can write
them: `setSetting(key, value)`.

## Self-activation

`lib/inboundAddress.ts` only uses the domain for Reply-To once DNS actually
shows an MX record for it (checked with `dns.resolveMx`, cached 10 min per
warm server). So the env/setting can be set before DNS propagates; replies
start routing through Soterra the moment the MX is visible.

Check the state any time: `GET https://soterra.co.nz/api/email/inbound` →
`{ inboundDomain, mxLive, webhookConfigured, live }`.

## Testing without Resend

`dev/` scripts can call `handleInbound(parsed)` in `lib/inbound.ts` directly
with a hand-built `ParsedInbound` (from, recipients incl. a reply address,
text) — it is pure of Resend; only `fetchReceivedEmail` talks to their API.
