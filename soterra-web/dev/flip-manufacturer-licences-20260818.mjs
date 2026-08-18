// Licence flips reflecting Adam's confirmation of 2026-08-18: written
// permission is now IN HAND for every loaded manufacturer EXCEPT Rondo, whose
// conversation is close but not concluded. So:
//
//   GIB                  pending -> granted   (archived rows untouched)
//   BOSS Fire            pending -> granted
//   Kingspan Thermakraft pending -> granted
//   Allproof             demo    -> granted
//   ColorSteel           demo    -> granted
//   Concrete NZ          demo    -> granted
//   James Hardie         demo    -> granted
//   Resene               demo    -> granted
//   Rondo                NO CHANGE — stays demo (founder accounts only)
//
// Ryanfire is not listed because its permission landed the same day and its
// corpus was re-ingested directly as `granted` (dev/ryanfire-manifest.json).
//
// Idempotent: each UPDATE keys on (manufacturer, current licence), so a re-run
// matches zero rows. Run: node dev/flip-manufacturer-licences-20260818.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in .env.local");
const sql = neon(url);

const flips = [
  { manufacturer: "GIB", from: "pending" },
  { manufacturer: "BOSS Fire", from: "pending" },
  { manufacturer: "Kingspan Thermakraft", from: "pending" },
  { manufacturer: "Allproof", from: "demo" },
  { manufacturer: "ColorSteel", from: "demo" },
  { manufacturer: "Concrete NZ", from: "demo" },
  { manufacturer: "James Hardie", from: "demo" },
  { manufacturer: "Resene", from: "demo" },
];

for (const { manufacturer, from } of flips) {
  const rows = await sql`
    UPDATE manufacturer_pages SET licence = 'granted'
    WHERE manufacturer = ${manufacturer} AND licence = ${from}
    RETURNING id`;
  console.log(`${manufacturer.padEnd(22)} ${from} -> granted  ${rows.length} page(s)`);
}

console.log("\nAFTER");
const after = await sql`
  SELECT manufacturer, licence, count(*)::int AS pages
  FROM manufacturer_pages
  GROUP BY manufacturer, licence
  ORDER BY manufacturer, licence`;
for (const r of after) console.log(`  ${String(r.manufacturer).padEnd(22)} ${String(r.licence).padEnd(10)} ${r.pages}`);
