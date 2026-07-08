-- Lets a teacher delete a custom template even if it has already been used
-- to generate saved lessons: the FK on lesson_generation.custom_template_id
-- (added in add-custom-templates-table.sql, with no ON DELETE clause) defaults
-- to Postgres's NO ACTION, so deleting a referenced custom_templates row
-- currently fails with a foreign-key violation. Switching to ON DELETE SET
-- NULL clears the link instead — the saved lesson's lesson_json content is
-- untouched either way, it just stops pointing at a template that no longer
-- exists.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run.

alter table lesson_generation
  drop constraint if exists lesson_generation_custom_template_id_fkey;

alter table lesson_generation
  add constraint lesson_generation_custom_template_id_fkey
  foreign key (custom_template_id) references custom_templates(id) on delete set null;
