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
