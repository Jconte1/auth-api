// src/lib/time/businessDays.js
import { startOfDayDenver, toDenver } from './denver';

/**
 * Expect holidays as array of 'YYYY-MM-DD' strings in Denver local calendar.
 * e.g., ['2025-01-01','2025-07-04','2025-11-27', ...]
 */
export function makeHolidaySet(holidayStrings = []) {
  const s = new Set();
  for (const d of holidayStrings) {
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) s.add(d);
  }
  return s;
}

export function denverDayKey(date = new Date()) {
  const d = toDenver(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isWeekendDenver(date = new Date()) {
  const d = toDenver(date);
  const wd = d.getDay(); // 0=Sun, 6=Sat (Denver local)
  return wd === 0 || wd === 6;
}

export function isHolidayDenver(date = new Date(), holidaySet = new Set()) {
  return holidaySet.has(denverDayKey(date));
}

export function isBusinessDayDenver(date = new Date(), holidaySet = new Set()) {
  return !isWeekendDenver(date) && !isHolidayDenver(date, holidaySet);
}

/**
 * Next business day at Denver midnight.
 * includeToday=true: if "date" is a biz day, returns that same day's start-of-day.
 */
export function nextBusinessDayDenver(date = new Date(), holidaySet = new Set(), { includeToday = false } = {}) {
  let d = startOfDayDenver(date);
  if (!includeToday) d = addDaysDenverCalendar(d, 1); // start checking tomorrow by default

  while (!isBusinessDayDenver(d, holidaySet)) {
    d = addDaysDenverCalendar(d, 1);
  }
  return d;
}

/**
 * Previous business day at Denver midnight.
 * includeToday=true: if "date" is a biz day, returns that same day's start-of-day.
 */
export function prevBusinessDayDenver(date = new Date(), holidaySet = new Set(), { includeToday = false } = {}) {
  let d = startOfDayDenver(date);
  if (!includeToday) d = addDaysDenverCalendar(d, -1);

  while (!isBusinessDayDenver(d, holidaySet)) {
    d = addDaysDenverCalendar(d, -1);
  }
  return d;
}

/**
 * Add N *calendar* days in Denver space (DST-safe), then snap to Denver midnight.
 * (Positive or negative n.)
 */
export function addDaysDenverCalendar(date = new Date(), n = 1) {
  const local = toDenver(date);
  local.setDate(local.getDate() + n);
  return startOfDayDenver(local);
}

/**
 * Add N *business* days in Denver space (skip weekends/holidays). N can be negative.
 * Returns Denver midnight of the resulting business day.
 */
export function addBusinessDaysDenver(date = new Date(), n = 1, holidaySet = new Set()) {
  let d = startOfDayDenver(date);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);

  while (remaining > 0) {
    d = addDaysDenverCalendar(d, step);
    if (isBusinessDayDenver(d, holidaySet)) remaining -= 1;
  }
  return d;
}

/**
 * Compute the date that is N business days *before* a given delivery date.
 * Example: for T3, n=3 → the send day.
 */
export function businessDaysBeforeDenver(deliveryDate, n, holidaySet = new Set()) {
  return addBusinessDaysDenver(deliveryDate, -Math.abs(n), holidaySet);
}

/**
 * Calendar-offset helper (for T14/T42).
 * Returns true if TODAY (Denver) is the first business day on/after the exact-offset day.
 *
 * Behavior:
 *  - We compute exact calendar offset day = delivery - offsetDays (calendar).
 *  - If that day is a weekend/holiday, we defer to the next business day.
 *  - We return true iff today == that deferred business day.
 *
 * If you want “don’t defer; only send when exact day is a business day”, pass { defer: false }.
 */
export function shouldSendOnCalendarOffsetToday(deliveryDate, offsetDays, now = new Date(), holidaySet = new Set(), { defer = true } = {}) {
  if (!deliveryDate) return false;

  const exactDay = addDaysDenverCalendar(deliveryDate, -Math.abs(offsetDays));
  const today = startOfDayDenver(now);

  if (!defer) {
    return isBusinessDayDenver(exactDay, holidaySet) && exactDay.getTime() === today.getTime();
  }

  const firstBiz = isBusinessDayDenver(exactDay, holidaySet)
    ? exactDay
    : nextBusinessDayDenver(exactDay, holidaySet, { includeToday: false });

  return firstBiz.getTime() === today.getTime();
}

/**
 * Simple calendar day difference in Denver (delivery - now), in whole days.
 * Positive if delivery is in the future; 0 if today (by Denver calendar); negative if past.
 */
export function daysUntilDenverCalendar(deliveryDate, now = new Date()) {
  if (!deliveryDate) return null;
  const t0 = startOfDayDenver(deliveryDate).getTime();
  const n0 = startOfDayDenver(now).getTime();
  return Math.round((t0 - n0) / (24 * 60 * 60 * 1000));
}
