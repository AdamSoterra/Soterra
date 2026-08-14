// Idempotent migration: cached render columns on plan_pages (fast sheet
// opening + preview thumbnails). Populated lazily at view time.
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-plan-images.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);
await sql`ALTER TABLE plan_pages ADD COLUMN IF NOT EXISTS image_url text`;
await sql`ALTER TABLE plan_pages ADD COLUMN IF NOT EXISTS thumb_url text`;

const c = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'plan_pages' AND column_name IN ('image_url','thumb_url')`;
console.log("columns present:", c.length === 2);
console.log("Migration complete ✅");
