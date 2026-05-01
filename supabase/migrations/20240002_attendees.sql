CREATE TABLE IF NOT EXISTS public.attendees (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  title       text,
  company     text,
  location    text,
  tags        text[]      NOT NULL DEFAULT '{}',
  avatar_url  text,
  source      text,       -- URL or 'screenshot'
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.attendees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own attendees"
  ON public.attendees FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own attendees"
  ON public.attendees FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own attendees"
  ON public.attendees FOR DELETE
  USING (auth.uid() = user_id);
