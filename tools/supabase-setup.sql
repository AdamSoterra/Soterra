-- ═══════════════════════════════════════════════════
-- Soterra Database Setup
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- 1. Companies table
create table public.companies (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_at timestamptz default now()
);

-- 2. Profiles table (extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  company_id uuid references public.companies on delete cascade,
  full_name text,
  role text default 'pm',
  email text,
  created_at timestamptz default now()
);

-- 3. Projects table
create table public.projects (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references public.companies on delete cascade not null,
  name text not null,
  address text,
  sm_name text,
  sm_email text,
  program_filename text,
  created_at timestamptz default now()
);

-- 4. Inspections table
create table public.inspections (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects on delete cascade not null,
  task_id text,
  task text not null,
  lot text,
  section text,
  start_date date,
  finish_date date,
  duration text,
  status text default 'notstarted',
  inspector text,
  issues text,
  created_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════
-- Row Level Security (RLS) Policies
-- Users can only see their own company's data
-- ═══════════════════════════════════════════════════

-- Enable RLS on all tables
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.inspections enable row level security;

-- Profiles: users can read/update their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Companies: users can see their own company
create policy "Users can view own company"
  on public.companies for select
  using (id in (select company_id from public.profiles where id = auth.uid()));

create policy "Users can create companies"
  on public.companies for insert
  with check (true);

-- Projects: users can see their company's projects
create policy "Users can view company projects"
  on public.projects for select
  using (company_id in (select company_id from public.profiles where id = auth.uid()));

create policy "Users can create company projects"
  on public.projects for insert
  with check (company_id in (select company_id from public.profiles where id = auth.uid()));

create policy "Users can update company projects"
  on public.projects for update
  using (company_id in (select company_id from public.profiles where id = auth.uid()));

-- Inspections: users can see their company's inspections
create policy "Users can view project inspections"
  on public.inspections for select
  using (project_id in (
    select p.id from public.projects p
    join public.profiles pr on pr.company_id = p.company_id
    where pr.id = auth.uid()
  ));

create policy "Users can create project inspections"
  on public.inspections for insert
  with check (project_id in (
    select p.id from public.projects p
    join public.profiles pr on pr.company_id = p.company_id
    where pr.id = auth.uid()
  ));

create policy "Users can update project inspections"
  on public.inspections for update
  using (project_id in (
    select p.id from public.projects p
    join public.profiles pr on pr.company_id = p.company_id
    where pr.id = auth.uid()
  ));

-- ═══════════════════════════════════════════════════
-- Auto-create profile on signup
-- ═══════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
