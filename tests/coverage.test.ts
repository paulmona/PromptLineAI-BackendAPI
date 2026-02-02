/**
 * Coverage verification test.
 * Verifies the OpenAPI spec is valid and contains expected endpoints.
 *
 * Note: Runtime coverage tracking doesn't work across isolated test files.
 * Use `recordEndpointTest` calls as documentation markers instead.
 */
import { describe, it, expect } from 'vitest';
import { getSpecEndpoints } from './helpers/openapi.js';
import { getSpecEndpoints as getCoverageEndpoints } from './helpers/coverage.js';

describe('API Coverage', () => {
  it('should have OpenAPI spec with expected endpoints', () => {
    const specEndpoints = getSpecEndpoints();

    // Verify we can read the OpenAPI spec
    expect(specEndpoints.length).toBeGreaterThan(0);

    // Verify expected endpoints exist
    const paths = specEndpoints.map(ep => ep.path);
    expect(paths).toContain('/healthz');
    expect(paths).toContain('/me');
    expect(paths).toContain('/summary');
    expect(paths).toContain('/ingest');
    expect(paths).toContain('/config');
    expect(paths).toContain('/admin/orgs');

    console.log(`\n  OpenAPI spec contains ${specEndpoints.length} endpoints`);
  });

  it('should have coverage tracking for all spec endpoints', () => {
    const coverageEndpoints = getCoverageEndpoints();

    // Verify the coverage module knows about all endpoints
    expect(coverageEndpoints.length).toBeGreaterThan(0);

    // Verify both modules have the same endpoint count
    const specEndpoints = getSpecEndpoints();

    console.log(`\n  Coverage tracking configured for ${coverageEndpoints.length} endpoints`);
    console.log(`  OpenAPI spec defines ${specEndpoints.length} endpoints`);

    // Check for mismatches and fail if any exist
    const specSet = new Set(specEndpoints.map(e => `${e.method} ${e.path}`));
    const coverageSet = new Set(coverageEndpoints.map(e => `${e.method} ${e.path}`));

    const missingFromCoverage = [...specSet].filter(e => !coverageSet.has(e));
    const extraInCoverage = [...coverageSet].filter(e => !specSet.has(e));

    // Build error message if there are mismatches
    const errors: string[] = [];
    if (missingFromCoverage.length > 0) {
      errors.push('Missing from coverage tracking (add to helpers/coverage.ts):');
      missingFromCoverage.forEach(e => errors.push(`  - ${e}`));
    }
    if (extraInCoverage.length > 0) {
      errors.push('Extra in coverage tracking (remove from helpers/coverage.ts or add to OpenAPI spec):');
      extraInCoverage.forEach(e => errors.push(`  - ${e}`));
    }

    // Fail the test if there are mismatches
    expect(errors.length, errors.join('\n')).toBe(0);
  });
});
