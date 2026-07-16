-- Adds soft-delete support to custom_templates.
--
-- Deleting a template no longer physically removes the row — a hard delete
-- either failed outright with a foreign-key violation (lesson_generation_
-- custom_template_id_fkey) whenever any lesson referenced it, or, for a
-- template with no lessons yet, succeeded but would have broken any FUTURE
-- lesson pointing at that id from opening/rendering/exporting/evaluating.
--
-- Instead, deleting sets deleted_at and the row (and its Storage file,
-- deliberately left alone — see handleDelete in api/custom-templates.js)
-- stays in place permanently:
--   - fetchCustomTemplates (src/lib/custom-templates.ts) excludes rows
--     where deleted_at is not null, so a deleted template disappears from
--     "My Templates" and can't be selected for new generation.
--   - fetchCustomTemplateById deliberately does NOT filter on deleted_at,
--     so historical lessons (Library/Evaluator) that already reference a
--     since-deleted template keep opening/rendering/exporting/evaluating
--     exactly as before.
--
-- No RLS changes needed — auth.uid() = user_id ownership is unaffected by
-- this column.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run.

alter table custom_templates
  add column if not exists deleted_at timestamptz;

-- Verify afterwards:
-- select id, name, deleted_at from custom_templates order by created_at desc;
