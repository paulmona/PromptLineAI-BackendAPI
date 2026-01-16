import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import env from '../env.js';
import logger from '../logger.js';
import * as schema from './schema.js';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

pool.on('error', (err) => {
  logger.error({ err, host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME }, 'Unexpected database pool error');
});

pool.on('connect', (client) => {
  logger.debug({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME }, 'New database client connected');
});

pool.on('acquire', (client) => {
  logger.debug('Database client acquired from pool');
});

pool.on('remove', (client) => {
  logger.debug('Database client removed from pool');
});

export const db = drizzle(pool, { schema });

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    logger.debug({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME }, 'Checking database connection');
    await pool.query('SELECT 1');
    logger.info({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME }, 'Database connection successful');
    return true;
  } catch (err) {
    logger.error(
      { err, host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME, user: env.DB_USER },
      'Database connection check failed'
    );
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
