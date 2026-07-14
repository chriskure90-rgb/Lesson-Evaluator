-- Adds layout-recognition storage to custom_templates (Phase 3 — additive
-- only; does not touch placeholders/recognized_placeholders/
-- unrecognized_placeholders/structured_fields/detected_sections/
-- section_detection_status/section_detection_error, which the existing
-- generation/export/section-detection pipelines still use unchanged). See
-- detectTemplateLayout in api/custom-templates.js.
--
-- detected_layout shape:
--   {
--     "version": 1,
--     "sourceType": "docx" | "pdf",
--     "tables": [
--       {
--         "id": "table_1", "order": 1,
--         "rows": [
--           {
--             "id": "table_1_row_1", "order": 1,
--             "cells": [
--               {
--                 "id": "table_1_row_1_cell_1", "order": 1,
--                 "colspan": 2, "rowspan": 1,
--                 "labels": ["Teacher", "Grade", "School"],
--                 -- Parallel to labels (same index/length) — the exact
--                 -- DetectedSectionItem.id each label matched, or null if
--                 -- unmatched. Never normalizedKey (see mapSectionsToLayout).
--                 "sectionIds": ["metadata_1", "metadata_2", "metadata_3"]
--               }
--             ]
--           }
--         ]
--       }
--     ],
--     -- detected_sections item ids matched to no cell anywhere above.
--     "unmatchedSectionIds": []
--   }
--
-- PDF templates get sourceType: "pdf", tables: [] and
-- layout_detection_status = 'unsupported' — full PDF layout recognition is
-- out of scope for this phase; PDF section-detection itself is unchanged.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + the UPDATE below are both
-- idempotent. No NOT NULL constraint, consistent with detected_sections —
-- the frontend/backend both already tolerate a missing/null value and
-- retry without these columns if this migration hasn't been run yet.

alter table custom_templates
  add column if not exists detected_layout jsonb default '{"version":1,"sourceType":"docx","tables":[],"unmatchedSectionIds":[]}'::jsonb;

alter table custom_templates
  add column if not exists layout_detection_status text;

alter table custom_templates
  add column if not exists layout_detection_error text;

update custom_templates
set detected_layout = '{"version":1,"sourceType":"docx","tables":[],"unmatchedSectionIds":[]}'::jsonb
where detected_layout is null;

-- Verify afterwards:
-- select id, name, layout_detection_status, detected_layout from custom_templates order by created_at desc;
