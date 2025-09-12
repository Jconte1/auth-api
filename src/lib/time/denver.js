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
