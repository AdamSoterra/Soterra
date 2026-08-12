// Idempotent migration: outbound email log (Foundation 1 — email sending).
// Every email Soterra sends is recorded here BEFORE transmission; analytics
// and the EOT pack read this table, never the provider.
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-email-log.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  project_id text NOT NULL,
  kind text NOT NULL,
  record_type text,
  record_ids text,
  to_name text,
  to_email text NOT NULL,
  cc text,
  from_email text NOT NULL,
  reply_to text,
  subject text NOT NULL,
  html text NOT NULL,
  attachments text,
  status text NOT NULL DEFAULT 'recorded',
  provider_id text,
  error text,
  sent_by text,
  sent_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
)`;
// Table may pre-date the attachments column (added by review finding).
await sql`ALTER TABLE email_log ADD COLUMN IF NOT EXISTS attachments text`;
await sql`CREATE INDEX IF NOT EXISTS email_log_project_idx ON email_log(project_id)`;
await sql`CREATE INDEX IF NOT EXISTS email_log_company_idx ON email_log(company_id)`;

const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'email_log'`;
console.log("email_log present:", t.length === 1);
console.log("Migration complete ✅");
