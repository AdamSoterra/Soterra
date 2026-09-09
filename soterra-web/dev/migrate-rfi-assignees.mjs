// RFIs assigned to several consultants + CIs raised from correspondence
// (2026-09-10, Adam: "we need multiple [assignees] ... the PM has the option to
// decide"; "this instructions tab can actually be gone, lets incorporate this
// into a closed rfi").
//
//   rfis.assignees                      JSON [{name, company, email}] - every
//                                       consultant the RFI went to; the existing
//                                       consultant_* columns keep the FIRST one
//   contract_instructions.source_corr_id the piece of correspondence a CI was
//                                       raised from (like source_rfi_id)
//
// Idempotent (IF NOT EXISTS). Safe to re-run:  node dev/migrate-rfi-assignees.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

await sql(`ALTER TABLE rfis ADD COLUMN IF NOT EXISTS assignees text`);
await sql(`ALTER TABLE contract_instructions ADD COLUMN IF NOT EXISTS source_corr_id uuid`);

for (const t of ["rfis", "contract_instructions"]) {
  const cols = await sql(`select column_name from information_schema.columns where table_name=$1 order by ordinal_position`, [t]);
  console.log(`${t}:`, cols.map((c) => c.column_name).join(", "));
}
console.log("migration OK");
