// Idempotent migration: a pre-rendered page image for a manufacturer page.
//
// Most manufacturer PDFs embed their fonts, so /api/doc-page can render a page
// on demand on Vercel's Linux serverless runtime. A few (Resene's data sheets)
// reference Arial / Verdana / Times New Roman WITHOUT embedding them. Those
// fonts don't exist on the Lambda, so the text renders blank there while it
// renders fine locally on Windows. For those documents we render the page once,
// here, where the fonts exist, and store the PNG. doc-page then serves the
// stored image instead of rendering live.
//
// Run: node dev/migrate-docpage-images.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = neon(url);

// image_url holds the PRIVATE Blob pathname of the stored PNG (nullable — most
// pages have none and render live). Served only through /api/doc-page, which
// re-checks the licence gate before streaming a byte.
await sql`ALTER TABLE manufacturer_pages ADD COLUMN IF NOT EXISTS image_url text`;

const cols = await sql`SELECT column_name FROM information_schema.columns
  WHERE table_name = 'manufacturer_pages' AND column_name = 'image_url'`;
console.log("manufacturer_pages.image_url present:", cols.length === 1);
console.log("Migration complete ✅");
