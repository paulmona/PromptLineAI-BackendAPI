import { z } from 'zod';

// Known event fields per API.md
const knownEventFields = [
  'id',
  'ts',
  'tool',
  'event_type',
  'url_host',
  'file_ext',
  'file_size_kb',
  'file_name',
  'prompt_len_bucket',
  'has_code_block',
  'paste_detected',
] as const;

const aiToolEnum = z.enum(['chatgpt', 'claude', 'gemini', 'grok', 'unknown']);
const aiEventTypeEnum = z.enum(['visit', 'prompt_submit', 'file_selected']);
const promptLenBucketEnum = z.enum(['0-200', '200-1000', '1000+']);

// Tool with fallback to 'unknown' for invalid values
const toolWithFallback = z
  .string()
  .transform((val) => {
    if (['chatgpt', 'claude', 'gemini', 'grok', 'unknown'].includes(val)) {
      return val as 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'unknown';
    }
    return 'unknown';
  });

// Event schema with strict known fields, but allows unknown keys for extra
const eventSchema = z
  .object({
    id: z.string().uuid(),
    ts: z.string().datetime(),
    tool: toolWithFallback,
    event_type: aiEventTypeEnum, // Strict - invalid values cause 400
    url_host: z.string(),
    file_ext: z.string().nullable().optional(),
    file_size_kb: z.number().int().nonnegative().nullable().optional(),
    file_name: z.string().nullable().optional(),
    prompt_len_bucket: promptLenBucketEnum.nullable().optional(),
    has_code_block: z.boolean().nullable().optional(),
    paste_detected: z.boolean().nullable().optional(),
  })
  .passthrough() // Allow unknown keys for extra
  .superRefine((val, ctx) => {
    // Tenant/user attribution must come from auth context, never from client payload.
    // Reject these fields loudly to avoid hard-to-debug situations.
    const forbidden = ['org_id', 'orgId', 'user_id', 'userId'] as const;
    for (const key of forbidden) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is not allowed in event payload`,
        });
      }
    }
  });

export const ingestRequestSchema = z
  .object({
    device_id: z.string().uuid(),
    events: z.array(eventSchema).min(1).max(50),
  })
  .strict();

export type IngestRequest = z.infer<typeof ingestRequestSchema>;
export type EventInput = z.infer<typeof eventSchema>;

/**
 * Separates known fields from unknown fields for an event.
 * Unknown fields are collected into an object for storage in events.extra.
 */
export function separateEventFields(event: EventInput): {
  known: {
    id: string;
    ts: string;
    tool: 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'unknown';
    event_type: 'visit' | 'prompt_submit' | 'file_selected';
    url_host: string;
    file_ext?: string | null;
    file_size_kb?: number | null;
    file_name?: string | null;
    prompt_len_bucket?: '0-200' | '200-1000' | '1000+' | null;
    has_code_block?: boolean | null;
    paste_detected?: boolean | null;
  };
  extra: Record<string, unknown> | null;
} {
  const known: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    if (knownEventFields.includes(key as (typeof knownEventFields)[number])) {
      known[key] = value;
    } else {
      extra[key] = value;
    }
  }

  return {
    known: known as {
      id: string;
      ts: string;
      tool: 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'unknown';
      event_type: 'visit' | 'prompt_submit' | 'file_selected';
      url_host: string;
      file_ext?: string | null;
      file_size_kb?: number | null;
      file_name?: string | null;
      prompt_len_bucket?: '0-200' | '200-1000' | '1000+' | null;
      has_code_block?: boolean | null;
      paste_detected?: boolean | null;
    },
    extra: Object.keys(extra).length > 0 ? extra : null,
  };
}
