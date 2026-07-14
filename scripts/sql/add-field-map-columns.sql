-- Adds teacher-reviewable field-mapping storage to custom_templates
-- (Phase 5 — additive only; does not touch placeholders/
-- recognized_placeholders/unrecognized_placeholders/structured_fields/
-- detected_sections/section_detection_status/section_detection_error/
-- detected_layout/layout_detection_status/layout_detection_error, which
-- the existing generation/export/section-detection/layout-detection
-- pipelines still use unchanged). See buildFieldMap in
-- api/custom-templates.js.
--
-- field_map shape:
--   {
--     "version": 1,
--     "regions": [
--       {
--         "id": "table_1_row_3_cell_1_unit_0",
--         "order": 1,
--         "role": "heading" | "instruction" | "editable_field" | "blank" | "checkbox_group",
--         "text": "Knowledge of students to inform teaching",
--         "source": "explicit" | "implicit",
--         "outputMode": "text" | "single_select" | "multi_select",  -- editable_field/checkbox_group only
--         "checkboxOptions": ["Option A", "Option B"],               -- checkbox_group only
--         "contextLabel": "Knowledge of students to inform teaching",
--         "contextInstruction": "Describe what you know about students...",
--         "tableId": "table_1", "rowId": "table_1_row_3", "cellId": "table_1_row_3_cell_1"
--       }
--     ],
--     "mappings": [
--       {
--         "regionId": "table_1_row_4_cell_1_unit_0",
--         "target": "learner_background",
--         "customLabel": null,
--         "suggestedTarget": "learner_background",
--         "suggestedConfidence": 0.75,
--         "status": "ready" | "needs_review" | "manual_entry" | "leave_blank"
--       }
--     ],
--     "confirmed": false
--   }
--
-- mappings exist ONLY for editable_field/checkbox_group regions — headings
-- and instructions are never mapping targets. Editing any mapping after
-- confirmation resets confirmed back to false (enforced client-side/API,
-- not by the database).
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + the UPDATE below are both
-- idempotent. No NOT NULL constraint, consistent with detected_sections/
-- detected_layout — the frontend/backend both already tolerate a missing/
-- null value and retry without these columns if this migration hasn't
-- been run yet.

alter table custom_templates
  add column if not exists field_map jsonb default '{"version":1,"regions":[],"mappings":[],"confirmed":false}'::jsonb;

alter table custom_templates
  add column if not exists field_map_status text;

alter table custom_templates
  add column if not exists field_map_error text;

update custom_templates
set field_map = '{"version":1,"regions":[],"mappings":[],"confirmed":false}'::jsonb
where field_map is null;

-- Verify afterwards:
-- select id, name, field_map_status, field_map from custom_templates order by created_at desc;
