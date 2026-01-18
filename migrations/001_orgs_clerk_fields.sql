-- Add Clerk mapping + slug routing fields to orgs.
-- Idempotent: checks for column/index existence before adding.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orgs' AND column_name = 'external_org_id'
  ) THEN
    ALTER TABLE public.orgs ADD COLUMN external_org_id text;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS orgs_external_org_id_uq
  ON public.orgs (external_org_id)
  WHERE external_org_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orgs' AND column_name = 'slug'
  ) THEN
    ALTER TABLE public.orgs ADD COLUMN slug text;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS orgs_slug_uq
  ON public.orgs (lower(slug))
  WHERE slug IS NOT NULL;

