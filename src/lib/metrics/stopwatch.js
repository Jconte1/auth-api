// src/lib/metrics/stopwatch.js
export function createStopwatch(label = "") {
  const start = process.hrtime.bigint();
  let last = start;

  const ms = (from, to) => Number(to - from) / 1_000_000;

  return {
    lap(name) {
      const now = process.hrtime.bigint();
      const delta = ms(last, now);
      last = now;
      if (label) console.log(`[timing] ${label} :: ${name}: ${delta.toFixed(1)} ms`);
      return delta;
    },
    total() {
      const now = process.hrtime.bigint();
      const totalMs = ms(start, now);
      if (label) console.log(`[timing] ${label} :: total: ${totalMs.toFixed(1)} ms`);
      return totalMs;
    },
  };
}
