// Idempotent migration: plan pins (Foundation 2 — x,y markers on drawings,
// tied to the record they annotate: QA flag / RFI / checklist item).
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-plan-pins.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS plan_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  project_id text NOT NULL,
  doc text NOT NULL,
  page integer NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  record_type text NOT NULL,
  record_id text NOT NULL,
  label text,
  created_by text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS plan_pins_sheet_idx ON plan_pins(project_id, doc, page)`;
await sql`CREATE INDEX IF NOT EXISTS plan_pins_record_idx ON plan_pins(record_type, record_id)`;
await sql`CREATE INDEX IF NOT EXISTS plan_pins_company_idx ON plan_pins(company_id)`;

const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'plan_pins'`;
console.log("plan_pins present:", t.length === 1);
console.log("Migration complete ✅");
