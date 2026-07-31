/**
 * Manage the `demo` tier of the manufacturer corpus.
 *
 *   npx tsx dev/demo-corpus.mts list
 *   npx tsx dev/demo-corpus.mts promote "Rondo" granted
 *   npx tsx dev/demo-corpus.mts remove "James Hardie"
 *   npx tsx dev/demo-corpus.mts remove-all
 *
 * `demo` holds a manufacturer's own PUBLIC pages purely so we can record a short
 * demo showing them how their content would be quoted and cited, to help them
 * decide on permission. It is served (otherwise the demo could not work), so it
 * needs a way OUT that takes seconds and leaves nothing behind:
 *
 *   they say yes  → promote to granted (or pending while paperwork lands)
 *   they say no   → remove, and it is gone from the app on the next server warm
 *   they go quiet → remove anyway; do not let a demo tier quietly become the
 *                   thing we rely on
 *
 * Deliberately blunt: this deletes rows rather than flipping them to
 * `withdrawn`, because a "no" from someone who never granted anything in the
 * first place should leave no trace of their material in our database.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const cmd = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

const { db } = await import("../lib/db.ts");
const { manufacturerPages } = await import("../lib/schema.ts");
const { and, eq, sql } = await import("drizzle-orm");

async function list() {
  const rows = await db
    .select({
      manufacturer: manufacturerPages.manufacturer,
      doc: manufacturerPages.doc,
      licence: manufacturerPages.licence,
      n: sql<number>`count(*)::int`,
    })
    .from(manufacturerPages)
    .groupBy(manufacturerPages.manufacturer, manufacturerPages.doc, manufacturerPages.licence)
    .orderBy(manufacturerPages.licence, manufacturerPages.manufacturer, manufacturerPages.doc);

  const byLicence = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byLicence.get(r.licence) ?? [];
    list.push(r);
    byLicence.set(r.licence, list);
  }
  for (const [lic, docs] of byLicence) {
    const total = docs.reduce((a, b) => a + b.n, 0);
    console.log(`\n=== licence "${lic}" — ${docs.length} document(s), ${total} pages ===`);
    for (const d of docs) console.log(`  ${String(d.n).padStart(4)}pp  ${d.manufacturer} · ${d.doc}`);
  }
  const demo = byLicence.get("demo");
  if (demo?.length) {
    console.log(
      `\n⚠️  ${demo.reduce((a, b) => a + b.n, 0)} pages are DEMO-ONLY and are being served.` +
        `\n   Promote them on a yes, or remove them: npx tsx dev/demo-corpus.mts remove-all`,
    );
  }
}

async function promote(manufacturer: string, licence: string) {
  if (!["granted", "pending"].includes(licence)) {
    console.error(`licence must be "granted" or "pending" — got "${licence}"`);
    process.exit(1);
  }
  const res = await db
    .update(manufacturerPages)
    .set({ licence })
    .where(and(eq(manufacturerPages.manufacturer, manufacturer), eq(manufacturerPages.licence, "demo")))
    .returning({ id: manufacturerPages.id });
  console.log(`promoted ${res.length} page(s) of ${manufacturer} from demo → ${licence}`);
}

async function remove(manufacturer?: string) {
  const where = manufacturer
    ? and(eq(manufacturerPages.manufacturer, manufacturer), eq(manufacturerPages.licence, "demo"))
    : eq(manufacturerPages.licence, "demo");
  const res = await db.delete(manufacturerPages).where(where).returning({ id: manufacturerPages.id });
  console.log(`removed ${res.length} demo page(s)${manufacturer ? ` for ${manufacturer}` : ""}.`);
  console.log("The live app drops them when its cached index next reloads (a deploy, or a cold start).");
}

if (cmd === "list") await list();
else if (cmd === "promote" && arg1 && arg2) await promote(arg1, arg2);
else if (cmd === "remove" && arg1) await remove(arg1);
else if (cmd === "remove-all") await remove();
else {
  console.error(
    "usage:\n  npx tsx dev/demo-corpus.mts list\n" +
      '  npx tsx dev/demo-corpus.mts promote "<Manufacturer>" <granted|pending>\n' +
      '  npx tsx dev/demo-corpus.mts remove "<Manufacturer>"\n' +
      "  npx tsx dev/demo-corpus.mts remove-all",
  );
  process.exit(1);
}
process.exit(0);
