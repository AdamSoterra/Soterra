// Create the consultants table - the RFI half of the address book. Company-
// wide, saved automatically on every RFI send, editable in the Directory.
// Idempotent.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

await sql(`CREATE TABLE IF NOT EXISTS consultants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  name text,
  company text,
  discipline text,
  email text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
)`);
await sql(`CREATE INDEX IF NOT EXISTS consultants_company_idx ON consultants (company_id)`);

// One row per consultant per company, case-insensitively. Emails are stored
// lowercased by every writer; normalise + dedupe anything older first (keep
// the earliest row) so the unique index can always be created.
await sql(`UPDATE consultants SET email = lower(email) WHERE email <> lower(email)`);
await sql(`DELETE FROM consultants a USING consultants b
  WHERE a.company_id = b.company_id AND a.email = b.email AND a.created_at > b.created_at`);
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS consultants_company_email_uq ON consultants (company_id, email)`);

const cols = await sql(`select column_name from information_schema.columns where table_name='consultants'`);
console.log("consultants columns:", cols.map((c) => c.column_name).join(", "));
const idx = await sql(`select indexname from pg_indexes where tablename='consultants'`);
console.log("indexes:", idx.map((i) => i.indexname).join(", "));
console.log("migration OK");
