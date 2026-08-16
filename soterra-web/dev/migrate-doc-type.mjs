// Idempotent migration: document typing on plan_pages (Documents feature).
// NULL = legacy/untyped, which every reader treats as "drawings" — the exact
// pre-types behaviour. Run: node dev/migrate-doc-type.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");
const sql = neon(url);

await sql`ALTER TABLE plan_pages ADD COLUMN IF NOT EXISTS doc_type text`;

const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'plan_pages' AND column_name = 'doc_type'`;
if (!cols.length) throw new Error("doc_type column missing after migration");
console.log("plan_pages.doc_type present ✅");
