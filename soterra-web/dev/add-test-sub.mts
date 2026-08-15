/**
 * Add (or refresh) a clearly-named TEST sub in the demo company pointing at
 * Adam's real inbox, so an in-app "Send to subs" can be verified end to end.
 * Remove it afterwards with: npx tsx dev/add-test-sub.mts --remove
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { db } = await import("../lib/db.ts");
const { subs } = await import("../lib/schema.ts");
const { and, eq } = await import("drizzle-orm");

const COMPANY = "e9210ba0-b03b-402b-8cfa-e6fa66d39055"; // demo (Kauri)
const EMAIL = "domokadam43@gmail.com";

await db.delete(subs).where(and(eq(subs.companyId, COMPANY), eq(subs.email, EMAIL)));
if (process.argv.includes("--remove")) {
  console.log("Test sub removed.");
} else {
  await db.insert(subs).values({ companyId: COMPANY, name: "Adam - EMAIL TEST (delete me)", email: EMAIL, trade: null });
  console.log(`Test sub added to the demo company -> ${EMAIL}`);
}
process.exit(0);
