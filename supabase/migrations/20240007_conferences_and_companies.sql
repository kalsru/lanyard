-- ── Companies (normalized, keyed by domain) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.companies (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  domain          text UNIQUE,
  name            text,
  description     text,
  industry        text,
  sic_code        text,
  sic_description text,
  revenue         text,
  employee_count  text,
  founded_year    text,
  hq              text,
  logo_url        text,
  website_url     text,
  fetched_at      timestamptz,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read companies"
  ON public.companies FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage companies"
  ON public.companies FOR ALL TO service_role USING (true);

-- ── Conferences (one row per event, owned by the user who imported it) ─────────
CREATE TABLE IF NOT EXISTS public.conferences (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name       text NOT NULL,
  url        text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.conferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own conferences"
  ON public.conferences FOR ALL TO authenticated USING (auth.uid() = user_id);

-- ── Extend attendees with foreign keys ────────────────────────────────────────
ALTER TABLE public.attendees
  ADD COLUMN IF NOT EXISTS conference_id uuid REFERENCES public.conferences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id    uuid REFERENCES public.companies(id)    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS attendees_conference_id_idx ON public.attendees(conference_id);
CREATE INDEX IF NOT EXISTS attendees_company_id_idx    ON public.attendees(company_id);
