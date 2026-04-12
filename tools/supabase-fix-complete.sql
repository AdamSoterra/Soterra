-- ═══════════════════════════════════════════════════
-- COMPLETE FIX: Clean data + proper RLS
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- 1. Clean up all test data
DELETE FROM public.inspections;
DELETE FROM public.projects;
DELETE FROM public.profiles;
DELETE FROM public.companies;

-- Also delete all auth users (clean slate)
DELETE FROM auth.users;

-- 2. Re-enable RLS on all tables
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Drop ALL existing policies (clean slate)
DROP POLICY IF EXISTS "Users can create companies" ON public.companies;
DROP POLICY IF EXISTS "Users can view own company" ON public.companies;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view company projects" ON public.projects;
DROP POLICY IF EXISTS "Users can create company projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update company projects" ON public.projects;
DROP POLICY IF EXISTS "Users can view project inspections" ON public.inspections;
DROP POLICY IF EXISTS "Users can create project inspections" ON public.inspections;
DROP POLICY IF EXISTS "Users can update project inspections" ON public.inspections;

-- 4. Create proper policies

-- COMPANIES: any authenticated user can insert (needed during signup)
CREATE POLICY "companies_insert" ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- COMPANIES: users can view their own company
CREATE POLICY "companies_select" ON public.companies
  FOR SELECT TO authenticated
  USING (id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- PROFILES: users can view their own profile
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- PROFILES: the trigger inserts profiles (runs as definer/service role, bypasses RLS)
-- But we also allow authenticated users to insert their own
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- PROFILES: users can update their own profile
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- PROJECTS: users can view their company's projects
CREATE POLICY "projects_select" ON public.projects
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- PROJECTS: users can create projects for their company
CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- PROJECTS: users can update their company's projects
CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE TO authenticated
  USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- INSPECTIONS: users can view inspections for their company's projects
CREATE POLICY "inspections_select" ON public.inspections
  FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT p.id FROM public.projects p
    JOIN public.profiles pr ON pr.company_id = p.company_id
    WHERE pr.id = auth.uid()
  ));

-- INSPECTIONS: users can create inspections for their company's projects
CREATE POLICY "inspections_insert" ON public.inspections
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT p.id FROM public.projects p
    JOIN public.profiles pr ON pr.company_id = p.company_id
    WHERE pr.id = auth.uid()
  ));

-- INSPECTIONS: users can update inspections for their company's projects
CREATE POLICY "inspections_update" ON public.inspections
  FOR UPDATE TO authenticated
  USING (project_id IN (
    SELECT p.id FROM public.projects p
    JOIN public.profiles pr ON pr.company_id = p.company_id
    WHERE pr.id = auth.uid()
  ));

-- 5. Make sure the profile trigger still exists
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'full_name', ''));
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger to be safe
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
