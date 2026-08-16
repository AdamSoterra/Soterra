/** What did production actually do with recent sends? Reads email_log.
 *   npx tsx dev/check-email-log.mts */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { db } = await import("../lib/db.ts");
const { emailLog } = await import("../lib/schema.ts");
const { desc } = await import("drizzle-orm");

const rows = await db.select().from(emailLog).orderBy(desc(emailLog.createdAt)).limit(25);
console.log(`last ${rows.length} email_log rows:\n`);
for (const r of rows) {
  const when = r.createdAt?.toISOString().slice(0, 16).replace("T", " ");
  console.log(`${when} | ${String(r.status).padEnd(9)} | ${String(r.kind).padEnd(15)} | to ${r.toEmail} | ${r.error ? "ERR: " + String(r.error).slice(0, 80) : ""}`);
}
const byStatus = rows.reduce<Record<string, number>>((a, r) => ((a[r.status ?? "?"] = (a[r.status ?? "?"] ?? 0) + 1), a), {});
console.log(`\nstatus counts: ${JSON.stringify(byStatus)}`);
process.exit(0);
