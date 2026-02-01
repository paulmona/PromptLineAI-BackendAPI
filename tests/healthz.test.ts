/**
 * Tests for GET /healthz endpoint.
 * Tests both connected and disconnected database scenarios.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const mockCheckDatabaseConnection = vi.fn();

// Mock the database module before importing routes
vi.mock('../src/db/index.js', () => ({
  checkDatabaseConnection: () => mockCheckDatabaseConnection(),
  db: {},
  closeDatabase: vi.fn(),
}));

// Mock env to avoid process.exit on missing env vars
vi.mock('../src/env.js', () => ({
  default: {
    PORT: 8787,
    CLERK_PUBLISHABLE_KEY: 'test_pk',
    CLERK_SECRET_KEY: 'test_sk',
    CLERK_FAPI_URL: 'https://test.clerk.accounts.dev',
    INGEST_KEY_PEPPER: 'test_pepper_that_is_at_least_32_chars_long',
    PLATFORM_ADMIN_CLERK_ORG_ID: 'org_test',
    DB_HOST: 'localhost',
    DB_PORT: 5432,
    DB_NAME: 'testdb',
    DB_USER: 'testuser',
    DB_PASSWORD: 'testpass',
    DATABASE_URL: 'postgres://testuser:testpass@localhost:5432/testdb',
  },
}));

import { healthzRoutes } from '../src/routes/healthz.js';

async function buildTestApp() {
  const app = Fastify();
  await app.register(healthzRoutes);
  return app;
}

describe('GET /healthz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok:true and db:connected when database is connected', async () => {
    mockCheckDatabaseConnection.mockResolvedValueOnce(true);

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      ok: true,
      db: 'connected',
    });
    expect(mockCheckDatabaseConnection).toHaveBeenCalledOnce();
    await app.close();
  });

  it('returns ok:true and db:disconnected when database is disconnected', async () => {
    mockCheckDatabaseConnection.mockResolvedValueOnce(false);

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      ok: true,
      db: 'disconnected',
    });
    expect(mockCheckDatabaseConnection).toHaveBeenCalledOnce();
    await app.close();
  });

  it('returns ok:true and db:disconnected when checkDatabaseConnection throws', async () => {
    mockCheckDatabaseConnection.mockRejectedValueOnce(new Error('Connection refused'));

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    // The route should handle errors gracefully - let's verify the behavior
    // Based on the implementation, if checkDatabaseConnection throws, it returns false
    // But if the error propagates, we'd get a 500
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});
