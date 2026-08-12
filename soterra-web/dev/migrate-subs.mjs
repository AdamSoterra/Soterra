// Idempotent migration: subcontractor contacts + sent-to-sub stamps on
// checklist items (Feature 4 — send the Needs-fixing items to subs).
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-subs.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS subs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  trade text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS subs_company_idx ON subs(company_id)`;
await sql`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS sent_to text`;
await sql`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS sent_at timestamptz`;
await sql`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS sent_status text`;

const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'subs'`;
const c = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'checklist_items' AND column_name = 'sent_to'`;
console.log("subs present:", t.length === 1, "· checklist_items.sent_to present:", c.length === 1);
console.log("Migration complete ✅");
