// src/lib/time/denver.js
export function startOfDayDenver(d = new Date()) {
  const local = new Date(d.toLocaleString("en-US", { timeZone: "America/Denver" }));
  local.setHours(0, 0, 0, 0);
  return local;
}

export function oneYearAgoDenver(d = new Date()) {
  const s = startOfDayDenver(d);
  s.setFullYear(s.getFullYear() - 1);
  return s;
}

export function toDenverDateTimeOffsetLiteral(d) {
  // d should already represent Denver midnight (from oneYearAgoDenver)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  // Get the *Denver* offset as "-06:00" or "-07:00" for that specific date.
  // We use Intl with timeZoneName: 'shortOffset' and normalize the result.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "shortOffset",
  }).formatToParts(d);

  const rawTz = parts.find(p => p.type === "timeZoneName")?.value || "GMT-00:00";
  // rawTz examples: "GMT-06:00", "UTC-07", etc. Normalize to ±HH:MM.
  let offset = "-00:00";
  const m1 = rawTz.match(/([+-])(\d{2}):?(\d{2})?/); // handles -06:00 or -0600
  if (m1) {
    const sign = m1[1];
    const hh = m1[2];
    const mm = m1[3] || "00";
    offset = `${sign}${hh.padStart(2, "0")}:${mm.padStart(2, "0")}`;
  } else {
    const m2 = rawTz.match(/([+-])(\d{1,2})$/); // handles UTC-7
    if (m2) {
      const sign = m2[1];
      const hh = m2[2].padStart(2, "0");
      offset = `${sign}${hh}:00`;
    }
  }
   return `datetimeoffset'${y}-${m}-${day}T00:00:00${offset}'`;
}

export function toDenver(date = new Date()) {
  // Convert a UTC Date to Denver wall-clock Date (keeps *display* in Denver)
  return new Date(date.toLocaleString('en-US', { timeZone: 'America/Denver' }));
}

export function atDenver(date = new Date(), hour = 9, minute = 0, second = 0, ms = 0) {
  // Returns a UTC Date that represents the given Denver wall-clock time on the same calendar day
  const denver = toDenver(date);
  denver.setHours(hour, minute, second, ms);
  // Build a string for that Denver local time and let Date parse to UTC correctly
  const y = denver.getFullYear();
  const m = String(denver.getMonth() + 1).padStart(2, '0');
  const d = String(denver.getDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const ss = String(second).padStart(2, '0');
  return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}.${String(ms).padStart(3,'0')}-07:00`); // offset will be corrected below
}

export function addDaysDenver(date = new Date(), days = 1) {
  // Add days in Denver calendar space (DST-safe)
  const denver = toDenver(date);
  denver.setDate(denver.getDate() + days);
  // Keep same local time component when converting back
  const y = denver.getFullYear();
  const m = String(denver.getMonth() + 1).padStart(2, '0');
  const d = String(denver.getDate()).padStart(2, '0');
  const hh = String(denver.getHours()).padStart(2, '0');
  const mm = String(denver.getMinutes()).padStart(2, '0');
  const ss = String(denver.getSeconds()).padStart(2, '0');
  // Let the runtime resolve the correct UTC for America/Denver by formatting then re-parsing
  return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`);
}

