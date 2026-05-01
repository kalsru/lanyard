-- Allow users to update their own attendees (needed for linkedin_url / company_url enrichment)
CREATE POLICY IF NOT EXISTS "Users can update their own attendees"
  ON public.attendees FOR UPDATE
  USING (auth.uid() = user_id);

-- Add enrichment columns if they were not added via earlier migrations or SQL Editor
ALTER TABLE public.attendees ADD COLUMN IF NOT EXISTS linkedin_url text;
ALTER TABLE public.attendees ADD COLUMN IF NOT EXISTS company_url text;
