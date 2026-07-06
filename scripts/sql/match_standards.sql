-- Enables pgvector cosine-similarity search over the `standards` table,
-- filtered by framework (e.g. "NGSS", "Common Core").
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run: both statements use CREATE OR REPLACE / IF NOT EXISTS.

create or replace function match_standards (
  query_embedding vector(1536),
  match_framework text,
  match_count int default 5
)
returns table (
  id uuid,
  framework text,
  standard_code text,
  title text,
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
    standards.content,
    1 - (standards.embedding <=> query_embedding) as similarity
  from standards
  where standards.framework = match_framework
    and standards.embedding is not null
  order by standards.embedding <=> query_embedding
  limit match_count;
$$;

-- Optional but recommended: speeds up nearest-neighbour search as the table grows.
create index if not exists standards_embedding_idx
  on standards
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
