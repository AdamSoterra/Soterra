// Quick DB sanity check: row counts for the multi-project + code corpus tables.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL not found in ../.env.local");
const sql = neon(url);

async function count(table) {
  try {
    const r = await sql(`select count(*)::int as n from ${table}`);
    return r[0].n;
  } catch (e) {
    return `ERR: ${e.message}`;
  }
}

const tables = ["projects", "project_members", "events", "tasks", "chat_threads", "usage_counters", "plan_pages", "code_pages"];
const out = {};
for (const t of tables) out[t] = await count(t);
console.log("row counts:", JSON.stringify(out, null, 2));

// Sample of the code corpus (distinct docs) if present.
if (typeof out.code_pages === "number" && out.code_pages > 0) {
  const docs = await sql(`select doc, count(*)::int as pages from code_pages group by doc order by pages desc limit 15`);
  console.log("\ntop code docs:", JSON.stringify(docs, null, 2));
  const distinctDocs = await sql(`select count(distinct doc)::int as n from code_pages`);
  console.log("distinct code docs:", distinctDocs[0].n);
}

// Projects + member counts.
const projs = await sql(`select p.id, p.name, p.code, (select count(*)::int from project_members m where m.project_id = p.id) as members from projects p order by p.created_at`);
console.log("\nprojects:", JSON.stringify(projs, null, 2));
