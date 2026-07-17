-- Links standards chunks to their parent upload and enriches standard_uploads
-- with document-level subject/grade metadata for display in the My Standards UI.
--
-- Part of the My Standards / Upload New framework redesign.
-- Run once in the Supabase SQL editor after add-custom-standards-persistence.sql.
-- Safe to re-run: IF NOT EXISTS / OR REPLACE everywhere.

-- ── 1. Link each standards chunk to its parent upload ─────────────────────────
alter table standards
  add column if not exists upload_id uuid references standard_uploads(id);

-- ── 2. Document-level summary on the upload record ───────────────────────────
-- Populated by upload-standards-process.js from the document-context scan
-- so the UI can show subject/grade without querying individual chunk rows.
alter table standard_uploads
  add column if not exists subject    text,
  add column if not exists grade_band text;

-- ── 3. Update match_standards to support per-upload filtering ────────────────
-- Adds optional match_upload_id: when provided, only rows belonging to that
-- specific upload are returned — used when the teacher selects one of their
-- saved documents from the My Standards panel.
drop function if exists match_standards(vector(1536), text, int);
drop function if exists match_standards(vector(1536), text, int, text);

create or replace function match_standards (
  query_embedding  vector(1536),
  match_framework  text,
  match_count      int     default 5,
  match_grade_band text    default null,
  match_upload_id  uuid    default null
)
returns table (
  id             uuid,
  framework      text,
  standard_code  text,
  title          text,
  grade_level    text,
  grade_band     text,
  content        text,
  similarity     float
)
language sql stable
as $$
  select
    standards.id,
    standards.framework,
    standards.standard_code,
    standards.title,
    standards.grade_level,
    standards.grade_band,
    standards.content,
    1 - (standards.embedding <=> query_embedding) as similarity
  from standards
  where standards.framework = match_framework
    and standards.embedding is not null
    -- Grade-band filter: strict when both the query and the row are tagged;
    -- a no-op when either side has no grade info.
    and (
      match_grade_band is null
      or standards.grade_band is null
      or standards.grade_band = match_grade_band
    )
    -- Upload filter: when a specific upload is selected, only return its chunks.
    -- Null = no filter (used for NGSS / Common Core and legacy custom rows).
    and (match_upload_id is null or standards.upload_id = match_upload_id)
  order by standards.embedding <=> query_embedding
  limit match_count;
$$;

-- ── Verify afterwards ─────────────────────────────────────────────────────────
-- select id, filename, subject, grade_band, row_count from standard_uploads limit 10;
-- select policyname, cmd from pg_policies where tablename = 'standard_uploads';
