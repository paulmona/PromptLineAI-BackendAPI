-- Preflight introspection for existing users table.
-- schema.sql references public.users(id) via FKs from devices/events, but the dump doesn't include the table.
-- This script fails fast if users table is missing or incompatible.

DO $$
DECLARE
  table_exists boolean;
  pk_type text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) INTO table_exists;

  IF NOT table_exists THEN
    RAISE EXCEPTION 'users table does not exist in schema public. It is required because devices/events have FKs to public.users(id).';
  END IF;

  SELECT data_type INTO pk_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'id';

  IF pk_type IS NULL THEN
    RAISE EXCEPTION 'users.id column not found';
  END IF;

  IF pk_type <> 'uuid' THEN
    RAISE EXCEPTION 'users.id must be uuid type. Found: %', pk_type;
  END IF;

  RAISE NOTICE 'users table exists and users.id type is uuid.';
END $$;

