// Call log: every API request with its purpose, and per search what it cost
// and what it found, to see where calls go and which ones pay off.
// localStorage LOG_KEY, oldest dropped first, exported as JSON (stats card).
//
//   searches: [{ id, t, kind: "search" | "extend", pairs, at, timeRef, ms,
//                calls: { base: 14, page: 9, board: 11, requery: 40 },
//                stops: { "Wallisellen, Furtbach → Zürich HB":
//                           { secondary, raw: { base, requery }, kept: {…}, shown: {…} } },
//                failed }]
//   calls:    [{ t, s: search id | null, p: purpose, e: endpoint,
//                q: { from, to, time, … }, st: HTTP status (0 = network error), ms, n: results }]
//
// Journeys per stop pair and source (base query or board re-ask):
//   raw   = as returned for the stop pair, kept = after pruning,
//   shown = in the visible list (extend: of the whole widened result).
// A search runs from begin() to end(); calls of the search purposes made
// meanwhile are counted for it. Overlapping searches would mix (rare).

import { CallPurpose, LOG_KEY, LOG_MAX_CALLS, LOG_MAX_SEARCHES } from "./config.js";

const SEARCH_PURPOSES = new Set([CallPurpose.BASE, CallPurpose.PAGE, CallPurpose.BOARD, CallPurpose.REQUERY]);
// Request parameters worth keeping (the rest is constant).
const KEEP_PARAMS = ["from", "to", "date", "time", "isArrivalTime", "limit", "station", "id", "datetime", "type", "query"];
const JourneySrc = Object.freeze({ BASE: "base", REQUERY: "requery" });
const sumValues = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

export const CallLog = (() => {
  let log = null; // loaded once, then kept in memory
  let current = null;
  let nextId = 1;
  const byResponse = new WeakMap();

  const empty = () => ({ searches: [], calls: [] });
  function data() {
    if (!log) {
      try {
        const m = JSON.parse(localStorage.getItem(LOG_KEY));
        log = m && Array.isArray(m.searches) && Array.isArray(m.calls) ? m : empty();
      } catch {
        log = empty();
      }
      nextId = Math.max(0, ...log.searches.map((s) => s.id || 0)) + 1;
    }
    return log;
  }
  function save() {
    const m = data();
    m.searches = m.searches.slice(-LOG_MAX_SEARCHES);
    m.calls = m.calls.slice(-LOG_MAX_CALLS);
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(m));
    } catch {
      // Full or unavailable: kept in memory only.
    }
  }

  // One request going out. done() adds status and duration, found() the
  // number of results (connections, board entries, stations).
  function call(endpoint, params, purpose, now = Date.now()) {
    const q = {};
    KEEP_PARAMS.forEach((k) => params.has(k) && (q[k] = params.get(k)));
    const s = current && SEARCH_PURPOSES.has(purpose) ? current : null;
    const c = { t: now, s: s ? s.id : null, p: purpose, e: endpoint, q, st: null, ms: null, n: null };
    data().calls.push(c);
    if (s) {
      s.calls[purpose] = (s.calls[purpose] || 0) + 1;
    }
    return c;
  }
  function done(c, res, ms) {
    c.st = res ? res.status : 0;
    c.ms = ms;
    if (res) {
      byResponse.set(res, c);
    }
    // Calls of a search are saved with it, at end().
    if (c.s === null) {
      save();
    }
  }
  function found(res, n) {
    const c = byResponse.get(res);
    if (c) {
      c.n = n;
    }
  }

  function begin(kind, meta = {}, now = Date.now()) {
    current = { id: nextId++, t: now, kind, ...meta, ms: null, calls: {}, stops: {}, failed: [] };
    data().searches.push(current);
    return current;
  }

  // Journeys of the running search at one stage, per stop pair and source.
  // `secondary`: names of secondary stops (only needed where a pair first appears).
  function note(stage, journeys, secondary = new Set()) {
    const s = current;
    if (!s) {
      return;
    }
    journeys.forEach((j) => {
      const key = `${j.fromStop} → ${j.toStop}`;
      const e = (s.stops[key] ||= {
        secondary: secondary.has(j.fromStop) || secondary.has(j.toStop),
        raw: {}, kept: {}, shown: {},
      });
      const src = j.query?.board ? JourneySrc.REQUERY : JourneySrc.BASE;
      e[stage][src] = (e[stage][src] || 0) + 1;
    });
  }

  function end(s, { failed = [], error = null } = {}, now = Date.now()) {
    s.ms = now - s.t;
    s.failed = failed;
    if (error) {
      s.error = String(error.message || error);
    }
    if (current === s) {
      current = null;
    }
    save();
  }

  // Newest first, for the stats card:
  //   [{ t, kind, pairs, ms, total, calls, shown, shownRequery, shownSecondary }]
  function recent(n) {
    return data().searches.slice(-n).reverse().map((s) => {
      const stops = Object.values(s.stops || {});
      const shown = (pick) => stops.filter(pick).reduce((a, e) => a + sumValues(e.shown), 0);
      return {
        t: new Date(s.t),
        kind: s.kind,
        side: s.side || null,
        pairs: s.pairs || [],
        ms: s.ms,
        total: sumValues(s.calls),
        calls: s.calls,
        shown: shown(() => true),
        shownRequery: stops.reduce((a, e) => a + (e.shown?.[JourneySrc.REQUERY] || 0), 0),
        shownSecondary: shown((e) => e.secondary),
        error: s.error || null,
      };
    });
  }

  const exportJson = (meta = {}, now = new Date()) =>
    JSON.stringify({ version: 1, exportedAt: now.toISOString(), ...meta, ...data() });

  function reset() {
    log = empty();
    current = null;
    save();
  }

  return { call, done, found, begin, note, end, recent, exportJson, reset };
})();
