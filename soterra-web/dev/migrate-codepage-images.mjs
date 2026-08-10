// Idempotent migration: a pre-rendered page image for a Building Code page.
//
// Until now a Code citation was the only kind that could NOT be opened. A
// manufacturer citation opens the real page, a determination opens the real
// MBIE page, but a Code chip just linked out to building.govt.nz — because we
// held no rendered Code pages, and opening the viewer would have shown a blank
// sheet. That is backwards: the Code is the single most-cited source in the
// product, so the one thing that convinces people ("tap it, see the actual
// page") was missing from the place it is needed most.
//
// The Code is Crown material, published free by MBIE, and we already hold the
// text. Storing a rendered page is the same thing we do for manufacturer pages,
// with none of the licence questions.
//
// Run: node dev/migrate-codepage-images.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

// Nullable on purpose: a page with no stored image simply keeps the old
// behaviour and links out, so this can be rolled out one document at a time.
await sql`ALTER TABLE code_pages ADD COLUMN IF NOT EXISTS image_url text`;

const cols = await sql`SELECT column_name FROM information_schema.columns
  WHERE table_name = 'code_pages' AND column_name = 'image_url'`;
console.log("code_pages.image_url present:", cols.length === 1);
console.log("Migration complete ✅");
