// Idempotent migration: MBIE determinations as their own searchable corpus.
//
// Deliberately NOT in code_pages. Two reasons:
//  1. Retrieval. code_pages is loaded whole into memory and TF-IDF'd on every
//     warm server (~3,300 pages). Determinations add ~5,900 pages of discursive
//     legal prose, which would both triple that cost and drown the Building
//     Code's own wording in adjudication narrative.
//  2. Authority. A determination decides ONE case on ITS facts. It is guidance
//     about how the Code was applied, never the rule itself. Keeping it in a
//     separate table with its own tool makes that distinction structural rather
//     than a line in a prompt someone can argue the model out of.
//
// Searched via Postgres full-text search rather than the in-memory index, so it
// scales to the full 1,359-determination set (2005 onwards) without loading
// tens of MB into every lambda.
//
// Run: node dev/migrate-determinations.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS determination_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL,
  year integer NOT NULL,
  subject text,
  file text NOT NULL,
  page integer NOT NULL,
  npages integer NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`;

// Generated tsvector: the subject line is weighted A because it states what the
// determination is actually about, the body B.
await sql`ALTER TABLE determination_pages ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', text), 'B')
  ) STORED`;

await sql`CREATE INDEX IF NOT EXISTS determination_pages_tsv_idx ON determination_pages USING GIN (tsv)`;
await sql`CREATE INDEX IF NOT EXISTS determination_pages_ref_idx ON determination_pages(ref)`;
await sql`CREATE INDEX IF NOT EXISTS determination_pages_year_idx ON determination_pages(year)`;
// One row per (ref, page) so a re-ingest corrects rather than duplicates.
await sql`CREATE UNIQUE INDEX IF NOT EXISTS determination_pages_ref_page_idx ON determination_pages(ref, page)`;

const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'determination_pages' ORDER BY ordinal_position`;
console.log("determination_pages columns:", cols.map((c) => c.column_name).join(", "));
console.log("Migration complete");
