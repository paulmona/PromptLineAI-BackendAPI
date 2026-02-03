/**
 * OpenAPI validation utilities for contract testing.
 * Validates responses against the OpenAPI spec.
 */
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, PathOperation>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

interface PathOperation {
  operationId?: string;
  responses: Record<string, ResponseSpec>;
  requestBody?: { content: Record<string, { schema: unknown }> };
  parameters?: Array<{ name: string; in: string; schema: unknown }>;
}

interface ResponseSpec {
  description: string;
  content?: Record<string, { schema: unknown }>;
}

let cachedSpec: OpenAPISpec | null = null;
let ajv: Ajv | null = null;

/**
 * Load and parse the OpenAPI spec.
 * Throws if the spec is invalid or missing.
 */
export function loadOpenAPISpec(): OpenAPISpec {
  if (cachedSpec) {
    return cachedSpec;
  }

  const specPath = join(process.cwd(), 'openapi.yaml');

  try {
    const content = readFileSync(specPath, 'utf-8');
    cachedSpec = parse(content) as OpenAPISpec;

    // Basic validation
    if (!cachedSpec.openapi || !cachedSpec.paths) {
      throw new Error('Invalid OpenAPI spec: missing required fields');
    }

    return cachedSpec;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`OpenAPI spec not found at ${specPath}`);
    }
    throw error;
  }
}

/**
 * Get AJV instance with OpenAPI schemas registered.
 */
function getAjv(): Ajv {
  if (ajv) {
    return ajv;
  }

  ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  // Register component schemas
  const spec = loadOpenAPISpec();
  if (spec.components?.schemas) {
    Object.entries(spec.components.schemas).forEach(([name, schema]) => {
      ajv!.addSchema(schema, `#/components/schemas/${name}`);
    });
  }

  return ajv;
}

/**
 * Resolve a $ref to its schema.
 */
function resolveRef(ref: string, spec: OpenAPISpec): unknown {
  const parts = ref.replace('#/', '').split('/');
  let current: unknown = spec;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      throw new Error(`Cannot resolve ref: ${ref}`);
    }
  }

  return current;
}

/**
 * Normalize a request path to match OpenAPI spec paths.
 * Replaces dynamic segments (UUIDs, numeric IDs) with their parameter names from the spec.
 *
 * Example: /admin/orgs/abc-123-uuid -> /admin/orgs/{orgId}
 */
function normalizePathToSpec(requestPath: string, spec: OpenAPISpec): string | null {
  // First check if it's an exact match
  if (spec.paths[requestPath]) {
    return requestPath;
  }

  // UUID pattern for dynamic segments
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const numericPattern = /^\d+$/;

  const requestSegments = requestPath.split('/');

  // Try to match against each spec path
  for (const specPath of Object.keys(spec.paths)) {
    const specSegments = specPath.split('/');

    // Must have same number of segments
    if (specSegments.length !== requestSegments.length) {
      continue;
    }

    // Check if all segments match
    let isMatch = true;
    for (let i = 0; i < specSegments.length; i++) {
      const specSeg = specSegments[i];
      const reqSeg = requestSegments[i];

      // Exact match
      if (specSeg === reqSeg) {
        continue;
      }

      // Path parameter match (e.g., {orgId} matches a UUID or numeric ID)
      if (specSeg.startsWith('{') && specSeg.endsWith('}')) {
        if (uuidPattern.test(reqSeg) || numericPattern.test(reqSeg)) {
          continue;
        }
      }

      // No match
      isMatch = false;
      break;
    }

    if (isMatch) {
      return specPath;
    }
  }

  return null;
}

/**
 * Get the response schema for a given endpoint and status code.
 */
export function getResponseSchema(
  method: string,
  path: string,
  statusCode: number
): unknown | null {
  const spec = loadOpenAPISpec();

  // Normalize path to match OpenAPI spec format
  const normalizedPath = normalizePathToSpec(path, spec);
  if (!normalizedPath) {
    return null;
  }

  const pathSpec = spec.paths[normalizedPath];
  if (!pathSpec) {
    return null;
  }

  const operation = pathSpec[method.toLowerCase()];
  if (!operation) {
    return null;
  }

  const response = operation.responses[String(statusCode)] || operation.responses['default'];
  if (!response?.content?.['application/json']?.schema) {
    return null;
  }

  let schema = response.content['application/json'].schema;

  // Resolve $ref if present
  if (schema && typeof schema === 'object' && '$ref' in schema) {
    schema = resolveRef((schema as { $ref: string }).$ref, spec);
  }

  return schema;
}

/**
 * Validate a response body against the OpenAPI spec.
 * Returns { valid: true } or { valid: false, errors: [...] }
 */
export function validateResponse(
  method: string,
  path: string,
  statusCode: number,
  body: unknown
): { valid: boolean; errors?: string[] } {
  const schema = getResponseSchema(method, path, statusCode);

  if (!schema) {
    // No schema defined for this response - consider valid
    return { valid: true };
  }

  const validator = getAjv();
  const validate = validator.compile(schema as object);
  const valid = validate(body);

  if (!valid && validate.errors) {
    return {
      valid: false,
      errors: validate.errors.map(
        (e) => `${e.instancePath || '/'}: ${e.message}`
      ),
    };
  }

  return { valid: true };
}

/**
 * Get all endpoints defined in the OpenAPI spec.
 */
export function getSpecEndpoints(): Array<{ method: string; path: string; operationId?: string }> {
  const spec = loadOpenAPISpec();
  const endpoints: Array<{ method: string; path: string; operationId?: string }> = [];

  Object.entries(spec.paths).forEach(([path, methods]) => {
    Object.entries(methods).forEach(([method, operation]) => {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        endpoints.push({
          method: method.toUpperCase(),
          path,
          operationId: (operation as PathOperation).operationId,
        });
      }
    });
  });

  return endpoints;
}

/**
 * Validate that the OpenAPI spec is valid (fail-fast check).
 * Call this in globalSetup.
 */
export function validateOpenAPISpec(): void {
  const spec = loadOpenAPISpec();

  // Check required fields
  if (!spec.openapi.startsWith('3.')) {
    throw new Error(`Unsupported OpenAPI version: ${spec.openapi}`);
  }

  if (Object.keys(spec.paths).length === 0) {
    throw new Error('OpenAPI spec has no paths defined');
  }

  // Validate all schemas can be compiled
  const validator = getAjv();
  if (spec.components?.schemas) {
    Object.entries(spec.components.schemas).forEach(([name, schema]) => {
      try {
        validator.compile(schema as object);
      } catch (error) {
        throw new Error(`Invalid schema '${name}': ${(error as Error).message}`);
      }
    });
  }
}
