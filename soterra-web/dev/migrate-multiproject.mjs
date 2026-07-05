// Multi-project migration: projects + project_members, assignee columns on
// events/tasks, code_pages (shared building-code index), then seed the demo site
// and backfill existing creators as members. Idempotent — safe to re-run.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const m = env.match(/^DATABASE_URL=(.+)$/m);
const url = (m ? m[1].trim().replace(/^["']|["']$/g, "") : process.env.DATABASE_URL);
if (!url) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = neon(url);

await sql`create table if not exists projects (
  id text primary key, name text not null, code text not null,
  creator_id text not null, timezone text not null default 'Pacific/Auckland',
  created_at timestamptz not null default now())`;
await sql`create unique index if not exists projects_code_idx on projects(code)`;

await sql`create table if not exists project_members (
  id uuid primary key default gen_random_uuid(), project_id text not null, user_id text not null,
  name text, role text not null default 'member', color_index int not null default 0,
  created_at timestamptz not null default now())`;
await sql`create index if not exists project_members_project_idx on project_members(project_id)`;
await sql`create index if not exists project_members_user_idx on project_members(user_id)`;
await sql`create unique index if not exists project_members_project_user_idx on project_members(project_id, user_id)`;

await sql`alter table events add column if not exists assignee_id text`;
await sql`alter table events add column if not exists assignee_name text`;
await sql`alter table tasks add column if not exists assignee_id text`;
await sql`alter table tasks add column if not exists assignee_name text`;

await sql`create table if not exists code_pages (
  id uuid primary key default gen_random_uuid(), doc text not null, file text not null,
  page int not null, npages int not null, title text, text text not null,
  created_at timestamptz not null default now())`;

// Seed the demo site (1 Arthur Road) if missing — keeps existing data valid and
// gives testers a project to try instantly (its bundled plan index still works).
const demoId = "1-arthur-road";
const already = await sql`select id from projects where id = ${demoId}`;
if (already.length === 0) {
  const cr = await sql`select creator_id from events where project_id = ${demoId} order by created_at asc limit 1`;
  const creatorId = cr[0]?.creator_id ?? "system";
  await sql`insert into projects (id, name, code, creator_id) values (${demoId}, '1 Arthur Road', 'ARTHUR-DEMO', ${creatorId})`;
}
const proj = await sql`select creator_id from projects where id = ${demoId}`;
const adminId = proj[0]?.creator_id;

// Backfill: every distinct creator across the demo's events/tasks/threads → a member.
const creators = await sql`
  select creator_id, max(name) as name from (
    select creator_id, creator_name as name from events where project_id = ${demoId}
    union all select creator_id, creator_name as name from tasks where project_id = ${demoId}
    union all select creator_id, null::text as name from chat_threads where project_id = ${demoId}
  ) u group by creator_id`;
let idx = 0;
for (const c of creators) {
  const role = c.creator_id === adminId ? "admin" : "member";
  await sql`insert into project_members (project_id, user_id, name, role, color_index)
    values (${demoId}, ${c.creator_id}, ${c.name}, ${role}, ${idx % 8})
    on conflict (project_id, user_id) do nothing`;
  idx++;
}
if (adminId && adminId !== "system") {
  await sql`insert into project_members (project_id, user_id, name, role, color_index)
    values (${demoId}, ${adminId}, null, 'admin', 0) on conflict (project_id, user_id) do nothing`;
}

const counts = await sql`select
  (select count(*)::int from projects) as projects,
  (select count(*)::int from project_members) as members,
  (select count(*)::int from code_pages) as code_pages`;
console.log("migration OK:", counts[0]);
