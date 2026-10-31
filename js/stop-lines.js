// Lines at stops: which other lines halt where. Learnt for free from loaded
// connections ("seen", partial) and on tap from a departure board ("board").
//
//   localStorage homeapprox.stoplines = {
//     "8503006": { name: "Zürich Oerlikon", boardAt: 1793461380000, updatedAt: …,
//                  lines: { "S9|Schaffhausen": { line: "S9", dir: "Schaffhausen", src: "board" } } } }
//
// Per halt of a ride, the ride's own line excluded:
//   KNOWN    ⇄ n  other lines are known to halt here
//   UNKNOWN  ?    nothing seen and no board asked yet
//   NONE          board asked, no other line
// Boards only show what runs at that moment, so new answers are merged, never
// replacing. Entries are forgotten after STOP_LINES_MAX_DAYS and at the
// timetable change (second Sunday of December).

import { MS_PER_DAY, STOP_LINES_KEY, STOP_LINES_MAX_DAYS } from "./config.js";
import { TransportApi } from "./api.js";

export const LinesState = Object.freeze({ KNOWN: "known", UNKNOWN: "unknown", NONE: "none" });
const Src = Object.freeze({ SEEN: "seen", BOARD: "board" });

// Most recent timetable change at or before `now`: second Sunday of December.
function lastTimetableChange(now = new Date()) {
  const secondSunday = (year) => {
    const d = new Date(year, 11, 1);
    d.setDate(1 + ((7 - d.getDay()) % 7) + 7);
    return d;
  };
  const thisYear = secondSunday(now.getFullYear());
  return thisYear <= now ? thisYear : secondSunday(now.getFullYear() - 1);
}

export const StopLines = (() => {
  // Parsed once per page: every halt of every list asks info().
  let mem = null;
  const load = () => {
    if (mem) {
      return mem;
    }
    try {
      const m = JSON.parse(localStorage.getItem(STOP_LINES_KEY));
      mem = m && typeof m === "object" ? m : {};
    } catch {
      mem = {};
    }
    return mem;
  };
  const store = (m) => {
    mem = m;
    try {
      localStorage.setItem(STOP_LINES_KEY, JSON.stringify(m));
    } catch {
      // Storage full or unavailable: the cache just doesn't grow.
    }
  };

  // Stops have ids from the API; a name is the fallback key.
  const keyOf = (stop) => stop.id || `name:${stop.name}`;

  function purge(m, now) {
    const minAt = Math.max(now - STOP_LINES_MAX_DAYS * MS_PER_DAY, lastTimetableChange(new Date(now)).getTime());
    Object.keys(m).forEach((k) => m[k].updatedAt < minAt && delete m[k]);
    return m;
  }

  // board beats seen; a known line is never removed.
  function add(m, stop, line, dir, src, now) {
    if (!line) {
      return;
    }
    const k = keyOf(stop);
    const e = (m[k] ||= { name: stop.name || "", boardAt: null, updatedAt: now, lines: {} });
    e.name ||= stop.name || "";
    e.updatedAt = now;
    const lk = `${line}|${dir}`;
    if (e.lines[lk]?.src !== Src.BOARD) {
      e.lines[lk] = { line, dir, src };
    }
  }

  // Every halt of every ride in these journeys: that line stops there.
  function learn(journeys, now = Date.now()) {
    const m = purge(load(), now);
    journeys.forEach((j) => j.legs.forEach((l) => (l.passes || []).forEach((p) => {
      add(m, p, l.line, l.headsign, Src.SEEN, now);
    })));
    store(m);
  }

  // Other lines than `ownLine` at this stop, grouped by line with their directions.
  //   { state, lines: [{ line: "S9", dirs: ["Schaffhausen", "Zürich HB"] }], board }
  function info(stop, ownLine, now = Date.now()) {
    const e = purge(load(), now)[keyOf(stop)];
    const byLine = new Map();
    Object.values(e?.lines || {})
      .filter((x) => x.line !== ownLine)
      .forEach((x) => byLine.set(x.line, [...(byLine.get(x.line) || []), x.dir].filter(Boolean)));
    const lines = [...byLine].map(([line, dirs]) => ({ line, dirs: [...new Set(dirs)].sort() }))
      .sort((a, b) => a.line.localeCompare(b.line, "de", { numeric: true }));
    let state = LinesState.UNKNOWN;
    if (lines.length) {
      state = LinesState.KNOWN;
    } else if (e?.boardAt) {
      state = LinesState.NONE;
    }
    return { state, lines, board: Boolean(e?.boardAt) };
  }

  // On tap: one board per stop, ever (until purged); afterwards from the cache.
  // The board's vehicles also tell where else they halt ("seen" there).
  async function fetch(stop, at, ownLine, now = Date.now()) {
    if (info(stop, ownLine, now).board) {
      return info(stop, ownLine, now);
    }
    const deps = await TransportApi.departures(stop, at);
    const m = purge(load(), now);
    deps.forEach((d) => {
      add(m, stop, d.line, d.dir, Src.BOARD, now);
      d.stops.forEach((s) => add(m, s, d.line, d.dir, Src.SEEN, now));
    });
    const k = keyOf(stop);
    m[k] ||= { name: stop.name || "", boardAt: null, updatedAt: now, lines: {} };
    m[k].boardAt = now;
    m[k].updatedAt = now;
    store(m);
    return info(stop, ownLine, now);
  }

  return { learn, info, fetch };
})();
