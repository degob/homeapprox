// Saved connections: one ride kept for later, once or every week, in localStorage.
//
//   one-off: Fr 06.11. 16:02 Zuhause → Zürich HB
//            past → greyed, deleted SAVED_KEEP_DAYS after arrival
//   weekly:  the same ride (lines, stops, scheduled times) every Friday;
//            shows the next one not yet arrived, never expires
//
// Stored on schedule, not live: each leg as minutes after the first ride's
// scheduled departure (`anchor`), so any occurrence is anchor-day + offsets.
// refresh() asks the API for the ride again and matches it ride by ride
// (line, boarding stop, scheduled departure) to get live times.

import {
  LegKind, MS_PER_MIN, SAVED_KEEP_DAYS, SAVED_KEY, SAVED_LIVE_DAYS, SAVED_QUERY_LIMIT, TimeRef,
} from "./config.js";
import { TransportApi } from "./api.js";

const MS_PER_DAY = 24 * 60 * MS_PER_MIN;
const shift = (d, min) => new Date(d.getTime() + min * MS_PER_MIN);
const offset = (from, to) => Math.round((to - from) / MS_PER_MIN);
const sched = (at, delayMin) => shift(at, -(delayMin || 0));

export const SavedStatus = Object.freeze({ UPCOMING: "upcoming", PAST: "past" });

