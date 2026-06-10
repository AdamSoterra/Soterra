// Idempotent migration: create the assistant chat tables (saved conversations).
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-chat-threads.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  creator_id text NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS chat_threads_user_idx ON chat_threads(creator_id)`;

await sql`CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages(thread_id)`;

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_name IN ('chat_threads','chat_messages') ORDER BY table_name`;
console.log("Tables now:", tables.map((t) => t.table_name));
console.log("Migration complete ✅");
