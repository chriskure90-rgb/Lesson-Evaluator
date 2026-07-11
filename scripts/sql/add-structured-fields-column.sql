-- Adds structured_fields to custom_templates: detected checklist / repeated
-- option-list sections (e.g. a "Teaching Strategy" heading followed by
-- checkbox options like Direct instruction / Group work / Stations), as
-- opposed to the free-narrative sections already captured in
-- placeholders/recognized_placeholders. Each element looks like:
--   { "type": "checklist", "field": "teachingStrategy",
--     "label": "Teaching Strategy", "token": "FIELD_TEACHING_STRATEGY",
--     "options": ["Direct instruction", "Group work", "Stations"] }
-- See detectStructuredFields in api/custom-templates.js.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.

alter table custom_templates
  add column if not exists structured_fields jsonb not null default '[]'::jsonb;

-- Verify afterwards:
-- select id, name, structured_fields from custom_templates order by created_at desc;