export const Saved = (() => {
  const load = () => {
    try {
      const list = JSON.parse(localStorage.getItem(SAVED_KEY));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const store = (list) => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {
      // Storage unavailable (private mode): saving silently does nothing.
    }
  };

  // Same ride = same rides at the same scheduled times (not the same day for weekly).
  const rideKey = (r) => `${r.line}|${r.from}|${r.depOff}`;
  const signature = (e) => `${e.fromStop}>${e.toStop}@${e.anchorTime}:${e.rides.map(rideKey).join(",")}`;

  // Planner journey → entry. Times are taken back to schedule (live − delay).
  function fromJourney(j, weekly = false) {
    const firstRide = j.legs.find((l) => l.kind === LegKind.RIDE);
    const anchor = sched(firstRide ? firstRide.dep : j.transitStart, firstRide?.depDelayMin);
    const legs = j.legs.map((l) => ({
      kind: l.kind,
      line: l.line,
      headsign: l.headsign,
      from: l.from,
      to: l.to,
      platform: l.platform,
      arrPlatform: l.arrPlatform,
      walkSec: l.walkSec,
      stops: l.stops,
      passes: (l.passes || []).map((x) => ({
        name: x.name,
        platform: x.platform,
        arrOff: x.arr ? offset(anchor, sched(x.arr, x.arrDelayMin)) : null,
        depOff: x.dep ? offset(anchor, sched(x.dep, x.depDelayMin)) : null,
      })),
      depOff: offset(anchor, sched(l.dep, l.depDelayMin)),
      arrOff: offset(anchor, sched(l.arr, l.arrDelayMin)),
    }));
    const pad = (n) => String(n).padStart(2, "0");
    const e = {
      weekly,
      anchorDate: `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}-${pad(anchor.getDate())}`,
      anchorTime: `${pad(anchor.getHours())}:${pad(anchor.getMinutes())}`,
      fromPlace: j.fromPlace,
      toPlace: j.toPlace,
      fromStop: j.fromStop,
      toStop: j.toStop,
      walkStartMin: j.walkStartMin,
      walkEndMin: j.walkEndMin,
      lines: j.lines,
      legs,
      rides: legs.filter((l) => l.kind === LegKind.RIDE).map(({ line, from, depOff }) => ({ line, from, depOff })),
    };
    // id: this ride on its first day; sig: the ride itself (weekly match).
    return { id: `${signature(e)}#${e.anchorDate}`, sig: signature(e), ...e };
  }

  // Anchor (first ride's scheduled departure) on a given calendar day.
  const anchorOn = (e, day) => {
    const [h, m] = e.anchorTime.split(":").map(Number);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
  };
  const anchorDay = (e) => {
    const [y, mo, d] = e.anchorDate.split("-").map(Number);
    return new Date(y, mo - 1, d);
  };
  const endOff = (e) => (e.legs.length ? e.legs[e.legs.length - 1].arrOff : 0) + (e.walkEndMin || 0);

  // Journey-like object for one occurrence, on schedule (delays 0).
  function journeyAt(e, anchor) {
    const at = (off) => (off === null || off === undefined ? null : shift(anchor, off));
    const legs = e.legs.map((l) => ({
      ...l,
      passes: (l.passes || []).map((x) => ({
        name: x.name,
        platform: x.platform,
        arr: at(x.arrOff),
        arrDelayMin: 0,
        dep: at(x.depOff),
        depDelayMin: 0,
      })),
      dep: shift(anchor, l.depOff),
      arr: shift(anchor, l.arrOff),
      depDelayMin: 0,
      arrDelayMin: 0,
    }));
    return withEnds(e, legs, anchor);
  }

  function withEnds(e, legs, anchor) {
    const transitStart = legs.length ? legs[0].dep : anchor;
    const transitEnd = legs.length ? legs[legs.length - 1].arr : anchor;
    return {
      fromPlace: e.fromPlace,
      toPlace: e.toPlace,
      fromStop: e.fromStop,
      toStop: e.toStop,
      walkStartMin: e.walkStartMin,
      walkEndMin: e.walkEndMin,
      lines: e.lines,
      transitStart,
      transitEnd,
      start: shift(transitStart, -(e.walkStartMin || 0)),
      end: shift(transitEnd, e.walkEndMin || 0),
      legs,
      anchor,
    };
  }

  // The occurrence to show: one-off → its day; weekly → the next one on the
  // same weekday that hasn't arrived yet (today's until arrival).
  function occurrence(e, now = new Date()) {
    let day = anchorDay(e);
    if (e.weekly) {
      day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const ahead = (anchorDay(e).getDay() - day.getDay() + 7) % 7;
      day.setDate(day.getDate() + ahead);
      if (shift(anchorOn(e, day), endOff(e)) < now) {
        day.setDate(day.getDate() + 7);
      }
    }
    return journeyAt(e, anchorOn(e, day));
  }

  // Past one-offs: greyed until `expires`, then purged.
  function status(e, now = new Date()) {
    const occ = occurrence(e, now);
    if (e.weekly || occ.end >= now) {
      return { status: SavedStatus.UPCOMING, occ };
    }
    const expires = new Date(occ.end);
    expires.setDate(expires.getDate() + SAVED_KEEP_DAYS);
    return { status: SavedStatus.PAST, occ, expires };
  }

  // All entries with their occurrence: upcoming by departure, then past. Purges expired.
  function list(now = new Date()) {
    const all = load();
    const rows = all.map((e) => ({ entry: e, ...status(e, now) }));
    const keep = rows.filter((r) => !(r.status === SavedStatus.PAST && r.expires < now));
    if (keep.length !== all.length) {
      store(keep.map((r) => r.entry));
    }
    const rank = (r) => (r.status === SavedStatus.PAST ? 1 : 0);
    return keep.sort((a, b) => rank(a) - rank(b) || a.occ.start - b.occ.start);
  }

  function add(j, weekly = false) {
    const e = fromJourney(j, weekly);
    const rest = load().filter((x) => x.id !== e.id);
    store([...rest, e]);
    return e;
  }

  const remove = (id) => store(load().filter((e) => e.id !== id));
  // Saved already: this exact day, or the same ride weekly.
  function has(j) {
    const n = fromJourney(j);
    return load().some((e) => e.sig === n.sig && (e.weekly || e.anchorDate === n.anchorDate));
  }

  function setWeekly(id, weekly) {
    const all = load();
    const e = all.find((x) => x.id === id);
    if (e) {
      // Weekly → once: keep the occurrence it was showing, not the first one.
      if (e.weekly && !weekly) {
        const a = occurrence(e).anchor;
        const pad = (n) => String(n).padStart(2, "0");
        e.anchorDate = `${a.getFullYear()}-${pad(a.getMonth() + 1)}-${pad(a.getDate())}`;
      }
      e.weekly = weekly;
      store(all);
    }
    return e;
  }

  // Worth asking live: not past and departing within SAVED_LIVE_DAYS.
  const isLiveRange = (occ, now) => occ.end >= now && occ.start - now <= SAVED_LIVE_DAYS * MS_PER_DAY;

  // Live version of the occurrence: same rides found again → their live
  // times and delays; null = not in the timetable any more (changed?).
  async function refresh(e, now = new Date()) {
    const occ = occurrence(e, now);
    const want = occ.legs.filter((l) => l.kind === LegKind.RIDE).map((l) => `${l.line}|${l.from}|${l.dep.getTime()}`);
    const trips = await TransportApi.connections(e.fromStop, e.toStop, shift(occ.anchor, -1), TimeRef.DEPART, SAVED_QUERY_LIMIT);
    const match = trips.find((t) => {
      const got = t.legs
        .filter((l) => l.kind === LegKind.RIDE)
        .map((l) => `${l.line}|${l.from}|${sched(l.dep, l.depDelayMin).getTime()}`);
      return got.length === want.length && got.every((k, i) => k === want[i]);
    });
    return match ? withEnds(e, match.legs, occ.anchor) : null;
  }

  return { list, add, remove, has, setWeekly, occurrence, status, refresh, isLiveRange };
})();
