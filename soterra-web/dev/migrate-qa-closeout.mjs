// The QA close-out loop columns on qa_flags and inspection_items. A defect goes
// open -> sent (emailed to the sub with a "Mark it fixed" link) -> ready (sub
// attached a photo) -> then either the MC closes it (internal) or forwards it to
// a consultant to sign off (submitted -> closed). The sub_token / consultant_token
// are the link secrets; holding one proves you were sent that exact defect, which
// is the whole authorisation for the public /fix and /signoff pages.
//
// The legacy qa_flags.status and inspection_items.work_status columns are left
// untouched for the existing screens; closeout_status is the loop's own track.
//
// Idempotent (ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS). Safe to
// re-run. Mirrors dev/migrate-rfi-answer-token.mjs.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

// ── qa_flags (internal defects: no consultant leg) ──
await sql(`ALTER TABLE qa_flags ADD COLUMN IF NOT EXISTS closeout_status text NOT NULL DEFAULT 'open'`);
await sql(`ALTER TABLE qa_flags ADD COLUMN IF NOT EXISTS sub_token text`);
await sql(`ALTER TABLE qa_flags ADD COLUMN IF NOT EXISTS sender_email text`);
await sql(`ALTER TABLE qa_flags ADD COLUMN IF NOT EXISTS ready_at timestamptz`);
await sql(`ALTER TABLE qa_flags ADD COLUMN IF NOT EXISTS closed_at timestamptz`);
await sql(`ALTER TABLE qa_flags ADD COLUMN IF NOT EXISTS fix_photo text`);
await sql(`ALTER TABLE qa_flags ADD COLUMN IF NOT EXISTS sub_note text`);
await sql(`ALTER TABLE qa_flags ADD COLUMN IF NOT EXISTS review_note text`);
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS qa_flags_sub_token_idx ON qa_flags (sub_token) WHERE sub_token IS NOT NULL`);

// ── inspection_items (internal loop PLUS the consultant leg) ──
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS closeout_status text NOT NULL DEFAULT 'open'`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS sub_token text`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS consultant_token text`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS sender_email text`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS consultant_name text`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS consultant_email text`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS ready_at timestamptz`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS submitted_at timestamptz`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS closed_at timestamptz`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS fix_photo text`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS sub_note text`);
await sql(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS review_note text`);
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS inspection_items_sub_token_idx ON inspection_items (sub_token) WHERE sub_token IS NOT NULL`);
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS inspection_items_consultant_token_idx ON inspection_items (consultant_token) WHERE consultant_token IS NOT NULL`);

const flagCols = await sql(`select column_name from information_schema.columns where table_name='qa_flags'`);
const itemCols = await sql(`select column_name from information_schema.columns where table_name='inspection_items'`);
console.log("qa_flags columns:", flagCols.map((c) => c.column_name).join(", "));
console.log("inspection_items columns:", itemCols.map((c) => c.column_name).join(", "));
console.log("migration OK");
