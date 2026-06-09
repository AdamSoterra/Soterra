// One-off, idempotent migration to bring the live Neon DB in line with
// lib/schema.ts after the calendar/tasks punch-list:
//   - tasks.ends_at      (optional finish-by date+time)
//   - events.kind        becomes nullable + no default (type is now optional)
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-end-fields.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ends_at timestamptz`;
await sql`ALTER TABLE events ALTER COLUMN kind DROP NOT NULL`;
await sql`ALTER TABLE events ALTER COLUMN kind DROP DEFAULT`;

const cols = await sql`
  SELECT table_name, column_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE (table_name = 'tasks' AND column_name = 'ends_at')
     OR (table_name = 'events' AND column_name = 'kind')
  ORDER BY table_name, column_name`;
console.log("Schema now:", cols);
console.log("Migration complete ✅");
