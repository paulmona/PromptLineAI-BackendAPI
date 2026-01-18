export function getSingleHeaderValue(
  header: string | string[] | undefined
): { ok: true; value: string } | { ok: false; reason: 'missing' | 'multiple' | 'empty' } {
  if (header === undefined) return { ok: false, reason: 'missing' };
  if (Array.isArray(header)) return { ok: false, reason: 'multiple' };
  const trimmed = header.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  return { ok: true, value: trimmed };
}

