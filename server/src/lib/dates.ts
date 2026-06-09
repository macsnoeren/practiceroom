const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a date-only string (YYYY-MM-DD) to midnight UTC. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** True if `date` falls on a holiday day (inclusive of the last day). */
export function isWithinHolidays(
  date: Date,
  holidays: { startsOn: Date; endsOn: Date }[],
): boolean {
  return holidays.some((h) => date >= h.startsOn && date.getTime() < h.endsOn.getTime() + DAY_MS);
}

/** The holiday `date` falls in, or null. Returns the first match. */
export function holidayAt<T extends { startsOn: Date; endsOn: Date }>(
  date: Date,
  holidays: T[],
): T | null {
  return (
    holidays.find((h) => date >= h.startsOn && date.getTime() < h.endsOn.getTime() + DAY_MS) ?? null
  );
}
