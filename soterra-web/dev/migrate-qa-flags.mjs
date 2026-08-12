// Idempotent migration: QA flags (Feature 7 — pin a mistake on a drawing,
// email the sub, record it).
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-qa-flags.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS qa_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  project_id text NOT NULL,
  doc text NOT NULL,
  page integer NOT NULL,
  n integer NOT NULL,
  title text NOT NULL,
  trade text,
  note text,
  status text NOT NULL DEFAULT 'open',
  sub_name text,
  sub_email text,
  sent_at timestamptz,
  sent_status text,
  fixed_at timestamptz,
  created_by text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS qa_flags_sheet_idx ON qa_flags(project_id, doc, page)`;
await sql`CREATE INDEX IF NOT EXISTS qa_flags_company_idx ON qa_flags(company_id)`;

const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'qa_flags'`;
console.log("qa_flags present:", t.length === 1);
console.log("Migration complete ✅");
