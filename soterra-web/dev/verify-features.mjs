// Verify the LIVE DB matches the new code — columns, indexes, and the exact
// read queries the routes run. Read-only (no mutations to prod).
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };

// 1. New columns exist on the live tables.
async function cols(table) {
  const r = await sql(`select column_name from information_schema.columns where table_name = $1`, [table]);
  return new Set(r.map((x) => x.column_name));
}
const ev = await cols("events");
ok(ev.has("assignee_id") && ev.has("assignee_name"), "events has assignee_id + assignee_name");
ok(ev.has("project_id") && ev.has("visibility") && ev.has("kind"), "events has project_id + visibility + kind");
const tk = await cols("tasks");
ok(tk.has("assignee_id") && tk.has("assignee_name"), "tasks has assignee_id + assignee_name");
const pr = await cols("projects");
ok(pr.has("id") && pr.has("name") && pr.has("code") && pr.has("creator_id") && pr.has("timezone"), "projects has id+name+code+creator_id+timezone");
const pm = await cols("project_members");
ok(pm.has("project_id") && pm.has("user_id") && pm.has("role") && pm.has("color_index"), "project_members has project_id+user_id+role+color_index");
const cp = await cols("code_pages");
ok(cp.has("doc") && cp.has("file") && cp.has("page") && cp.has("npages") && cp.has("title") && cp.has("text"), "code_pages has doc+file+page+npages+title+text");
const pp = await cols("plan_pages");
ok(pp.has("project_id") && pp.has("doc") && pp.has("text"), "plan_pages has project_id+doc+text");

// 2. Unique indexes the upserts/joins depend on.
const idx = new Set((await sql(`select indexname from pg_indexes where schemaname='public'`)).map((x) => x.indexname));
ok(idx.has("projects_code_idx"), "unique index projects_code_idx (join-by-code)");
ok(idx.has("project_members_project_user_idx"), "unique index project_members_project_user_idx (one row per member)");
ok(idx.has("usage_counters_project_day_idx"), "unique index usage_counters_project_day_idx (atomic daily cap)");

// 3. The exact read queries the routes run (must not throw).
const demo = "1-arthur-road";
try {
  await sql(`select id, title, assignee_id, assignee_name, visibility from events where project_id = $1 and (visibility = 'team' or creator_id = $2 or assignee_id = $2) order by starts_at limit 5`, [demo, "x"]);
  ok(true, "events visibility+assignee query runs");
} catch (e) { ok(false, "events query: " + e.message); }
try {
  await sql(`select user_id, name, role, color_index from project_members where project_id = $1 order by created_at`, [demo]);
  ok(true, "listMembers query runs");
} catch (e) { ok(false, "members query: " + e.message); }
try {
  const hits = await sql(`select doc, page, npages from code_pages where lower(text) like '%stair%' limit 3`);
  ok(hits.length > 0, `search_code corpus is queryable + has content (${hits.length} 'stair' hits, e.g. "${hits[0]?.doc}" p${hits[0]?.page})`);
} catch (e) { ok(false, "code_pages query: " + e.message); }

// 4. Demo site + its member (so we know who can open the demo immediately).
const dm = await sql(`select user_id, name, role from project_members where project_id = $1`, [demo]);
console.log(`\ndemo site members: ${JSON.stringify(dm)}`);
const counts = await sql(`select (select count(*)::int from events where project_id=$1) ev, (select count(*)::int from tasks where project_id=$1) tk`, [demo]);
console.log(`demo site: ${counts[0].ev} events, ${counts[0].tk} tasks`);

console.log(fails === 0 ? "\n✅ ALL CHECKS PASSED — live DB matches the new code." : `\n❌ ${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
