type Bucket = {
  windowStartMs: number;
  count: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function checkRateLimitPerKey(opts: {
  keyHash: string;
  windowMs: number;
  maxRequests: number;
}): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(opts.keyHash);

  if (!existing || now - existing.windowStartMs >= opts.windowMs) {
    buckets.set(opts.keyHash, { windowStartMs: now, count: 1 });
    return { allowed: true };
  }

  if (existing.count >= opts.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((opts.windowMs - (now - existing.windowStartMs)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  existing.count += 1;
  return { allowed: true };
}

