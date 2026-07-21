// STEP 0 — the company layer, plus the inspection-history and checklist tables
// that live inside it.
//
// Run BEFORE anything reads history: `node dev/migrate-company-layer.mjs`.
// Idempotent — safe to re-run.
//
// Backfill rule: every EXISTING project gets its own company, named after the
// project. That's the only safe default — merging two existing projects into
// one company would pool two builders' history, which is the exact failure this
// whole layer exists to prevent. Adam can merge them later by hand if they
// really are the same business.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const m = env.match(/^DATABASE_URL=(.+)$/m);
const url = m ? m[1].trim().replace(/^["']|["']$/g, "") : process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = neon(url);

// ─── companies ───
await sql`create table if not exists companies (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now())`;

// ─── projects.company_id (nullable first, backfill, then NOT NULL) ───
await sql`alter table projects add column if not exists company_id text`;

const orphans = await sql`select id, name, creator_id from projects where company_id is null order by created_at`;
for (const p of orphans) {
  // Does this creator already have a company (from an earlier loop pass)? If so
  // reuse it, so one person's sites stay one business.
  const existing = await sql`
    select c.id from companies c
    join projects pr on pr.company_id = c.id
    where pr.creator_id = ${p.creator_id} and pr.company_id is not null
    limit 1`;
  let companyId = existing[0]?.id;
  if (!companyId) {
    companyId = randomUUID();
    await sql`insert into companies (id, name) values (${companyId}, ${p.name})`;
  }
  await sql`update projects set company_id = ${companyId} where id = ${p.id}`;
  console.log(`  project "${p.name}" → company ${companyId}`);
}
await sql`alter table projects alter column company_id set not null`;
await sql`create index if not exists projects_company_idx on projects(company_id)`;

// ─── inspection history ───
await sql`create table if not exists inspections (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  project_id text not null,
  doc text not null,
  file text,
  source text not null default 'council',
  inspection_code text,
  inspection_type text,
  inspector text,
  outcome text not null default 'unknown',
  inspected_on text,
  event_id uuid,
  item_count int not null default 0,
  created_by text,
  created_at timestamptz not null default now())`;
await sql`create index if not exists inspections_company_idx on inspections(company_id)`;
await sql`create index if not exists inspections_project_idx on inspections(project_id)`;
await sql`create unique index if not exists inspections_project_doc_idx on inspections(project_id, doc)`;

await sql`create table if not exists inspection_items (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  project_id text not null,
  inspection_id uuid not null,
  category text not null,
  title text not null,
  detail text,
  location text,
  inspection_code text,
  inspected_on text,
  created_at timestamptz not null default now())`;
await sql`create index if not exists inspection_items_company_idx on inspection_items(company_id)`;
await sql`create index if not exists inspection_items_inspection_idx on inspection_items(inspection_id)`;
await sql`create index if not exists inspection_items_company_category_idx on inspection_items(company_id, category)`;

// ─── checklists ───
await sql`create table if not exists checklists (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  project_id text not null,
  event_id uuid,
  kind text not null default 'inspection',
  title text not null,
  inspection_code text,
  status text not null default 'open',
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now())`;
await sql`create index if not exists checklists_company_idx on checklists(company_id)`;
await sql`create index if not exists checklists_project_idx on checklists(project_id)`;
await sql`create index if not exists checklists_event_idx on checklists(event_id)`;

await sql`create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  project_id text not null,
  checklist_id uuid not null,
  ord int not null default 0,
  category text,
  title text not null,
  detail text,
  source text not null default 'manual',
  source_ref text,
  status text not null default 'pending',
  note text,
  checked_by text,
  checked_by_name text,
  checked_at timestamptz,
  created_at timestamptz not null default now())`;
await sql`create index if not exists checklist_items_checklist_idx on checklist_items(checklist_id)`;
await sql`create index if not exists checklist_items_company_idx on checklist_items(company_id)`;

await sql`create table if not exists checklist_photos (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  project_id text not null,
  checklist_id uuid not null,
  item_id uuid not null,
  url text not null,
  caption text,
  taken_by text,
  created_at timestamptz not null default now())`;
await sql`create index if not exists checklist_photos_item_idx on checklist_photos(item_id)`;
await sql`create index if not exists checklist_photos_checklist_idx on checklist_photos(checklist_id)`;

const counts = await sql`select
  (select count(*)::int from companies) as companies,
  (select count(*)::int from projects) as projects,
  (select count(*)::int from projects where company_id is null) as projects_without_company,
  (select count(*)::int from inspections) as inspections,
  (select count(*)::int from inspection_items) as inspection_items,
  (select count(*)::int from checklists) as checklists,
  (select count(*)::int from checklist_items) as checklist_items,
  (select count(*)::int from checklist_photos) as checklist_photos`;
console.log("migration OK:", counts[0]);
