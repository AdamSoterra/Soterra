// Idempotent migration: free look-around trial - per-user lifetime question
// counter + the leads a walled trial user leaves behind.
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-trial.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS trial_usage (
  user_id text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

await sql`CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  email text NOT NULL,
  name text,
  company text,
  source text NOT NULL DEFAULT 'trial_wall',
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS leads_user_idx ON leads(user_id)`;

const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_name IN ('trial_usage','leads')`;
console.log("tables present:", t.map((r) => r.table_name).join(", "));
console.log("Migration complete ✅");
