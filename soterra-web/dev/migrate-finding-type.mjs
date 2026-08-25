// Idempotent migration: finding_type on checklist_items (Programme critique).
// Only set when checklists.kind = 'programme'; NULL on every normal QA item, so
// the column is additive and changes nothing for existing checklists.
// Run: node dev/migrate-finding-type.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");
const sql = neon(url);

await sql`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS finding_type text`;
await sql`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS severity text`;

const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'checklist_items' AND column_name IN ('finding_type', 'severity')`;
if (cols.length < 2) throw new Error("finding_type/severity columns missing after migration");
console.log("checklist_items.finding_type + severity present ✅");
