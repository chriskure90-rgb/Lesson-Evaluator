-- Follow-up backfill: tags the remaining NGSS rows that have NO standard_code
-- but whose title has an unambiguous single-grade prefix (K., 1., 2., 3., 4.,
-- 5., MS., HS.). standard_code remains the source of truth for every row
-- that has one (see backfill-ngss-grade-metadata.sql) — this script only
-- ever touches rows where standard_code IS NULL.
--
-- Deliberately conservative:
--   * Matches the title PREFIX only (`title like 'K.%'`, not a substring
--     search), so it can't fire on unrelated text that merely mentions a
--     grade somewhere in the paragraph.
--   * Does NOT infer anything from general paragraph/content text.
--   * Does NOT tag multi-grade-spanning titles ("K-2.Engineering Design",
--     "3-5.OA Operations...") — 'K.%' doesn't match "K-2...." (next char is
--     '-', not '.'), and '3.%' doesn't match "3-5...." for the same reason,
--     so those stay NULL automatically, same as any other ambiguous row.
--   * Any title that doesn't start with exactly one of the 8 listed
--     prefixes (e.g. a stray "7.RP.A.2 ..." Common-Core-looking heading
--     that leaked into an NGSS row's title during PDF import) is left NULL.
--
-- Safe to re-run: recomputes from title every time, only within the
-- standard_code IS NULL subset.

update standards
set
  grade_level = case
    when title like 'K.%'  then 'K'
    when title like '1.%'  then '1'
    when title like '2.%'  then '2'
    when title like '3.%'  then '3'
    when title like '4.%'  then '4'
    when title like '5.%'  then '5'
    when title like 'MS.%' then 'MS'
    when title like 'HS.%' then 'HS'
  end,
  grade_band = case
    when title like 'K.%'  then 'K'
    when title like '1.%'  then '1-2'
    when title like '2.%'  then '1-2'
    when title like '3.%'  then '3-5'
    when title like '4.%'  then '3-5'
    when title like '5.%'  then '3-5'
    when title like 'MS.%' then '6-8'
    when title like 'HS.%' then '9-12'
  end
where framework = 'NGSS'
  and standard_code is null
  and (
    title like 'K.%' or title like '1.%' or title like '2.%' or title like '3.%'
    or title like '4.%' or title like '5.%' or title like 'MS.%' or title like 'HS.%'
  );

-- Verify afterwards:
-- select grade_band, count(*) from standards where framework = 'NGSS' group by grade_band order by grade_band;
-- select count(*) from standards where framework = 'NGSS' and standard_code is null and grade_band is null; -- expect 35
