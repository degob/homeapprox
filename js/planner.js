// Planner: domain logic, adds walking around the transit leg

import {
  ALT_BEFORE_MIN, ALT_EARLIER, ALT_LATER, ALT_LIMIT, BOARD_MAX_REQUERIES, BOARD_SLACK_MIN,
  BoardKind, Direction, LegKind, MAX_PAGES, MAX_RESULTS, MAX_SUGGESTIONS, MIN_QUERY_CHARS,
  MIN_WINDOW_MIN, MORE_STEP_MIN, MS_PER_MIN, RECENT_PAST_MIN, REQUERY_LIMIT, STOP_ABBR_MAX, Side,
  TimeRef, WalkMode, ZUHAUSE, asPlace, station
} from "./config.js";
import { TransportApi } from "./api.js";

export const AltRel = Object.freeze({ EARLIER: "earlier", PLANNED: "planned", LATER: "later" });
const minutesBetween = (a, b) => Math.round((b - a) / MS_PER_MIN);

export const Planner = (() => {
  const shift = (d, min) => new Date(d.getTime() + min * MS_PER_MIN);

  // Connections until the window [t, t + MIN_WINDOW_MIN] (Ab) or
  // [t − MIN_WINDOW_MIN, t] (An) is covered: re-asks from just after the last
  // departure (or before the first arrival) found so far. Deduped.
  async function connectionsCovering(from, to, t, timeRef) {
    const depart = timeRef === TimeRef.DEPART;
    const edge = shift(t, depart ? MIN_WINDOW_MIN : -MIN_WINDOW_MIN);
    const seen = new Map();
    let at = t;
    for (let page = 0; page < MAX_PAGES; page++) {
      const trips = await TransportApi.connections(from, to, at, timeRef);
      const before = seen.size;
      trips.forEach((tr) => seen.set(`${tr.dep.getTime()}|${tr.arr.getTime()}|${tr.lines}`, tr));
      if (!trips.length || seen.size === before) {
        break;
      }
      const all = [...seen.values()];
      if (depart) {
        const last = new Date(Math.max(...all.map((tr) => tr.dep)));
        if (last >= edge) {
          break;
        }
        at = shift(last, 1);
      } else {
        const first = new Date(Math.min(...all.map((tr) => tr.arr)));
        if (first <= edge) {
          break;
        }
        at = shift(first, -1);
      }
    }
    return [...seen.values()];
  }

  // Which side is custom; the form's Direction for the UI (followUpSearch).
  //   from custom → fromHome, to custom → toHome, neither → other.
  // Both custom: fromHome (follow-up searches then run from the transfer).
  function dirOf(from, to) {
    if (from.custom) {
      return Direction.FROM_HOME;
    }
    return to.custom ? Direction.TO_HOME : Direction.OTHER;
  }

  // Full door-to-door journey for one trip between stop `sf` of place
  // `from` and stop `st` of place `to`. `query` records what was asked of
  // the API, so odd results can be traced.
  //   start ··walkStart··► transitStart ──rides──► transitEnd ··walkEnd··► end
  function toJourney(trip, ends, query) {
    const { from, sf, to, st } = ends;
    const dir = dirOf(from, to);
    const walkStartMin = from.custom ? sf.walkMin : 0;
    const walkEndMin = to.custom ? st.walkMin : 0;
    // homeStop: the custom end's stop (from side first); pruning keys on it.
    const homeStop = from.custom ? sf.name : to.custom ? st.name : undefined;
    return {
      stop: homeStop,
      homeStop,
      from: trip.from,
      to: trip.to,
      fromPlace: from.name,
      toPlace: to.name,
      fromStop: sf.name,
      toStop: st.name,
      walkStartMin,
      walkEndMin,
      start: shift(trip.dep, -walkStartMin),
      end: shift(trip.arr, walkEndMin),
      transitStart: trip.dep,
      transitEnd: trip.arr,
      lines: trip.lines,
      transfers: trip.transfers,
      legs: trip.legs,
      hasExtraWalk: trip.legs.some((l) => l.kind === LegKind.WALK),
      dir,
      homeEnd: from.custom || to.custom,
      query,
    };
  }

  // The walk at a custom end is ours. If the API adds its own there, it
  // reached a different stop than asked: drop the trip.
  //   from custom: [walk?] ride ... ride [walk]   ← first leg must be a ride
  //   to custom:   [walk] ride ... ride [walk?]   ← last leg must be a ride
  function endsAreClean(trip, from, to) {
    const legs = trip.legs;
    if (!legs.length) {
      return true;
    }
    const okFrom = !from.custom || legs[0].kind === LegKind.RIDE;
    const okTo = !to.custom || legs[legs.length - 1].kind === LegKind.RIDE;
    return okFrom && okTo;
  }

  // One stop pair. Ab: the ride must leave after walking to sf.
  // An: it must arrive before walking from st. Returns the raw trips too
  // (before the clean-end filter): their times frame the board window.
  async function forPairRaw(ends, at, timeRef) {
    const { from, sf, to, st } = ends;
    const t = timeRef === TimeRef.DEPART
      ? shift(at, from.custom ? sf.walkMin : 0)
      : shift(at, -(to.custom ? st.walkMin : 0));
    const trips = await connectionsCovering(sf.name, st.name, t, timeRef);
    const query = { from: sf.name, to: st.name, at: t, timeRef };
    const journeys = trips
      .filter((trip) => endsAreClean(trip, from, to))
      .map((trip) => toJourney(trip, ends, query));
    return { trips, journeys, asked: t };
  }

  const forPair = async (ends, at, timeRef) => (await forPairRaw(ends, at, timeRef)).journeys;

  // The planner returns only journeys best in arrival and changes, so a bus
  // from a custom stop is hidden whenever walking reaches the same train.
  // Asking again exactly at the bus's time reveals it: by then the walk
  // can't make that train. Window at the custom end = the base results'
  // span there; empty base → MIN_WINDOW_MIN from the asked time.
  //   from side: departures board, query Ab at each bus departure,
  //              keep trips whose first leg is that ride
  //   to side:   arrivals board, query An at each bus arrival,
  //              keep trips whose last leg is that ride
  async function forPairBoard(ends, side, base, at, timeRef) {
    const { from, sf, to, st } = ends;
    const fromSide = side === Side.FROM;
    const stop = fromSide ? sf : st;
    // Window: the raw trips' times at this end, plus the asked window when
    // the user's time refers to this end, ± slack.
    const times = base.trips.map((trip) => (fromSide ? trip.dep : trip.arr).getTime());
    const askedHere = fromSide ? timeRef === TimeRef.DEPART : timeRef === TimeRef.ARRIVE;
    if (askedHere) {
      times.push(base.asked.getTime(), shift(base.asked, fromSide ? MIN_WINDOW_MIN : -MIN_WINDOW_MIN).getTime());
    }
    if (!times.length) {
      return [];
    }
    const lo = shift(new Date(Math.min(...times)), -BOARD_SLACK_MIN);
    const hi = shift(new Date(Math.max(...times)), BOARD_SLACK_MIN);

    const kind = fromSide ? BoardKind.DEPART : BoardKind.ARRIVE;
    const board = await TransportApi.boardTimes(stop.name, lo, kind);
    const picked = board.filter((t) => t >= lo && t <= hi).slice(0, BOARD_MAX_REQUERIES);

    const ref = fromSide ? TimeRef.DEPART : TimeRef.ARRIVE;
    const settled = await Promise.allSettled(
      picked.map((t) => TransportApi.connections(sf.name, st.name, t, ref, REQUERY_LIMIT))
    );
    const matches = (trip, t) => {
      const legs = trip.legs;
      const leg = fromSide ? legs[0] : legs[legs.length - 1];
      const when = fromSide ? leg?.dep : leg?.arr;
      return leg?.kind === LegKind.RIDE && when?.getTime() === t.getTime();
    };
    const query = { from: sf.name, to: st.name, at: lo, timeRef, board: stop.name };
    let trips = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        trips = trips.concat(r.value.filter((trip) => matches(trip, picked[i])));
      }
    });
    return trips
      .filter((trip) => endsAreClean(trip, from, to))
      .map((trip) => toJourney(trip, ends, query));
  }

  // One stop pair, complete: base query, then the board re-asks for each
  // custom side.
  async function forPairFull(ends, at, timeRef) {
    const base = await forPairRaw(ends, at, timeRef);
    const sides = [[Side.FROM, ends.from], [Side.TO, ends.to]].filter(([, p]) => p.custom);
    const extra = await Promise.all(sides.map(([side]) => forPairBoard(ends, side, base, at, timeRef)));
    return base.journeys.concat(...extra);
  }

  // Vehicle identity: API trip name (same bus at another stop has another time).
  const vehicleKey = (l) => `${l.line}#${l.tripId || l.dep.getTime()}`;

  // Ride at one end: first ride on the from side, last on the to side.
  const endRide = (j, side) => {
    const rides = j.legs.filter((l) => l.kind === LegKind.RIDE);
    return side === Side.FROM ? rides[0] : rides[rides.length - 1];
  };
  const endStop = (j, side) => (side === Side.FROM ? j.fromStop : j.toStop);

  // A secondary stop's journey is dropped if the vehicle at that end
  // already appears in any journey of the other stops.
  function dropCoveredSecondary(journeys, side, place) {
    const secondary = new Set(place.stops.filter((s) => s.secondary).map((s) => s.name));
    const isSecondary = (j) => secondary.has(endStop(j, side));
    const used = new Set(
      journeys.filter((j) => !isSecondary(j)).flatMap((j) =>
        j.legs.filter((l) => l.kind === LegKind.RIDE).map(vehicleKey))
    );
    return journeys.filter((j) => {
      if (!isSecondary(j)) {
        return true;
      }
      const ride = endRide(j, side);
      return !ride || !used.has(vehicleKey(ride));
    });
  }

  // Same vehicle at a custom end, same other end: only the best stop to
  // board/alight it is kept. E.g. T12 from Glatt (Tram) 09:55 (walk 13) vs.
  // Wallisellen Bahnhof 09:56 (walk 15), both arriving 10:13: leaving home
  // 09:42 beats 09:41.
  //   from side: same vehicle + same end   → latest start wins
  //   to side:   same vehicle + same start → earliest end wins
  // Ties stay (both shown).
  function dropDominatedBoarding(journeys, side) {
    const fromHome = side === Side.FROM;
    const groups = new Map();
    journeys.forEach((j) => {
      const ride = endRide(j, side);
      if (!ride) {
        return;
      }
      const key = `${vehicleKey(ride)}|${(fromHome ? j.end : j.start).getTime()}`;
      groups.set(key, [...(groups.get(key) || []), j]);
    });
    const drop = new Set();
    groups.forEach((g) => {
      const best = fromHome ? Math.max(...g.map((j) => j.start)) : Math.min(...g.map((j) => j.end));
      g.forEach((j) => {
        if ((fromHome ? j.start.getTime() : j.end.getTime()) !== best) {
          drop.add(j);
        }
      });
    });
    return journeys.filter((j) => !drop.has(j));
  }

  // Same rides at the same times = same journey (base query and board re-ask
  // can coincide); the first one wins.
  function dedupe(journeys) {
    const seen = new Set();
    return journeys.filter((j) => {
      const key = j.legs
        .filter((l) => l.kind === LegKind.RIDE)
        .map((l) => `${l.line}@${l.dep.getTime()}`)
        .join("|");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  // After all pairs are queried:
  // Duplicates, covered secondary stops, dominated boardings; sorted.
  // Secondary check first: a covered secondary stop must not win the
  // dominance comparison against the primary stop it duplicates.
  function prune(journeys, from, to) {
    let pruned = dedupe(journeys);
    [[Side.FROM, from], [Side.TO, to]].forEach(([side, place]) => {
      if (place.custom) {
        pruned = dropDominatedBoarding(dropCoveredSecondary(pruned, side, place), side);
      }
    });
    return pruned.sort((a, b) => a.start - b.start);
  }

  // Window shown by visible(): Ab [at, at + 30], An [at − 30, at].
  const defaultRange = (at, timeRef) => timeRef === TimeRef.DEPART
    ? { lo: at, hi: shift(at, MIN_WINDOW_MIN) }
    : { lo: shift(at, -MIN_WINDOW_MIN), hi: at };

  // Direction + place(s) → [from, to] pairs. `origin` only for OTHER.
  //   toHome:   place → Zuhause     fromHome: Zuhause → place
  //   other:    origin → place
  function pairsFor(placeOrPlaces, dir, origin) {
    return [].concat(placeOrPlaces).map(asPlace).map((p) => {
      if (dir === Direction.TO_HOME) {
        return [p, ZUHAUSE];
      }
      return dir === Direction.FROM_HOME ? [ZUHAUSE, p] : [asPlace(origin), p];
    });
  }

  const pairLabel = ([from, to]) => `${from.name} → ${to.name}`;

  // Several (from, to) pairs: planned each, merged, ordered by departure;
  // failures labelled with the pair when there are several.
  async function planPairs(pairs, at, timeRef) {
    const settled = await Promise.allSettled(pairs.map(([f, t]) => planPlaces(f, t, at, timeRef)));
    const failed = [];
    let journeys = [];
    settled.forEach((r, i) => {
      if (r.status === "rejected") {
        failed.push(pairLabel(pairs[i]));
        return;
      }
      const tag = pairs.length > 1 ? `${pairLabel(pairs[i])}: ` : "";
      failed.push(...r.value.failed.map((f) => tag + f));
      journeys = journeys.concat(r.value.journeys);
    });
    journeys.sort((a, b) => a.start - b.start);
    return { journeys, failed, at, timeRef, ...defaultRange(at, timeRef) };
  }

  // Direction form of planPairs (tests, follow-up searches).
  const plan = (placeOrPlaces, at, dir, timeRef, origin) => planPairs(pairsFor(placeOrPlaces, dir, origin), at, timeRef);

  // Pruning of merged results: per pair, each with its own custom sides.
  function prunePairs(journeys, pairs) {
    const byPair = new Map(pairs.map((p) => [pairLabel(p), p]));
    const groups = new Map();
    journeys.forEach((j) => {
      const k = `${j.fromPlace} → ${j.toPlace}`;
      groups.set(k, [...(groups.get(k) || []), j]);
    });
    let out = [];
    groups.forEach((g, k) => {
      const [from, to] = byPair.get(k) || [station(""), station("")];
      out = out.concat(prune(g, from, to));
    });
    return out.sort((a, b) => a.start - b.start);
  }

  // Core: every stop pair of the two places (base query + board re-asks at
  // custom ends), all in parallel; one failing pair doesn't block the others.
  //   from.stops × to.stops → forPairFull
  async function planPlaces(from, to, at, timeRef) {
    const tasks = [];
    from.stops.forEach((sf) => to.stops.forEach((st) => tasks.push({
      label: from.custom && !to.custom ? sf.name : to.custom && !from.custom ? st.name : `${sf.name} → ${st.name}`,
      run: () => forPairFull({ from, sf, to, st }, at, timeRef),
    })));
    const settled = await Promise.allSettled(tasks.map((t) => t.run()));

    const failed = [];
    let journeys = [];
    settled.forEach((r, i) => {
      if (r.status === "rejected") {
        failed.push(tasks[i].label);
        return;
      }
      journeys = journeys.concat(r.value);
    });
    journeys = prune(journeys, from, to);

    // Keep journeys within the requested window, ordered by departure.
    const fits = timeRef === TimeRef.DEPART ? (j) => j.start >= at : (j) => j.end <= at;
    journeys = journeys.filter(fits).sort((a, b) => a.start - b.start);

    return { journeys, failed, at, timeRef, ...defaultRange(at, timeRef) };
  }

  // Applied on already fetched journeys, so toggling needs no new search.
  // Everything inside the MIN_WINDOW_MIN window is shown, however many;
  // beyond it, filled up to MAX_RESULTS.
  function visible(result, walkMode) {
    const { journeys, timeRef, lo, hi } = result;
    const shown = walkMode === WalkMode.HIDE ? journeys.filter((j) => !j.hasExtraWalk) : journeys;
    const inWindow = timeRef === TimeRef.DEPART
      ? (j) => j.start >= lo && j.start <= hi
      : (j) => j.end >= lo && j.end <= hi;
    const core = shown.filter(inWindow);
    const room = Math.max(0, MAX_RESULTS - core.length);
    const outside = shown.filter((j) => (timeRef === TimeRef.DEPART ? j.start > hi : j.end < lo));
    // Ab: next ones after the window; An: the latest ones before it.
    const rest = timeRef === TimeRef.DEPART ? outside.slice(0, room) : outside.slice(-room || outside.length);
    if (!room) {
      rest.length = 0;
    }
    return [...core, ...rest].sort((a, b) => a.start - b.start);
  }

  // Town part of a stop name: before the comma, else the first word.
  //   "Zürich, Bahnhofplatz/HB" → Zürich / Bahnhofplatz/HB
  //   "Zürich HB"               → Zürich / HB
  //   "Wallisellen"             → Wallisellen / (empty)
  function splitTown(name) {
    const comma = name.indexOf(", ");
    if (comma >= 0) {
      return { town: name.slice(0, comma), rest: name.slice(comma + 2) };
    }
    const space = name.indexOf(" ");
    return space < 0
      ? { town: name, rest: "" }
      : { town: name.slice(0, space), rest: name.slice(space + 1) };
  }

  // Abbreviation for the transfer bubble, max STOP_ABBR_MAX letters:
  // town initial + rest, the word "Bahnhof" dropped. A stop that is only a town
  // (also after dropping "Bahnhof") is the town itself, shortened.
  //   "Zürich Oerlikon"         → "ZOerli"
  //   "Zürich HB"               → "ZHB"
  //   "Zürich, Bahnhofplatz/HB" → "ZBahnh"
  //   "Wallisellen, Bahnhof"    → "Wallis"
  // Short name: town dropped when a distinct part remains, "Bahnhof" and
  // anything after it dropped, bracketed suffix dropped.
  //   "Wallisellen, Furtbach"       → "Furtbach"
  //   "Zürich HB"                   → "HB"
  //   "Zürich Oerlikon Bahnhof Ost" → "Oerlikon"
  //   "Wallisellen, Bahnhof"        → "Wallisellen"
  //   "Wallisellen, Glatt (Tram)"   → "Glatt"
  //   "Zürich Oerlikon, Bahnhof Ost"→ "Oerlikon"  (town itself is "City Part")
  function shortName(name) {
    const { town, rest } = splitTown(name);
    const core = rest
      .replace(/(^|[\s,])Bahnhof(?=$|[\s,]).*$/i, "")
      .replace(/\s*\(.*?\)\s*$/, "")
      .trim();
    if (core) {
      return core;
    }
    const space = town.indexOf(" ");
    return space < 0 ? town : town.slice(space + 1);
  }

  function stopAbbr(name) {
    const letters = (t) => t.replace(/[^\p{L}\p{N}]/gu, "");
    const { town, rest } = splitTown(name);
    const core = rest.replace(/(^|[\s,])Bahnhof(?=$|[\s,])/gi, " ").trim();
    if (!core) {
      return letters(town).slice(0, STOP_ABBR_MAX);
    }
    const prefix = letters(town).slice(0, 1);
    return prefix + letters(core).slice(0, STOP_ABBR_MAX - prefix.length);
  }

  // "Zürich" ~ "zurich" ~ "Zuerich".
  const fold = (t) => t.toLowerCase().replace(/([aou])e/g, "$1").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Suggestions for the place field: favorites and recent first, then API hits.
  async function suggest(query, known) {
    const q = fold(query);
    const local = known.filter((n) => fold(n).includes(q));
    if (query.length < MIN_QUERY_CHARS) {
      return local;
    }

    const remote = await TransportApi.locations(query);
    const fresh = remote.filter((n) => !local.includes(n));
    return local.concat(fresh).slice(0, MAX_SUGGESTIONS);
  }

  // Onward connections from a transfer stop to the journey's last station,
  // around the planned one. Arrival there (`x.from`) splits them:
  //   EARLIER: leaves before I arrive → only if my first ride is late
  //   PLANNED: same first ride as the proposal
  //   LATER:   fallback if I miss it
  //
  // Two queries, so a dense line can't fill the list with past ones only:
  //   earlier: from arrival − ALT_BEFORE_MIN, the last ALT_EARLIER before arrival
  //   from arrival on: all up to the planned departure + ALT_LATER after it
  //     (one more query if the first doesn't reach that far)
  async function alternatives(j, x) {
    const dest = j.to;
    const ask = (t) => TransportApi.connections(x.stop, dest, t, TimeRef.DEPART, ALT_LIMIT);
    const [before, after] = await Promise.all([ask(shift(x.from, -ALT_BEFORE_MIN)), ask(x.from)]);
    let onward = after.filter((t) => t.dep >= x.from);
    if (onward.length && onward.filter((t) => t.dep > x.to).length < ALT_LATER) {
      const last = new Date(Math.max(...onward.map((t) => t.dep)));
      onward = onward.concat((await ask(shift(last, 1))).filter((t) => t.dep > last));
    }
    const seen = new Set();
    const uniq = (t) => {
      const k = `${t.dep.getTime()}|${t.arr.getTime()}|${t.lines}`;
      return !seen.has(k) && seen.add(k);
    };
    const byDep = (a, b) => a.dep - b.dep;
    const earlier = before.filter((t) => t.dep < x.from).filter(uniq).sort(byDep).slice(-ALT_EARLIER);
    onward = onward.filter(uniq).sort(byDep);
    const upToPlanned = onward.filter((t) => t.dep <= x.to);
    const later = onward.filter((t) => t.dep > x.to).slice(0, ALT_LATER);
    const trips = [...earlier, ...upToPlanned, ...later];
    const nextRide = j.legs.find((l) => l.kind === LegKind.RIDE && l.dep.getTime() === x.to.getTime());
    const key = (l) => l && `${l.line}@${l.dep.getTime()}`;
    return trips.map((t) => {
      const first = t.legs.find((l) => l.kind === LegKind.RIDE);
      let rel = AltRel.LATER;
      if (key(first) === key(nextRide)) {
        rel = AltRel.PLANNED;
      } else if (t.dep < x.from) {
        rel = AltRel.EARLIER;
      }
      // wait: departure vs. my arrival at the stop (−4 = left 4 min before
      // I get there). delta: arrival at the destination vs. planned.
      return { trip: t, rel, wait: minutesBetween(x.from, t.dep), delta: minutesBetween(j.transitEnd, t.arr) };
    });
  }

  // New search from a transfer stop to the journey's destination place,
  // from my planned arrival there on.
  //   Bern → Zuhause, change at Zürich HB  ⇒  Zürich HB → Zuhause, ab 08:58
  function followUpSearch(j, x) {
    return { from: x.stop, to: j.toPlace, at: x.from, timeRef: TimeRef.DEPART };
  }

  // Entry point of the form. Ab also fetches what left up to
  // RECENT_PAST_MIN ago; `at` stays the asked time (for the "vor N Min." tag).
  async function searchPairs(pairs, at, timeRef) {
    const lookback = timeRef === TimeRef.DEPART ? RECENT_PAST_MIN : 0;
    const r = await planPairs(pairs, shift(at, -lookback), timeRef);
    const hi = timeRef === TimeRef.DEPART ? shift(at, MIN_WINDOW_MIN) : r.hi;
    return { ...r, at, hi, params: { pairs, timeRef } };
  }

  // Direction form of searchPairs (tests).
  const search = (places, at, dir, timeRef, origin) => searchPairs(pairsFor(places, dir, origin), at, timeRef);

  // "Frühere" / "Spätere": fetch the next MORE_STEP_MIN outside the window,
  // merge, widen the window.
  //   Ab: earlier = depart from lo − step; later = depart from hi
  //   An: earlier = arrive by lo;          later = arrive by hi + step
  async function extend(result, side) {
    const { pairs, timeRef } = result.params;
    const earlier = side === "earlier";
    const depart = timeRef === TimeRef.DEPART;
    const lo = earlier ? shift(result.lo, -MORE_STEP_MIN) : result.lo;
    const hi = earlier ? result.hi : shift(result.hi, MORE_STEP_MIN);
    let q;
    if (depart) {
      q = earlier ? lo : result.hi;
    } else {
      q = earlier ? result.lo : hi;
    }
    const more = await planPairs(pairs, q, timeRef);
    return {
      ...result,
      journeys: prunePairs([...result.journeys, ...more.journeys], pairs),
      failed: [...new Set([...result.failed, ...more.failed])],
      lo,
      hi,
    };
  }

  return { plan, planPlaces, planPairs, search, searchPairs, extend, visible, suggest, stopAbbr, shortName, alternatives, followUpSearch };
})();
