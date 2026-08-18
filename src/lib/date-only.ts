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

export function isDateOnlyExpired(
  value: Date | null | undefined,
  timezone: string,
  now = new Date(),
) {
  if (!value) return false;
  return value.toISOString().slice(0, 10) < dateOnlyForTimezone(now, timezone);
}
