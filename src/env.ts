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
};

function buildDatabaseUrl(env: z.infer<typeof envSchema>): string {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }
  return `postgres://${env.DB_USER}:${encodeURIComponent(env.DB_PASSWORD)}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`;
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
};

export default env;
