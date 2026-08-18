// Add rfis.answer_token: the secret in the consultant's "Answer this RFI
// online" link. Minted on send, unique per RFI; holding it proves you were
// sent that exact RFI, which is what authorises the public answer page.
// Idempotent.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

await sql(`ALTER TABLE rfis ADD COLUMN IF NOT EXISTS answer_token text`);
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS rfis_answer_token_idx ON rfis (answer_token) WHERE answer_token IS NOT NULL`);
const cols = await sql(`select column_name from information_schema.columns where table_name='rfis'`);
console.log("rfis columns:", cols.map((c) => c.column_name).join(", "));
console.log("migration OK");
