-- Add device_name column to devices table.
-- Idempotent: checks for column existence before adding.
-- Enforces max length 64 characters at database level.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'device_name'
  ) THEN
    ALTER TABLE public.devices ADD COLUMN device_name varchar(64) NOT NULL DEFAULT 'unassigned';
  END IF;
END $$;

-- Backfill existing rows (safety measure, though DEFAULT should handle this)
UPDATE public.devices 
SET device_name = 'unassigned' 
WHERE device_name IS NULL;
