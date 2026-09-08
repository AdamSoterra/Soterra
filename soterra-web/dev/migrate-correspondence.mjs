// The external-parties build (2026-09-09): general correspondence register,
// inbound email capture, and the consultant/sub portal with password login.
//
//   correspondence + correspondence_messages  — the register next to RFIs
//   inbound_emails                            — every email that came back in
//   app_settings                              — runtime settings (webhook secret,
//                                               inbound domain) stored without a
//                                               redeploy
//   companies.external_login_required         — links open only for a signed-in
//                                               account with the matching email
//   inspection_items.sub_emails               — who a defect was sent to (the
//                                               portal matches on it)
//   rfi_messages.via                          — app | link | portal | email
//
// Idempotent (IF NOT EXISTS everywhere). Safe to re-run. Mirrors
// dev/migrate-qa-closeout.mjs.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

await sql(`CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
)`);

await sql(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS external_login_required boolean NOT NULL DEFAULT true`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS sub_emails text`);
await sql(`ALTER TABLE rfi_messages ADD COLUMN IF NOT EXISTS via text`);

await sql(`CREATE TABLE IF NOT EXISTS correspondence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  project_id text NOT NULL,
  type text NOT NULL DEFAULT 'general',
  number integer,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  response_required boolean NOT NULL DEFAULT false,
  date_due timestamptz,
  to_kind text,
  to_name text,
  to_company text,
  to_email text,
  cc text,
  attachments text,
  file_as_docs boolean NOT NULL DEFAULT false,
  doc_type text,
  created_by text,
  created_by_name text,
  sent_by text,
  sent_by_name text,
  sender_email text,
  date_sent timestamptz,
  date_responded timestamptz,
  date_closed timestamptz,
  email_log_id uuid,
  token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`);
await sql(`CREATE INDEX IF NOT EXISTS correspondence_project_idx ON correspondence (project_id)`);
await sql(`CREATE INDEX IF NOT EXISTS correspondence_company_idx ON correspondence (company_id)`);
await sql(`CREATE INDEX IF NOT EXISTS correspondence_to_email_idx ON correspondence (to_email)`);
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS correspondence_token_idx ON correspondence (token) WHERE token IS NOT NULL`);

await sql(`CREATE TABLE IF NOT EXISTS correspondence_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  project_id text NOT NULL,
  corr_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'message',
  author_side text NOT NULL DEFAULT 'contractor',
  author_name text,
  author_email text,
  via text,
  body text NOT NULL,
  attachments text,
  created_at timestamptz NOT NULL DEFAULT now()
)`);
await sql(`CREATE INDEX IF NOT EXISTS correspondence_messages_corr_idx ON correspondence_messages (corr_id)`);

await sql(`CREATE TABLE IF NOT EXISTS inbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text,
  project_id text,
  record_type text,
  record_id text,
  provider_id text NOT NULL,
  message_id text,
  from_email text,
  from_name text,
  to_address text,
  subject text,
  text text,
  attachments text,
  handled text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`);
await sql(`CREATE INDEX IF NOT EXISTS inbound_emails_record_idx ON inbound_emails (record_type, record_id)`);
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS inbound_emails_provider_uq ON inbound_emails (provider_id)`);

for (const t of ["correspondence", "correspondence_messages", "inbound_emails", "app_settings"]) {
  const cols = await sql(`select column_name from information_schema.columns where table_name=$1 order by ordinal_position`, [t]);
  console.log(`${t}:`, cols.map((c) => c.column_name).join(", "));
}
const co = await sql(`select column_name from information_schema.columns where table_name='companies'`);
console.log("companies:", co.map((c) => c.column_name).join(", "));
console.log("migration OK");
