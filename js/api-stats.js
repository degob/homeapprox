// API call statistics: every request that really goes to the network is
// counted per hour and endpoint (cache hits are not), kept API_STATS_KEEP_DAYS.
//
//   localStorage homeapprox.apistats = { "2026-10-31T16": { connections: 12, stationboard: 3 } }
//
// summary() → calls per window, per endpoint. Windows count whole hours:
// "24 Stunden" = this hour + the 23 before it.

import { API_STATS_KEEP_DAYS, API_STATS_KEY, MS_PER_DAY, MS_PER_MIN } from "./config.js";

const MS_PER_HOUR = 60 * MS_PER_MIN;
const pad = (n) => String(n).padStart(2, "0");
// Local hour as key, e.g. "2026-10-31T16".
const hourKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;
const hourStart = (key) => {
  const [date, h] = key.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, mo - 1, d, Number(h));
};

const StatWindows = Object.freeze([
  { label: "Diese Stunde", hours: 1 },
  { label: "24 Stunden", hours: 24 },
  { label: "7 Tage", hours: 7 * 24 },
  { label: "30 Tage", hours: 30 * 24 },
  { label: `${API_STATS_KEEP_DAYS} Tage`, hours: API_STATS_KEEP_DAYS * 24 },
]);

export const ApiStats = (() => {
  const load = () => {
    try {
      const m = JSON.parse(localStorage.getItem(API_STATS_KEY));
      return m && typeof m === "object" ? m : {};
    } catch {
      return {};
    }
  };
  const store = (m) => {
    try {
      localStorage.setItem(API_STATS_KEY, JSON.stringify(m));
    } catch {
      // Storage unavailable: calls are just not counted.
    }
  };

  function record(endpoint, now = new Date()) {
    const m = load();
    const minStart = now.getTime() - API_STATS_KEEP_DAYS * MS_PER_DAY;
    Object.keys(m).forEach((k) => hourStart(k).getTime() < minStart && delete m[k]);
    const k = hourKey(now);
    m[k] ||= {};
    m[k][endpoint] = (m[k][endpoint] || 0) + 1;
    store(m);
  }

  //   [{ label, total, byEndpoint: { connections: 12, … } }]
  function summary(now = new Date()) {
    const m = load();
    const thisHour = hourStart(hourKey(now)).getTime();
    return StatWindows.map((w) => {
      const from = thisHour - (w.hours - 1) * MS_PER_HOUR;
      const byEndpoint = {};
      let total = 0;
      Object.entries(m).forEach(([k, counts]) => {
        const at = hourStart(k).getTime();
        if (at >= from && at <= thisHour) {
          Object.entries(counts).forEach(([e, n]) => {
            byEndpoint[e] = (byEndpoint[e] || 0) + n;
            total += n;
          });
        }
      });
      return { label: w.label, total, byEndpoint };
    });
  }

  const reset = () => store({});

  return { record, summary, reset };
})();
