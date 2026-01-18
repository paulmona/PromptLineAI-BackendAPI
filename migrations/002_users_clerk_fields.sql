-- Add Clerk mapping fields to users.
-- Idempotent: checks for column/index existence before adding.
-- NOTE: Run migrations/000_users_introspection.sql first.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'external_uid'
  ) THEN
    ALTER TABLE public.users ADD COLUMN external_uid text;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_external_uid_uq
  ON public.users (external_uid)
  WHERE external_uid IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE public.users ADD COLUMN org_id uuid REFERENCES public.orgs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_org_id_idx
  ON public.users (org_id);

