-- One-off backfill: populates grade_level / grade_band on existing NGSS rows
-- in `standards`, inferred from the standard_code prefix. Only touches rows
-- where framework = 'NGSS' and standard_code is not null — Common Core,
-- Custom uploads, and un-coded NGSS front-matter chunks are left untouched.
--
-- Safe to re-run: it recomputes both columns from standard_code every time
-- rather than accumulating, so re-running just confirms the same result.
--
-- Mapping (as specified):
--   K-*  -> grade_level='K',  grade_band='K'
--   1-*  -> grade_level='1',  grade_band='1-2'
--   2-*  -> grade_level='2',  grade_band='1-2'
--   3-*  -> grade_level='3',  grade_band='3-5'
--   4-*  -> grade_level='4',  grade_band='3-5'
--   5-*  -> grade_level='5',  grade_band='3-5'
--   MS-* -> grade_level='MS', grade_band='6-8'
--   HS-* -> grade_level='HS', grade_band='9-12'
--
-- One deviation, found while inspecting the real data: NGSS has 6 elementary
-- engineering-design codes (K-2-ETS1-1/2/3) that explicitly span BOTH the K
-- band and the 1-2 band — there's no single band in the mapping above that
-- fits. The CASE below matches 'K-2-%' *before* 'K-%' (otherwise these would
-- be mis-tagged as K-only and wrongly excluded from a 1-2 grade-band search)
-- and leaves grade_band NULL for them — same treatment as any other untagged
-- row: it stays visible to every grade-band search instead of being
-- incorrectly pinned to just one band. grade_level is still recorded as
-- 'K-2' for transparency. The 3-5-ETS1-* codes need no special case; they
-- already collapse cleanly into the existing '3-5' band.

update standards
set
  grade_level = case
    when standard_code like 'K-2-%' then 'K-2'
    when standard_code like 'K-%'   then 'K'
    when standard_code like '1-%'   then '1'
    when standard_code like '2-%'   then '2'
    when standard_code like '3-%'   then '3'
    when standard_code like '4-%'   then '4'
    when standard_code like '5-%'   then '5'
    when standard_code like 'MS-%'  then 'MS'
    when standard_code like 'HS-%'  then 'HS'
    else null
  end,
  grade_band = case
    when standard_code like 'K-2-%' then null   -- spans K and 1-2 — see note above
    when standard_code like 'K-%'   then 'K'
    when standard_code like '1-%'   then '1-2'
    when standard_code like '2-%'   then '1-2'
    when standard_code like '3-%'   then '3-5'
    when standard_code like '4-%'   then '3-5'
    when standard_code like '5-%'   then '3-5'
    when standard_code like 'MS-%'  then '6-8'
    when standard_code like 'HS-%'  then '9-12'
    else null
  end
where framework = 'NGSS'
  and standard_code is not null;

-- Verify afterwards:
-- select grade_band, count(*) from standards where framework = 'NGSS' group by grade_band order by grade_band;
