// A thread on every QA defect (2026-09-10, Adam: "we did not build in any
// correspondence on what the thread would look like sending the items to the
// subs ... send them and answer comes back under the actual QA item").
//
// defect_messages: one line per thing that happened on a flag / report item /
// check item - sent to the sub, the sub's note, marked fixed, bounced back,
// closed, forwarded for sign-off, signed off, reopened, and plain notes either
// way (in-app or by email). The sub's page and the builder's item both render it.
//
// Idempotent. Safe to re-run:  node dev/migrate-defect-messages.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

await sql(`CREATE TABLE IF NOT EXISTS defect_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  project_id text NOT NULL,
  kind text NOT NULL,
  record_id uuid NOT NULL,
  type text NOT NULL,
  author_side text NOT NULL DEFAULT 'contractor',
  author_name text,
  author_email text,
  via text,
  body text NOT NULL,
  attachments text,
  created_at timestamptz NOT NULL DEFAULT now()
)`);
await sql(`CREATE INDEX IF NOT EXISTS defect_messages_record_idx ON defect_messages (kind, record_id)`);
await sql(`CREATE INDEX IF NOT EXISTS defect_messages_project_idx ON defect_messages (project_id)`);

const cols = await sql(`select column_name from information_schema.columns where table_name='defect_messages' order by ordinal_position`);
console.log("defect_messages:", cols.map((c) => c.column_name).join(", "));
console.log("migration OK");
