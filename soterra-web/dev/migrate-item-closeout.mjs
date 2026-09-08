// Per-item send + close-out on QA CHECK items, and the client/contract
// instruction register (2026-09-09, Adam: "every qa item needs to be sendable
// and closable individually, both internal and external" + "a CI ... must be
// item number one on the generated related qa list").
//
//   checklist_items          — the close-out loop columns (mirror of qa_flags)
//   inspection_items / qa_flags — closed_by_name
//   contract_instructions    — the register fields + the attached document
//
// Idempotent (IF NOT EXISTS everywhere). Safe to re-run.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

for (const col of [
  "closeout_status text NOT NULL DEFAULT 'open'",
  "sub_token text",
  "sub_emails text",
  "sender_email text",
  "ready_at timestamptz",
  "closed_at timestamptz",
  "closed_by_name text",
  "fix_photo text",
  "sub_note text",
  "review_note text",
]) {
  await sql(`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS ${col}`);
}
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS checklist_items_sub_token_idx ON checklist_items (sub_token) WHERE sub_token IS NOT NULL`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS closed_by_name text`);
await sql(`ALTER TABLE qa_flags ADD COLUMN IF NOT EXISTS closed_by_name text`);

for (const col of [
  "body text",
  "issued_by text",
  "issued_by_name text",
  "date_issued timestamptz",
  "location text",
  "trades text",
  "status text NOT NULL DEFAULT 'open'",
  "file text",
  "file_name text",
  "file_text text",
  "created_by_name text",
  "updated_at timestamptz NOT NULL DEFAULT now()",
]) {
  await sql(`ALTER TABLE contract_instructions ADD COLUMN IF NOT EXISTS ${col}`);
}

for (const t of ["checklist_items", "contract_instructions"]) {
  const cols = await sql(`select column_name from information_schema.columns where table_name=$1 order by ordinal_position`, [t]);
  console.log(`${t}:`, cols.map((c) => c.column_name).join(", "));
}
console.log("migration OK");
