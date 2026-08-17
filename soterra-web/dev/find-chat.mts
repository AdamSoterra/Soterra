/** Search this account's chat history for a term (default "rondo").
 *   npx tsx dev/find-chat.mts [term] */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { db } = await import("../lib/db.ts");
const { chatThreads, chatMessages } = await import("../lib/schema.ts");
const { eq, inArray, ilike, asc } = await import("drizzle-orm");

const PID = "7b66634b-30ac-4722-9fbe-e375f273ecb2"; // Kauri Tower
const term = (process.argv[2] || "rondo").toLowerCase();

const threads = await db.select().from(chatThreads).where(eq(chatThreads.projectId, PID));
const threadIds = threads.map((t) => t.id);
console.log(`${threads.length} chat threads on this account`);
if (!threadIds.length) process.exit(0);

const hits = await db
  .select()
  .from(chatMessages)
  .where(inArray(chatMessages.threadId, threadIds))
  .orderBy(asc(chatMessages.createdAt));

const matching = hits.filter((m) => m.content.toLowerCase().includes(term));
console.log(`\n${matching.length} messages mention "${term}":\n`);
for (const m of matching) {
  const when = m.createdAt?.toISOString().slice(0, 16).replace("T", " ");
  console.log(`── ${m.role.toUpperCase()} · ${when} ─────────────────────────`);
  console.log(m.content.slice(0, 1200));
  console.log("");
}
process.exit(0);
