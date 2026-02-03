/**
 * Global teardown for Vitest.
 * Runs once after all test files.
 *
 * Note: Runtime coverage tracking doesn't work across isolated test files
 * since each test file runs in a separate process.
 */

export default async function globalTeardown(): Promise<void> {
  console.log('\n[Global Teardown] Test run complete.\n');
}
