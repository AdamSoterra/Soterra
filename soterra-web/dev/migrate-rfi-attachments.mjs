// Attachments on every RFI communication surface (2026-09-10, Adam: "the RFI
// area has no upload"). The RFI row already had an `attachments` column (a
// bare filename list, unused); this adds the same JSON list to every line of
// the thread so follow-ups, consultant comments/answers and email replies can
// carry files. Files themselves live in the private Blob store.
//
// Idempotent (IF NOT EXISTS). Safe to re-run:  node dev/migrate-rfi-attachments.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

await sql(`ALTER TABLE rfi_messages ADD COLUMN IF NOT EXISTS attachments text`);
await sql(`ALTER TABLE rfis ADD COLUMN IF NOT EXISTS attachments text`);

for (const t of ["rfis", "rfi_messages"]) {
  const cols = await sql(`select column_name from information_schema.columns where table_name=$1 order by ordinal_position`, [t]);
  console.log(`${t}:`, cols.map((c) => c.column_name).join(", "));
}
console.log("migration OK");
