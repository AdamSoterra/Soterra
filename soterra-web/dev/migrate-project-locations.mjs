// Idempotent migration: per-project QA-location cache (Foundation 3).
// Extraction runs at ingest; the picker reads this table, never the model.
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-project-locations.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS project_locations (
  project_id text PRIMARY KEY,
  fingerprint text NOT NULL,
  locations text NOT NULL,
  user_zones text,
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'project_locations'`;
console.log("project_locations present:", t.length === 1);
console.log("Migration complete ✅");
