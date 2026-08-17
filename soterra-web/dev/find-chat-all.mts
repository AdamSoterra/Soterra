/** Search ALL chat history (every project) + the manufacturer corpus for a term.
 *   npx tsx dev/find-chat-all.mts [term] */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { db } = await import("../lib/db.ts");
const { chatMessages, manufacturerPages } = await import("../lib/schema.ts");
const { asc } = await import("drizzle-orm");
const term = (process.argv[2] || "rondo").toLowerCase();

const msgs = await db.select().from(chatMessages).orderBy(asc(chatMessages.createdAt));
const hits = msgs.filter((m) => m.content.toLowerCase().includes(term));
console.log(`CHAT: ${hits.length} of ${msgs.length} messages (all projects) mention "${term}"\n`);
for (const m of hits) {
  const when = m.createdAt?.toISOString().slice(0, 16).replace("T", " ");
  console.log(`── ${m.role.toUpperCase()} · ${when} ──`);
  console.log(m.content.slice(0, 1000));
  console.log("");
}

const pages = await db.select().from(manufacturerPages);
const rondo = pages.filter((p) => (p.manufacturer ?? "").toLowerCase().includes(term) || (p.doc ?? "").toLowerCase().includes(term));
const docs = [...new Set(rondo.map((p) => `${p.manufacturer} · ${p.doc} (${p.licence})`))];
console.log(`\nCORPUS: ${rondo.length} ${term} pages across ${docs.length} docs:`);
for (const d of docs) console.log("  " + d);
process.exit(0);
