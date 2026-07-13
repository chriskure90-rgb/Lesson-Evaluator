-- Adds section-recognition storage to custom_templates (Phase 1 — additive
-- only; does not touch placeholders/recognized_placeholders/
-- unrecognized_placeholders/structured_fields, which the existing
-- generation/export pipeline still uses unchanged). See detectTemplateSections
-- in api/custom-templates.js.
--
-- detected_sections shape:
--   {
--     "contentSections": [ { "id", "originalLabel", "normalizedKey", "type",
--                            "order", "confidence", "detectionReason" } ],
--     "metadataFields": [ ... same item shape ... ],
--     "instructionTexts": [ ... same item shape ... ],
--     "confirmed": false,
--     "version": 1
--   }
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + the UPDATE below are both
-- idempotent. No NOT NULL constraint, consistent with structured_fields —
-- the frontend/backend both already tolerate a missing/null value and
-- retry without these columns if this migration hasn't been run yet.

alter table custom_templates
  add column if not exists detected_sections jsonb default '{"contentSections":[],"metadataFields":[],"instructionTexts":[],"confirmed":false,"version":1}'::jsonb;

alter table custom_templates
  add column if not exists section_detection_status text;

alter table custom_templates
  add column if not exists section_detection_error text;

update custom_templates
set detected_sections = '{"contentSections":[],"metadataFields":[],"instructionTexts":[],"confirmed":false,"version":1}'::jsonb
where detected_sections is null;

-- Verify afterwards:
-- select id, name, section_detection_status, detected_sections from custom_templates order by created_at desc;
