/**
 * Global setup for Vitest.
 * Runs once before all test files.
 * Validates the OpenAPI spec to fail fast on schema errors.
 */
import { validateOpenAPISpec, loadOpenAPISpec } from './helpers/openapi.js';

export default async function globalSetup(): Promise<void> {
  console.log('\n[Global Setup] Validating OpenAPI spec...');

  try {
    validateOpenAPISpec();
    const spec = loadOpenAPISpec();
    const pathCount = Object.keys(spec.paths).length;
    console.log(`[Global Setup] OpenAPI spec valid: ${pathCount} paths defined\n`);
  } catch (error) {
    console.error('[Global Setup] OpenAPI spec validation failed:', error);
    throw error;
  }
}
