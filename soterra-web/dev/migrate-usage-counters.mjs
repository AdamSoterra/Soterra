// Idempotent migration: per-project daily assistant usage counter (cost cap).
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-usage-counters.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  day text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS usage_counters_project_day_idx ON usage_counters(project_id, day)`;

const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'usage_counters'`;
console.log("usage_counters present:", t.length === 1);
console.log("Migration complete ✅");
