-- Fixes uploaded custom templates "disappearing" after navigation/reload.
--
-- Root cause (confirmed empirically against the live project): custom_templates
-- has Row Level Security ENABLED but has ZERO policies defined on it. RLS with
-- no matching policy silently returns an EMPTY result set for SELECT (not an
-- error) — so fetchCustomTemplates(userId), called from the browser's
-- authenticated client, always returns []. The row genuinely exists in the
-- table the whole time; it's only ever visible right after upload because
-- that specific screen renders straight from the /api/custom-templates
-- response (which uses the service-role key and bypasses RLS), never from a
-- re-query. Any later fetch — a re-mount, a page reload, or signing back in
-- — hits the same authenticated-client SELECT and comes back empty.
--
-- The same missing-policy gap silently no-ops renameCustomTemplate's and
-- updateFieldMap's direct client .update(...) calls in src/lib/custom-templates.ts
-- (0 rows affected, no error thrown) — those go straight through the browser's
-- Supabase client, not through the service-role API route.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run.

alter table custom_templates enable row level security;

drop policy if exists "Users select own custom templates" on custom_templates;
create policy "Users select own custom templates"
  on custom_templates for select
  using (auth.uid() = user_id);

-- Not currently exercised by the app (all inserts go through
-- /api/custom-templates, which uses the service-role key and bypasses RLS),
-- but added so the table's policy set is complete/self-consistent rather
-- than only covering whichever operations happen to be used today.
drop policy if exists "Users insert own custom templates" on custom_templates;
create policy "Users insert own custom templates"
  on custom_templates for insert
  with check (auth.uid() = user_id);

-- Exercised directly by renameCustomTemplate/updateFieldMap (both go
-- straight through the browser's Supabase client, not the API route).
drop policy if exists "Users update own custom templates" on custom_templates;
create policy "Users update own custom templates"
  on custom_templates for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Not currently exercised directly (deletion goes through
-- /api/custom-templates so the private Storage object can be removed too),
-- added for the same completeness reason as the insert policy above.
drop policy if exists "Users delete own custom templates" on custom_templates;
create policy "Users delete own custom templates"
  on custom_templates for delete
  using (auth.uid() = user_id);

-- Verify afterwards:
-- select policyname, cmd, qual, with_check from pg_policies where tablename = 'custom_templates';
