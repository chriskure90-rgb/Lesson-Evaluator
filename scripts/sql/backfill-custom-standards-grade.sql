-- Backfills grade_level and grade_band for existing custom-uploaded standards
-- rows where grade_band is currently null.  Only touches rows with
-- source = 'teacher_upload' so system-imported standards (NGSS, Common Core)
-- are never modified.
--
-- This covers the most common state-standard code formats that appear at the
-- start of a content chunk.  Patterns applied in priority order:
--
--   1. CCSS Math:   CCSS.MATH.CONTENT.6.RP.A.1  → grade 6, band 6-8
--   2. CCSS ELA:    CCSS.ELA-LITERACY.RI.5.1     → grade 5, band 3-5
--   3. NGSS:        MS-LS1-6                      → grade MS, band 6-8
--                   3-5-ETS1-1                    → grade 3-5, band 3-5
--                   K-2-ETS1-1                    → grade K-2, band null
--   4. State std:   NC.6.RP.1                     → grade 6, band 6-8
--                   CA.3.NF.A.1                   → grade 3, band 3-5
--                   MA.K.OA.2                     → grade K, band K
--
-- Rows whose content does not start with a recognizable code are left with
-- grade_band = null.  The runtime inferGradeFromContent() fallback in
-- api/generate.js handles them until they are re-uploaded through the new
-- pipeline.
--
-- Safe to re-run: the WHERE clause restricts to rows with grade_band IS NULL,
-- so already-backfilled rows are skipped.

update standards
set
  grade_level = case
    -- CCSS Math
    when content ~ '^CCSS\.MATH\.CONTENT\.([K0-9]+)\.'
      then substring(content from '^CCSS\.MATH\.CONTENT\.([K0-9]+)\.')
    -- CCSS ELA
    when content ~ '^CCSS\.ELA-LITERACY\.[A-Z-]+\.([K0-9]+)\.'
      then (regexp_match(content, '^CCSS\.ELA-LITERACY\.[A-Z-]+\.([K0-9]+)\.'))[1]
    -- NGSS multi-grade K-2
    when content ~ '^K-2-[A-Z]'      then 'K-2'
    -- NGSS multi-grade 3-5
    when content ~ '^3-5-[A-Z]'      then '3-5'
    -- NGSS single-grade
    when content ~ '^MS-[A-Z]'       then 'MS'
    when content ~ '^HS-[A-Z]'       then 'HS'
    when content ~ '^K-[A-Z]'        then 'K'
    when content ~ '^([1-9])-[A-Z]'  then substring(content from '^([1-9])-[A-Z]')
    -- State standards: XX.grade.domain (grade = K or 1-12)
    when content ~ '^[A-Z]{2,3}\.(K|[0-9]{1,2})\.'
      then (regexp_match(content, '^[A-Z]{2,3}\.(K|[0-9]{1,2})\.'))[1]
    else null
  end,

  grade_band = case
    -- CCSS Math
    when content ~ '^CCSS\.MATH\.CONTENT\.(K)\.'            then 'K'
    when content ~ '^CCSS\.MATH\.CONTENT\.([12])\.'         then '1-2'
    when content ~ '^CCSS\.MATH\.CONTENT\.([345])\.'        then '3-5'
    when content ~ '^CCSS\.MATH\.CONTENT\.([678])\.'        then '6-8'
    when content ~ '^CCSS\.MATH\.CONTENT\.([9]|1[0-2])\.'  then '9-12'
    -- CCSS ELA
    when content ~ '^CCSS\.ELA-LITERACY\.[A-Z-]+\.(K)\.'   then 'K'
    when content ~ '^CCSS\.ELA-LITERACY\.[A-Z-]+\.([12])\.' then '1-2'
    when content ~ '^CCSS\.ELA-LITERACY\.[A-Z-]+\.([345])\.' then '3-5'
    when content ~ '^CCSS\.ELA-LITERACY\.[A-Z-]+\.([678])\.' then '6-8'
    when content ~ '^CCSS\.ELA-LITERACY\.[A-Z-]+\.([9]|1[0-2])\.' then '9-12'
    -- NGSS
    when content ~ '^K-2-[A-Z]'      then null    -- spans K and 1-2
    when content ~ '^3-5-[A-Z]'      then '3-5'
    when content ~ '^K-[A-Z]'        then 'K'
    when content ~ '^1-[A-Z]'        then '1-2'
    when content ~ '^2-[A-Z]'        then '1-2'
    when content ~ '^3-[A-Z]'        then '3-5'
    when content ~ '^4-[A-Z]'        then '3-5'
    when content ~ '^5-[A-Z]'        then '3-5'
    when content ~ '^MS-[A-Z]'       then '6-8'
    when content ~ '^HS-[A-Z]'       then '9-12'
    -- State standards
    when content ~ '^[A-Z]{2,3}\.(K)\.'                     then 'K'
    when content ~ '^[A-Z]{2,3}\.([12])\.'                  then '1-2'
    when content ~ '^[A-Z]{2,3}\.([345])\.'                 then '3-5'
    when content ~ '^[A-Z]{2,3}\.([678])\.'                 then '6-8'
    when content ~ '^[A-Z]{2,3}\.([9]|1[0-2])\.'           then '9-12'
    else null
  end

where source = 'teacher_upload'
  and grade_band is null;

-- Verify afterwards:
-- select grade_band, count(*) from standards
--   where source = 'teacher_upload'
--   group by grade_band order by grade_band;
