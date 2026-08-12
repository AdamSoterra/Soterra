// Idempotent migration: the RFI system (Feature 5) — rfis, thread messages,
// the immutable transition audit, and contract instructions.
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-rfis.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS rfis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  project_id text NOT NULL,
  number integer,
  revision integer NOT NULL DEFAULT 0,
  subject text NOT NULL,
  discipline text,
  status text NOT NULL DEFAULT 'draft',
  ball_party text NOT NULL DEFAULT 'us',
  priority text NOT NULL DEFAULT 'normal',
  location text,
  question text NOT NULL,
  proposed_solution text,
  code_refs text,
  attachments text,
  cost_impact text NOT NULL DEFAULT 'unknown',
  cost_estimate text,
  programme_impact text NOT NULL DEFAULT 'unknown',
  programme_days integer,
  critical_path boolean NOT NULL DEFAULT false,
  raised_by text,
  raised_by_name text,
  consultant_name text,
  consultant_company text,
  consultant_email text,
  cc text,
  date_raised timestamptz,
  date_required_by timestamptz,
  date_answered timestamptz,
  date_closed timestamptz,
  resulting_ci_id uuid,
  email_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS rfis_project_idx ON rfis(project_id)`;
await sql`CREATE INDEX IF NOT EXISTS rfis_company_idx ON rfis(company_id)`;
await sql`CREATE INDEX IF NOT EXISTS rfis_project_number_idx ON rfis(project_id, number)`;

await sql`CREATE TABLE IF NOT EXISTS rfi_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  project_id text NOT NULL,
  rfi_id uuid NOT NULL,
  type text NOT NULL,
  author_side text NOT NULL DEFAULT 'contractor',
  author_name text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS rfi_messages_rfi_idx ON rfi_messages(rfi_id)`;

await sql`CREATE TABLE IF NOT EXISTS rfi_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  project_id text NOT NULL,
  rfi_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  ball_from text,
  ball_to text,
  by_user text,
  by_name text,
  comment text,
  at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS rfi_transitions_rfi_idx ON rfi_transitions(rfi_id)`;

await sql`CREATE TABLE IF NOT EXISTS contract_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  source_rfi_id uuid,
  amends_drawings text,
  cost text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS cis_project_idx ON contract_instructions(project_id)`;

for (const t of ["rfis", "rfi_messages", "rfi_transitions", "contract_instructions"]) {
  const r = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = ${t}`;
  console.log(`${t} present:`, r.length === 1);
}
console.log("Migration complete ✅");
