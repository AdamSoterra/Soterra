// Idempotent migration: per-project extracted plan/spec page index.
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-plan-pages.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS plan_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  doc text NOT NULL,
  file text,
  page integer NOT NULL,
  npages integer NOT NULL,
  code text,
  title text,
  disc text,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS plan_pages_project_idx ON plan_pages(project_id)`;

const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'plan_pages'`;
console.log("plan_pages present:", t.length === 1);
console.log("Migration complete ✅");
