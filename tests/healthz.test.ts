/**
 * Tests for GET /healthz endpoint.
 * Tests both connected and disconnected database scenarios.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mockEnv } from './helpers/setup.js';

const mockCheckDatabaseConnection = vi.fn();

// Mock the database module before importing routes
vi.mock('../src/db/index.js', () => ({
  checkDatabaseConnection: () => mockCheckDatabaseConnection(),
  db: {},
  closeDatabase: vi.fn(),
}));

// Mock env to avoid process.exit on missing env vars
vi.mock('../src/env.js', () => ({
  default: mockEnv,
}));

import { healthzRoutes } from '../src/routes/healthz.js';

describe('GET /healthz', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(healthzRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns ok:true and db:connected when database is connected', async () => {
    mockCheckDatabaseConnection.mockResolvedValueOnce(true);

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
  });

  it('returns ok:true and db:disconnected when database is disconnected', async () => {
    mockCheckDatabaseConnection.mockResolvedValueOnce(false);

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
  });

  it('returns 500 when checkDatabaseConnection throws unexpectedly', async () => {
    mockCheckDatabaseConnection.mockRejectedValueOnce(new Error('Connection refused'));

    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    // Unhandled exception in route handler results in 500
    expect(res.statusCode).toBe(500);
  });
});
