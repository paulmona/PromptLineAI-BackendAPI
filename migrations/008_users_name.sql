-- Add display name to users (populated from Clerk on create or via backfill).
ALTER TABLE users ADD COLUMN IF NOT EXISTS name text;
