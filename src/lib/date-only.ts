export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Shanghai";

export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Decode a database DATE without interpreting its UTC carrier as a local instant. */
export function databaseDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value;
  return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
}

export function dateOnlyDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(0);
  parsed.setUTCFullYear(year!, month! - 1, day!);
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
    ? parsed.getTime()
    : Number.NaN;
}

export function dateOnlyForTimezone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

/** Calendar-day difference; DST does not make a day 23 or 25 hours here. */
export function qualificationDaysRemaining(expiresOn: string, now: Date, timezone: string) {
  const expiryDay = dateOnlyDay(expiresOn);
  if (!Number.isFinite(expiryDay)) {
    throw new Error(`Invalid qualification expiry date: ${expiresOn}`);
  }
  return Math.round((expiryDay - dateOnlyDay(dateOnlyForTimezone(now, timezone))) / 86_400_000);
}

export function isDateOnlyExpired(
  value: Date | null | undefined,
  timezone: string,
  now = new Date(),
) {
  if (!value) return false;
  return value.toISOString().slice(0, 10) < dateOnlyForTimezone(now, timezone);
}

export const BUSINESS_TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "America/Los_Angeles",
  "UTC",
] as const;
