/**
 * Endpoint coverage tracking for OpenAPI spec compliance.
 * Records which endpoints have been tested and reports coverage gaps.
 */

interface EndpointTest {
  method: string;
  path: string;
  testFile: string;
  testName: string;
}

interface CoverageReport {
  tested: EndpointTest[];
  untested: Array<{ method: string; path: string }>;
  coverage: number;
}

// Global storage for recorded tests
const testedEndpoints: EndpointTest[] = [];

// Known endpoints from OpenAPI spec
const specEndpoints = [
  { method: 'GET', path: '/healthz' },
  { method: 'GET', path: '/me' },
  { method: 'POST', path: '/ingest' },
  { method: 'GET', path: '/summary' },
  { method: 'GET', path: '/config' },
  { method: 'GET', path: '/admin/orgs' },
  { method: 'GET', path: '/admin/orgs/{orgId}' },
  { method: 'DELETE', path: '/admin/orgs/{orgId}' },
  { method: 'POST', path: '/admin/orgs/{orgId}/revoke-ingest-keys' },
];

/**
 * Record that an endpoint has been tested.
 * Call this in your test to track coverage.
 */
export function recordEndpointTest(
  method: string,
  path: string,
  testFile: string,
  testName: string
): void {
  // Normalize path (replace UUIDs with {orgId} placeholder)
  const normalizedPath = path.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '/{orgId}'
  );

  testedEndpoints.push({
    method: method.toUpperCase(),
    path: normalizedPath,
    testFile,
    testName,
  });
}

/**
 * Get the coverage report showing tested and untested endpoints.
 */
export function getCoverageReport(): CoverageReport {
  const testedSet = new Set(
    testedEndpoints.map((e) => `${e.method} ${e.path}`)
  );

  const untested = specEndpoints.filter(
    (e) => !testedSet.has(`${e.method} ${e.path}`)
  );

  const coverage =
    specEndpoints.length > 0
      ? ((specEndpoints.length - untested.length) / specEndpoints.length) * 100
      : 100;

  return {
    tested: testedEndpoints,
    untested,
    coverage: Math.round(coverage * 10) / 10,
  };
}

/**
 * Print coverage report to console.
 * Call this in globalTeardown.
 */
export function printCoverageReport(): void {
  const report = getCoverageReport();

  console.log('\n' + '='.repeat(60));
  console.log('ENDPOINT COVERAGE REPORT');
  console.log('='.repeat(60));
  console.log(`Coverage: ${report.coverage}% (${specEndpoints.length - report.untested.length}/${specEndpoints.length} endpoints)`);

  if (report.untested.length > 0) {
    console.log('\n❌ UNTESTED ENDPOINTS:');
    report.untested.forEach((e) => {
      console.log(`   ${e.method} ${e.path}`);
    });
  }

  if (report.tested.length > 0) {
    console.log('\n✅ TESTED ENDPOINTS:');
    const grouped = new Map<string, string[]>();
    report.tested.forEach((e) => {
      const key = `${e.method} ${e.path}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(`${e.testFile}: ${e.testName}`);
    });

    grouped.forEach((tests, endpoint) => {
      console.log(`   ${endpoint} (${tests.length} tests)`);
    });
  }

  console.log('='.repeat(60) + '\n');
}

/**
 * Reset coverage data (useful for test isolation).
 */
export function resetCoverage(): void {
  testedEndpoints.length = 0;
}

/**
 * Get the list of spec endpoints (for coverage test).
 */
export function getSpecEndpoints(): Array<{ method: string; path: string }> {
  return [...specEndpoints];
}
