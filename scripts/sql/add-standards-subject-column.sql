-- Adds the `subject` column to the standards table.
-- grade_level and grade_band already exist (added by match_standards.sql).
-- Safe to re-run: IF NOT EXISTS is a no-op on columns that are already there.
--
-- Run this once in the Supabase SQL editor before deploying the updated
-- upload-standards-process.js that begins populating it.

alter table standards
  add column if not exists subject text;
