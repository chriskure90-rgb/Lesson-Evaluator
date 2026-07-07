-- Enables pgvector cosine-similarity search over the `standards` table,
-- filtered by framework (e.g. "NGSS", "Common Core") and, optionally,
-- NGSS grade band (e.g. "K", "1-2", "3-5", "6-8", "9-12").
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run: ALTER/CREATE statements use IF NOT EXISTS / OR REPLACE,
-- and the DROP FUNCTION below only removes the old 3-argument overload so
-- PostgREST doesn't end up with two ambiguous match_standards() signatures.

-- Grade metadata columns. Nullable — rows without grade info (Common Core,
-- Custom uploads, un-coded NGSS front-matter chunks) are simply untagged and
-- are unaffected by the grade_band filter below.
alter table standards add column if not exists grade_level text;
alter table standards add column if not exists grade_band  text;

drop function if exists match_standards(vector(1536), text, int);

create or replace function match_standards (
  query_embedding vector(1536),
  match_framework text,
  match_count int default 5,
  match_grade_band text default null
)
returns table (
  id uuid,
  framework text,
  standard_code text,
  title text,
  grade_level text,
  grade_band text,
  content text,
  similarity float
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
    -- a no-op when either side has no grade info, so untagged content
    -- (Common Core, Custom, un-coded NGSS chunks) never gets excluded.
    and (
      match_grade_band is null
      or standards.grade_band is null
      or standards.grade_band = match_grade_band
    )
  order by standards.embedding <=> query_embedding
  limit match_count;
$$;

-- Optional but recommended: speeds up nearest-neighbour search as the table grows.
create index if not exists standards_embedding_idx
  on standards
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
