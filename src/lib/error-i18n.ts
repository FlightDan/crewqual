type Translator = (key: string, values?: Record<string, string | number>) => string;

type ErrorWithCode = Error & { code?: string; status?: number };

/** Convert stable service error codes to UI messages without translating business data. */
export function localizeError(
  reason: unknown,
  t: Translator,
  fallbackKey = "errors.remote",
): string {
  const error = reason as ErrorWithCode | null;
  const code = error?.code;
  if (code === "NOT_FOUND" || error?.status === 404) return t("errors.notFound");
  if (code === "VALIDATION_ERROR" || error?.status === 422) return t("errors.validation");
  if (code === "CONFLICT" || error?.status === 409) return t("errors.conflict");
  if (
    code === "FORBIDDEN" ||
    code === "UNAUTHORIZED" ||
    error?.status === 401 ||
    error?.status === 403
  )
    return t("errors.unauthorized");
  if (code === "RATE_LIMITED" || error?.status === 429) return t("errors.rateLimited");
  if (error?.name === "AbortError" || code === "NETWORK_ERROR") return t("errors.network");
  if (error instanceof Error && error.message && !/[一-龥]/.test(error.message))
    return error.message;
  return t(fallbackKey);
}
