import { toApiError } from '@/api/client';
import type { Strings } from '@/i18n/ar';

/** A friendly, localized message for any API failure (falls back to a generic sentence). */
export function apiErrorMessage(s: Strings, e: unknown): string {
  const err = toApiError(e);
  const table = s.remote.errors as Record<string, string>;
  return table[String(err.code)] ?? (err.status >= 500 ? table.generic : table.generic);
}

export function apiErrorCode(e: unknown): string {
  return String(toApiError(e).code);
}
