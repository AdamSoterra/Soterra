// Add project_members.title (the person's job title, e.g. "Site Manager"),
// used so the assistant can assign by role as well as by name. Idempotent.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

await sql(`ALTER TABLE project_members ADD COLUMN IF NOT EXISTS title text`);
const cols = await sql(`select column_name from information_schema.columns where table_name='project_members'`);
console.log("project_members columns:", cols.map((c) => c.column_name).join(", "));
console.log("migration OK");
