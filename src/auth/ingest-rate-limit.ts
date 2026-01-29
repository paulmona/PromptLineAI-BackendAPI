type Bucket = {
  windowStartMs: number;
  count: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Check rate limit for a given identifier (e.g., org ID, user ID, key hash).
 * @param opts.identifier - Unique identifier for rate limiting (e.g., "org:uuid", "user:uuid", or key hash)
 * @param opts.windowMs - Time window in milliseconds
 * @param opts.maxRequests - Maximum requests allowed in the window
 */
export function checkRateLimit(opts: {
  identifier: string;
  windowMs: number;
  maxRequests: number;
}): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(opts.identifier);

  if (!existing || now - existing.windowStartMs >= opts.windowMs) {
    buckets.set(opts.identifier, { windowStartMs: now, count: 1 });
    return { allowed: true };
  }

  if (existing.count >= opts.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((opts.windowMs - (now - existing.windowStartMs)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  existing.count += 1;
  return { allowed: true };
}

/**
 * @deprecated Use checkRateLimit instead. This function is kept for backward compatibility.
 */
export function checkRateLimitPerKey(opts: {
  keyHash: string;
  windowMs: number;
  maxRequests: number;
}): RateLimitResult {
  return checkRateLimit({
    identifier: opts.keyHash,
    windowMs: opts.windowMs,
    maxRequests: opts.maxRequests,
  });
}

