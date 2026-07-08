-- Adds a template_type column to lesson_generation so saved rows record
-- which lesson-plan format produced them ("standard" or "template1").
-- Existing rows are backfilled to "standard" (they all predate Template 1).
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + an idempotent UPDATE.

alter table lesson_generation add column if not exists template_type text;

update lesson_generation
set template_type = 'standard'
where template_type is null;

-- Verify afterwards:
-- select template_type, count(*) from lesson_generation group by template_type;
