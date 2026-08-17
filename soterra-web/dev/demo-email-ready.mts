/** Make the demo send to a REAL inbox so email can be shown working: ensure a
 *  test sub on Adam's Gmail, and point one draft RFI's consultant email there.
 *   npx tsx dev/demo-email-ready.mts
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { db } = await import("../lib/db.ts");
const { subs, rfis } = await import("../lib/schema.ts");
const { and, eq } = await import("drizzle-orm");

const CID = "e9210ba0-b03b-402b-8cfa-e6fa66d39055";
const PID = "7b66634b-30ac-4722-9fbe-e375f273ecb2";
const EMAIL = "domokadam43@gmail.com";

// 1) test sub
const existingSub = await db.select().from(subs).where(and(eq(subs.companyId, CID), eq(subs.email, EMAIL)));
if (!existingSub.length) {
  await db.insert(subs).values({ companyId: CID, name: "Adam - EMAIL TEST (delete me)", email: EMAIL, trade: null });
  console.log("added test sub -> " + EMAIL);
} else {
  console.log("test sub already present -> " + EMAIL);
}

// 2) draft RFI to a real inbox (so Send actually delivers)
const drafts = await db.select().from(rfis).where(and(eq(rfis.projectId, PID), eq(rfis.status, "draft")));
if (drafts.length) {
  const d = drafts[0];
  await db.update(rfis).set({ consultantEmail: EMAIL, consultantName: "Adam (demo test)" }).where(eq(rfis.id, d.id));
  console.log(`pointed draft RFI "${d.subject}" consultant email -> ${EMAIL} (send it from the RFIs tab to see a real email land)`);
} else {
  console.log("no draft RFI in the demo to wire; raise one in-app with a real email to demo RFI sending.");
}
process.exit(0);
