-- Add policy_config JSONB column to orgs table
ALTER TABLE public.orgs
ADD COLUMN IF NOT EXISTS policy_config jsonb DEFAULT '{
  "llms": {
    "chatgpt": true,
    "gemini": true
  },
  "fileUpload": {
    "logFileNames": true
  }
}'::jsonb;

-- Create GIN index for efficient JSONB queries (optional, for future filtering)
CREATE INDEX IF NOT EXISTS orgs_policy_config_idx ON public.orgs USING GIN (policy_config);
