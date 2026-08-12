// Idempotent migration: checklists.location (Feature 4 — location-scoped QA
// checks). Null = whole job, and every checklist created before this.
// Reads DATABASE_URL from .env.local. Run: node dev/migrate-checklist-location.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);
await sql`ALTER TABLE checklists ADD COLUMN IF NOT EXISTS location text`;

const c = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'checklists' AND column_name = 'location'`;
console.log("checklists.location present:", c.length === 1);
console.log("Migration complete ✅");
