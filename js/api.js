// TransportApi: raw HTTP, nothing else knows the API shape

import {
  API_BASE, BOARD_LIMIT, BOARD_MODES, BoardKind, CONNECTIONS_PER_STOP, LegKind, MS_PER_MIN,
  MS_PER_SEC, TRANSFER_WALK_MAX_MIN, TimeRef, UMLAUT_VARIANTS, station
} from "./config.js";

export const TransportApi = (() => {
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // Display name of a line. API gives category + number, e.g. T/15, S/19, B/759.
  // Trams get "T15", buses just the number, trains "S19", "IR36".
  function lineLabel(j) {
    const cat = (j.category || "").trim();
    const num = (j.number || "").trim();
    if (!num) {
      return cat;
    }
    if (cat === "B" || cat === "BUS" || num.startsWith(cat)) {
      return num;
    }
    return `${cat}${num}`;
  }

  // Transfer = gap between two consecutive rides; named after the stop where
  // the next ride is boarded. E.g. T15 ──► Bahnhofplatz/HB ┄► Zürich HB ──► S19:
  // one transfer, "Zürich HB", from T15 arrival to S19 departure.
  function toTransfers(legs) {
    const rides = legs.filter((l) => l.kind === LegKind.RIDE);
    return rides.slice(0, -1).map((r, i) => ({
      stop: rides[i + 1].from,
      from: r.arr,
      to: rides[i + 1].dep,
    }));
  }

  // Short walks are platform changes, not real walking.
  function walkKind(sec) {
    return sec < TRANSFER_WALK_MAX_MIN * 60 ? LegKind.CHANGE : LegKind.WALK;
  }

  // Live time of a stop event when the API has a prognosis, else schedule.
  // The API plans with live data but the *Timestamp fields are schedule, so
  // mixing them makes a late bus seem to leave before we arrive.
  //   { departureTimestamp: 17:53, prognosis: { departure: "…18:02" } }
  //   → { at: 18:02, delayMin: 9 }
  function liveTime(ev, which) {
    const sched = new Date(ev[`${which}Timestamp`] * MS_PER_SEC);
    const prog = ev.prognosis?.[which] ? new Date(ev.prognosis[which]) : null;
    const at = prog && !Number.isNaN(prog.getTime()) ? prog : sched;
    return { at, delayMin: Math.round((at - sched) / MS_PER_MIN) };
  }

  // One section as a leg: ride (with line), real walk, or short change walk.
  function toLeg(s) {
    const j = s.journey;
    const dep = liveTime(s.departure, "departure");
    const arr = liveTime(s.arrival, "arrival");
    const walkSec = s.walk?.duration ?? Math.round((arr.at - dep.at) / MS_PER_SEC);
    return {
      kind: j ? LegKind.RIDE : walkKind(walkSec),
      line: j ? lineLabel(j) : "",
      headsign: j?.to || "",
      from: s.departure.station.name,
      dep: dep.at,
      depDelayMin: dep.delayMin,
      platform: s.departure.platform || "",
      to: s.arrival.station.name,
      arrPlatform: s.arrival.platform || "",
      arr: arr.at,
      arrDelayMin: arr.delayMin,
      walkSec,
      tripId: j?.name || "",
      stops: (j?.passList || []).map((p) => p.station?.name).filter(Boolean),
    };
  }

  // Maps API connection to a plain trip: { from, to, dep, arr, lines, transfers, legs }.
  function toTrip(c) {
    const legs = (c.sections || []).map(toLeg);
    const rideLines = [...new Set(legs.filter((l) => l.kind === LegKind.RIDE).map((l) => l.line))];
    return {
      from: c.from.station.name,
      to: c.to.station.name,
      dep: liveTime(c.from, "departure").at,
      arr: liveTime(c.to, "arrival").at,
      lines: (rideLines.length ? rideLines : c.products || []).join(", "),
      transfers: toTransfers(legs),
      legs,
    };
  }

  async function stationNames(query) {
    const params = new URLSearchParams({ query, type: "station" });
    const res = await fetch(`${API_BASE}/locations?${params}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    // Entries without id are shops, doctors … (the API's fallback), no stops.
    return (data.stations || []).filter((s) => s.id).map((s) => s.name).filter(Boolean);
  }

  // "Zurich HB" finds only shops; "Zuerich HB" finds the station.
  // One variant per a/o/u (→ ae/oe/ue), at most UMLAUT_VARIANTS.
  function umlautVariants(query) {
    if (/[äöüÄÖÜ]|ae|oe|ue/i.test(query)) {
      return [];
    }
    const out = [];
    for (const m of query.matchAll(/[aou]/gi)) {
      out.push(query.slice(0, m.index + 1) + "e" + query.slice(m.index + 1));
    }
    return out.slice(0, UMLAUT_VARIANTS);
  }

  // Station names matching a prefix, for the search help.
  async function locations(query) {
    const names = await stationNames(query);
    if (names.length) {
      return names;
    }
    const tries = await Promise.allSettled(umlautVariants(query).map(stationNames));
    const found = tries.flatMap((t) => (t.status === "fulfilled" ? t.value : []));
    return [...new Set(found)];
  }

  async function connections(from, to, at, timeRef, limit = CONNECTIONS_PER_STOP) {
    const params = new URLSearchParams({
      from,
      to,
      date: fmtDate(at),
      time: fmtTime(at),
      isArrivalTime: timeRef === TimeRef.ARRIVE ? "1" : "0",
      limit: String(limit),
    });

    const res = await fetch(`${API_BASE}/connections?${params}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    return (data.connections || []).map(toTrip);
  }

  const fmtBoardTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;

  // Same board requested by several pairs in one search: fetch once.
  const boardCache = new Map();
  const BOARD_CACHE_MS = 60_000;

  async function board(params) {
    const key = params.toString();
    const hit = boardCache.get(key);
    if (hit && Date.now() - hit.at < BOARD_CACHE_MS) {
      return hit.data;
    }
    const data = fetch(`${API_BASE}/stationboard?${params}`).then((res) => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    });
    boardCache.set(key, { at: Date.now(), data });
    data.catch(() => boardCache.delete(key));
    return data;
  }

  // Bus/tram times at `station` from `at` on: departures (BoardKind.DEPART)
  // or arrivals (BoardKind.ARRIVE), live when known. Sorted, unique.
  async function boardTimes(station, at, kind) {
    const params = new URLSearchParams({
      station,
      datetime: fmtBoardTime(at),
      limit: String(BOARD_LIMIT),
      type: kind === BoardKind.ARRIVE ? "arrival" : "departure",
    });
    BOARD_MODES.forEach((m) => params.append("transportations[]", m));
    const data = await board(params);
    const which = kind === BoardKind.ARRIVE ? "arrival" : "departure";
    const times = (data.stationboard || [])
      .filter((e) => e.stop?.[`${which}Timestamp`])
      .map((e) => liveTime(e.stop, which).at.getTime());
    return [...new Set(times)].sort((a, b) => a - b).map((t) => new Date(t));
  }

  return { connections, locations, boardTimes, toTransfers };
})();
