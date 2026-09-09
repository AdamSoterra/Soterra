/**
 * Put the demo project's consultants (the firms on the Kauri Tower RFI register)
 * into the Directory of the demo company, every one pointing at Adam's real inbox
 * via a plus-tag, so a New RFI can be assigned to "Aria Architects + Voltway" and
 * the emails land with him (Adam 2026-09-10: "build in here our imaginary
 * consultants ... my test email is in there, we can do the same thing with
 * consultants"). The sign-in gate and the portal match plus-tagged addresses
 * to the base mailbox (lib/externalAuth normalizeEmail).
 *
 *   npx tsx dev/seed-demo-consultants.mts            add / refresh
 *   npx tsx dev/seed-demo-consultants.mts --remove   take them out again
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { db } = await import("../lib/db.ts");
const { consultants } = await import("../lib/schema.ts");
const { and, eq, like } = await import("drizzle-orm");

const COMPANY = "e9210ba0-b03b-402b-8cfa-e6fa66d39055"; // demo (Kauri)
const INBOX = "domokadam43"; // + tag @gmail.com
const LIST: { tag: string; name: string; company: string; discipline: string }[] = [
  { tag: "aria", name: "Meg Sinclair", company: "Aria Architects", discipline: "Architectural" },
  { tag: "totara", name: "Priya Nair", company: "Totara Structural Consultants", discipline: "Structural" },
  { tag: "voltway", name: "Rob Deen", company: "Voltway Electrical Design", discipline: "Electrical" },
  { tag: "kahikatea", name: "Sam Whitiora", company: "Kahikatea Fire Engineering", discipline: "Fire" },
  { tag: "meridian", name: "Grant Hollis", company: "Meridian Mechanical", discipline: "Mechanical" },
  { tag: "southern", name: "Lena Fraser", company: "Southern Facade Group", discipline: "Facade" },
  { tag: "harbourline", name: "Tama Reweti", company: "Harbourline Civil", discipline: "Civil" },
];

// Remove what a previous run added (every plus-tagged demo address), then re-add.
await db.delete(consultants).where(and(eq(consultants.companyId, COMPANY), like(consultants.email, `${INBOX}+%@gmail.com`)));
if (process.argv.includes("--remove")) {
  console.log("Demo consultants removed.");
} else {
  for (const c of LIST) {
    await db.insert(consultants).values({ companyId: COMPANY, name: c.name, company: c.company, discipline: c.discipline, email: `${INBOX}+${c.tag}@gmail.com` });
    console.log(`+ ${c.name} · ${c.company} → ${INBOX}+${c.tag}@gmail.com`);
  }
}
process.exit(0);
