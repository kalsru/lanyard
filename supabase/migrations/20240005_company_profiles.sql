CREATE TABLE IF NOT EXISTS public.company_profiles (
  domain        text PRIMARY KEY,
  name          text,
  description   text,
  industry      text,
  hq            text,
  size          text,
  logo_url      text,
  website_url   text,
  fetched_at    timestamptz DEFAULT now()
);

ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read company profiles"
  ON public.company_profiles FOR SELECT TO authenticated USING (true);
