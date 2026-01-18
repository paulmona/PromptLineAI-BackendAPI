-- Create ingest_keys table for org-scoped ingestion keys.
-- Stores only a hash (HMAC-SHA256 with server-side pepper), never the raw key.

CREATE TABLE IF NOT EXISTS public.ingest_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  name text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  revoked_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS ingest_keys_key_hash_uq
  ON public.ingest_keys (key_hash);

CREATE INDEX IF NOT EXISTS ingest_keys_org_id_idx
  ON public.ingest_keys (org_id);

CREATE INDEX IF NOT EXISTS ingest_keys_revoked_at_idx
  ON public.ingest_keys (revoked_at)
  WHERE revoked_at IS NOT NULL;

