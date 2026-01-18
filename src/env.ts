import { z } from 'zod';
import { config } from 'dotenv';

// Load .env file
config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  // Clerk (dashboard auth)
  CLERK_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_PUBLISHABLE_KEY is required'),
  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
  // Optional: used by landing page sign-in link (Hosted Pages)
  CLERK_SIGN_IN_URL: z.string().url().optional(),
  CLERK_SIGN_UP_URL: z.string().url().optional(),
  // Optional: Frontend API URL (FAPI) for Clerk.js script loading
  // If not provided, will be extracted from CLERK_SIGN_IN_URL if available
  CLERK_FAPI_URL: z.string().url().optional(),
  // Optional: override where Clerk.js is loaded from (for restricted DNS environments)
  CLERK_JS_URL: z.string().url().optional(),

  // Ingest key hashing pepper (HMAC). Treat as immutable for the POC.
  INGEST_KEY_PEPPER: z.string().min(32, 'INGEST_KEY_PEPPER must be at least 32 characters'),

  DB_HOST: z.string().default('192.168.0.71'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('aicompliance'),
  DB_USER: z.string().default('promptline'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DATABASE_URL: z.string().optional(),
});

type Env = z.infer<typeof envSchema> & {
  DATABASE_URL: string;
  CLERK_FAPI_URL: string;
};

function buildDatabaseUrl(env: z.infer<typeof envSchema>): string {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }
  return `postgres://${env.DB_USER}:${encodeURIComponent(env.DB_PASSWORD)}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`;
}

function extractFapiUrl(env: z.infer<typeof envSchema>): string {
  // If explicitly provided, use it
  if (env.CLERK_FAPI_URL) {
    return env.CLERK_FAPI_URL;
  }
  
  // Try to extract from CLERK_SIGN_IN_URL (format: https://<app>.clerk.accounts.dev/sign-in?...)
  if (env.CLERK_SIGN_IN_URL) {
    try {
      const url = new URL(env.CLERK_SIGN_IN_URL);
      // Extract base URL (e.g., https://your-app.clerk.accounts.dev)
      return `${url.protocol}//${url.host}`;
    } catch {
      // Invalid URL, fall through
    }
  }
  
  // If we can't extract it, we'll need to throw an error or use a fallback
  // For now, throw an error to make it explicit
  throw new Error(
    'CLERK_FAPI_URL is required. Either set CLERK_FAPI_URL environment variable ' +
    'or ensure CLERK_SIGN_IN_URL is set (FAPI URL will be extracted from it). ' +
    'FAPI URL format: https://<your-app>.clerk.accounts.dev'
  );
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.format());
  process.exit(1);
}

const env: Env = {
  ...parsed.data,
  DATABASE_URL: buildDatabaseUrl(parsed.data),
  CLERK_FAPI_URL: extractFapiUrl(parsed.data),
};

export default env;
