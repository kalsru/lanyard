ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS revenue        text,
  ADD COLUMN IF NOT EXISTS sic_code       text,
  ADD COLUMN IF NOT EXISTS sic_description text,
  ADD COLUMN IF NOT EXISTS employee_count  text,
  ADD COLUMN IF NOT EXISTS founded_year    text;
