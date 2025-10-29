// src/lib/time/holidays.js

// --- Hard-coded holiday dates (Denver) ---
// Remainder of 2025
const HOLIDAYS_2025 = [
  '2025-11-27', // Thanksgiving
  '2025-11-28', // Day After Thanksgiving
  '2025-12-24', // Christmas Eve
  '2025-12-25', // Christmas Day
  '2025-12-26', // Day After Christmas
];

// Full year 2026
const HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-05-25', // Memorial Day (last Monday in May)
  '2026-07-04', // Independence Day
  '2026-07-24', // Pioneer Day (UT)
  '2026-09-07', // Labor Day (first Monday in Sep)
  '2026-11-26', // Thanksgiving (4th Thu in Nov)
  '2026-11-27', // Day After Thanksgiving
  '2026-12-24', // Christmas Eve
  '2026-12-25', // Christmas Day
  '2026-12-26', // Day After Christmas
];

export const HOLIDAYS = new Set([
  ...HOLIDAYS_2025,
  ...HOLIDAYS_2026,
]);

// Format a Date as YYYY-MM-DD in *Denver* local time.
function yyyymmddDenver(date = new Date()) {
  const denver = new Date(
    date.toLocaleString('en-US', { timeZone: 'America/Denver' })
  );
  const y = denver.getFullYear();
  const m = String(denver.getMonth() + 1).padStart(2, '0');
  const d = String(denver.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// True if the given date (interpreted in Denver) is one of the holidays above.
export function isHolidayDenver(date = new Date()) {
  return HOLIDAYS.has(yyyymmddDenver(date));
}

// True if the given date (Denver) is a business day (Mon–Fri) AND not a holiday.
export function isBusinessDayDenver(date = new Date()) {
  const denver = new Date(
    date.toLocaleString('en-US', { timeZone: 'America/Denver' })
  );
  const day = denver.getDay(); // 0=Sun .. 6=Sat
  const isWeekend = day === 0 || day === 6;
  return !isWeekend && !isHolidayDenver(date);
}
