// Idempotent migration: inspection items become a live worklist (Feature 6) —
// work_status + the sent-to-sub stamps.
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-inspection-worklist.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);
await sql`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS work_status text NOT NULL DEFAULT 'not_done'`;
await sql`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS sent_to text`;
await sql`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS sent_at timestamptz`;
await sql`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS sent_status text`;

const c = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'inspection_items' AND column_name IN ('work_status','sent_to','sent_at','sent_status')`;
console.log("columns present:", c.length === 4);
console.log("Migration complete ✅");
