-- Fixes custom uploaded standards disappearing after logout/refresh.
--
-- Root cause: standards table has no user_id, so there is no way to associate
-- rows with the uploading teacher, and no fetch-on-login exists in the UI.
-- The upload UI was backed by pure React state (reset on every unmount).
--
-- This migration:
--   1. Creates a standard_uploads parent table — one row per PDF/DOCX file
--      a teacher uploads, keyed on user_id.
--   2. Enables RLS on standard_uploads with per-user SELECT and UPDATE policies
--      so the browser client can read/soft-delete its own uploads.
--   3. Adds a user_id column to standards so inserts can be linked to the
--      uploading teacher (used for dedup filtering in upload-standards-process.js).
--
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run: IF NOT EXISTS / OR REPLACE everywhere.

-- ── 1. Parent upload registry ─────────────────────────────────────────────────
create table if not exists standard_uploads (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  filename   text,
  row_count  int         not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table standard_uploads enable row level security;

-- Users can list their own uploads (browser client, anon key + session JWT)
drop policy if exists "Users select own standard uploads" on standard_uploads;
create policy "Users select own standard uploads"
  on standard_uploads for select
  using (auth.uid() = user_id);

-- Users can soft-delete their own uploads (set deleted_at from the browser)
drop policy if exists "Users update own standard uploads" on standard_uploads;
create policy "Users update own standard uploads"
  on standard_uploads for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── 2. Link standards rows to their owner ─────────────────────────────────────
-- All writes to standards go through service-role API routes (bypassing RLS),
-- so no RLS policy is needed on standards itself. The user_id column is used
-- only for per-user dedup in upload-standards-process.js.
alter table standards add column if not exists user_id uuid references auth.users(id);

-- ── Verify afterwards ─────────────────────────────────────────────────────────
-- select id, user_id, filename, row_count, deleted_at, created_at
--   from standard_uploads order by created_at desc limit 20;
--
-- select policyname, cmd, qual, with_check
--   from pg_policies where tablename = 'standard_uploads';
