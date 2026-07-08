-- Adds support for teacher-uploaded custom DOCX lesson-plan templates.
--
-- custom_templates stores one row per uploaded .docx, along with the
-- {{PLACEHOLDER}} tokens detected inside it. lesson_generation.custom_template_id
-- links a saved lesson back to the specific custom template it was generated
-- for (only set when template_type = 'custom' — lesson_json itself is still
-- a plain Template1Lesson-shaped object, same as template_type = 'template1').
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor).
-- Safe to re-run: IF NOT EXISTS guards throughout.

create table if not exists custom_templates (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id),
  name                        text not null,
  original_filename           text not null,
  storage_path                text not null,
  placeholders                jsonb not null default '[]'::jsonb,
  recognized_placeholders     jsonb not null default '[]'::jsonb,
  unrecognized_placeholders   jsonb not null default '[]'::jsonb,
  status                      text not null default 'processing', -- 'processing' | 'ready' | 'error'
  error_message               text,
  created_at                  timestamptz not null default now()
);

alter table lesson_generation
  add column if not exists custom_template_id uuid references custom_templates(id);

-- Verify afterwards:
-- select id, name, status, recognized_placeholders, unrecognized_placeholders
-- from custom_templates order by created_at desc;
