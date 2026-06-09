// Timezone helpers for the project calendar. The Vercel runtime is UTC, so any
// `new Date("YYYY-MM-DDTHH:MM:00")` without an explicit zone is parsed as UTC on
// the server. The site team enters dates/times in the PROJECT's wall-clock
// (e.g. "9am inspection" = 9am at the site), so these helpers convert a zoned
// wall-clock to a UTC Date for storage. Generic over timezone — a per-project tz
// can be passed once projects carry one (see project_soterra_calendar). DST-aware
// via Intl.DateTimeFormat. Ported/generalised from the Montázs budapest helper.

// The project's timezone for now (1 Arthur Road). TODO: read from the project row.
export const PROJECT_TZ = "Pacific/Auckland";

/**
 * Convert a wall-clock date (+ optional time) in `timeZone` to a UTC Date.
 * A null/blank time anchors at 00:00 in the zone (used for all-day items).
 *
 * Example: ("2026-06-16", "13:00", "Pacific/Auckland") in NZST (UTC+12)
 *          → Date for 2026-06-16T01:00:00Z
 */
export function zonedWallClockToUtc(
  date: string,
  time: string | null,
  timeZone: string = PROJECT_TZ
): Date {
  const timeStr = time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  const naive = new Date(`${date}T${timeStr}:00Z`);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(naive);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const mo = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  let h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mi = parts.find((p) => p.type === "minute")?.value ?? "00";
  if (h === "24") h = "00"; // some Intl impls emit "24" for midnight

  const asUtc = new Date(`${y}-${mo}-${d}T${h}:${mi}:00Z`);
  const offsetMs = asUtc.getTime() - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}

/**
 * Build the optional end instant from end date and/or end time. Returns null
 * when neither is given, or when the computed end is not strictly after the
 * start (invalid range — e.g. an end time earlier in the same day). Construction
 * events are daytime, so we don't auto-roll a cross-midnight end; set an end
 * date for genuinely multi-day items.
 */
export function resolveEndsAt(
  startDate: string,
  startTime: string | null,
  endDate: string | null,
  endTime: string | null,
  timeZone: string = PROJECT_TZ
): Date | null {
  const ed = (endDate || "").trim();
  const et = (endTime || "").trim();
  if (!ed && !et) return null;
  const effectiveEndDate = ed || startDate;
  const effectiveEndTime = et || startTime || null;
  const end = zonedWallClockToUtc(effectiveEndDate, effectiveEndTime, timeZone);
  const start = zonedWallClockToUtc(startDate, startTime, timeZone);
  return end.getTime() > start.getTime() ? end : null;
}

/** YYYY-MM-DD for `date` in `timeZone`. */
export function zonedDayKey(date: Date, timeZone: string = PROJECT_TZ): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** The calendar day after `date` (YYYY-MM-DD) — for [start, end) range filters. */
export function addOneDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
