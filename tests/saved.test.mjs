// Saved connections: one-off vs weekly occurrence, greyed past, purge after
// a week, live refresh by matching the same rides.
// Run: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadApp, at } from "./load-app.mjs";

const MIN = 60_000;
// Calendar days (same clock time across the DST change on 25.10.).
const day = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const plus = (d, m) => new Date(d.getTime() + m * MIN);
const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const ymd = (d) => `${d.getDate()}.${d.getMonth() + 1}.`;

// Planner-shaped journey Zuhause ──2'──► Furtbach ─S14─► Oerlikon ─S2─► Zürich HB.
// `delay`: live minutes on every stop event (dep/arr are then live times).
function journey(dep = at(16, 10), { delay = 0, line2 = "S2" } = {}) {
  const leg = (line, from, d, to, a) => ({
    kind: "ride", line, headsign: to, from, to, platform: "1", arrPlatform: "2", walkSec: 0, stops: [],
    dep: plus(d, delay), depDelayMin: delay, arr: plus(a, delay), arrDelayMin: delay,
  });
  const legs = [
    leg("S14", "Wallisellen, Furtbach", dep, "Zürich Oerlikon", plus(dep, 8)),
    leg(line2, "Zürich Oerlikon", plus(dep, 12), "Zürich HB", plus(dep, 18)),
  ];
  return {
    fromPlace: "Zuhause", toPlace: "Zürich HB", fromStop: "Wallisellen, Furtbach", toStop: "Zürich HB",
    walkStartMin: 2, walkEndMin: 0, lines: `S14, ${line2}`, legs,
    transitStart: legs[0].dep, transitEnd: legs[1].arr, start: plus(legs[0].dep, -2), end: legs[1].arr,
  };
}

// API answer with the same rides on `anchor`'s day, `delay` minutes late (prognosis).
function apiConn(anchor, { delay = 0, line2 = ["S", "2"] } = {}) {
  const ev = (d, which) => ({
    [`${which}Timestamp`]: d.getTime() / 1000,
    ...(delay ? { prognosis: { [which]: plus(d, delay).toISOString() } } : {}),
  });
  const sec = (cat, num, from, d, to, a) => ({
    journey: { category: cat, number: num, name: `${cat}${num}`, to, passList: [] },
    departure: { station: { name: from }, platform: "1", ...ev(d, "departure") },
    arrival: { station: { name: to }, platform: "2", ...ev(a, "arrival") },
  });
  const sections = [
    sec("S", "14", "Wallisellen, Furtbach", anchor, "Zürich Oerlikon", plus(anchor, 8)),
    sec(line2[0], line2[1], "Zürich Oerlikon", plus(anchor, 12), "Zürich HB", plus(anchor, 18)),
  ];
  return {
    from: { station: { name: "Wallisellen, Furtbach" }, ...ev(anchor, "departure") },
    to: { station: { name: "Zürich HB" }, ...ev(plus(anchor, 18), "arrival") },
    sections,
  };
}

describe("saved connections", () => {
  test("one-off: saved on schedule, listed with its day and times", () => {
    const app = loadApp();
    app.Saved.add(journey(at(16, 10), { delay: 3 }));
    const [row] = app.Saved.list(at(12, 0));
    assert.equal(row.status, app.SavedStatus.UPCOMING);
    assert.equal(hm(row.occ.start), "16:08"); // 2' walk before the scheduled 16:10, delay dropped
    assert.equal(hm(row.occ.end), "16:28");
    assert.equal(ymd(row.occ.start), "21.10.");
    assert.ok(app.Saved.has(journey(at(16, 10))));
    assert.ok(!app.Saved.has(journey(day(at(16, 10), 7))), "same ride next week is not saved (one-off)");
  });

  test("one-off in the past: greyed with expiry a week after arrival, then purged", () => {
    const app = loadApp();
    app.Saved.add(journey());
    const [row] = app.Saved.list(at(17, 0));
    assert.equal(row.status, app.SavedStatus.PAST);
    assert.equal(+row.expires, +day(at(16, 28), 7));
    assert.equal(app.Saved.list(day(at(16, 29), 7)).length, 0);
    assert.deepEqual(JSON.parse(app.localStorage.getItem("homeapprox.saved")), []);
  });

  test("weekly: next same weekday not yet arrived, never expires", () => {
    const app = loadApp();
    app.Saved.add(journey(), true); // Wed 21.10. 16:10
    const occ = (now) => app.Saved.list(now)[0].occ.start;
    assert.equal(ymd(occ(at(16, 20))), "21.10.", "today until arrival");
    assert.equal(ymd(occ(at(16, 30))), "28.10.", "after arrival: next week");
    assert.equal(ymd(occ(day(at(9, 0), 2))), "28.10.", "Friday → next Wednesday");
    assert.equal(hm(app.Saved.list(day(at(9, 0), 30))[0].occ.anchor), "16:10", "same clock time across the DST change");
    assert.equal(app.Saved.list(day(at(9, 0), 60))[0].status, app.SavedStatus.UPCOMING);
    assert.ok(app.Saved.has(journey(day(at(16, 10), 14))), "weekly covers the same ride on other Wednesdays");
  });

  test("weekly → once keeps the occurrence shown; delete removes it", () => {
    const app = loadApp();
    const e = app.Saved.add(journey(), true);
    // setWeekly uses the current time: compare against what it was showing then.
    const shown = app.Saved.occurrence(e).anchor;
    app.Saved.setWeekly(e.id, false);
    const [row] = app.Saved.list(day(shown, -1));
    assert.equal(+row.occ.anchor, +shown);
    app.Saved.remove(e.id);
    assert.equal(app.Saved.list().length, 0);
  });

  test("refresh: same rides found again → live times and delays", async () => {
    const app = loadApp();
    const e = app.Saved.add(journey(), true);
    const now = day(at(9, 0), 7); // Wed 28.10.
    const anchor = day(at(16, 10), 7);
    app.setRoute((path) => (path === "connections"
      ? { connections: [apiConn(anchor, { line2: ["IR", "36"] }), apiConn(anchor, { delay: 4 })] }
      : undefined));
    const live = await app.Saved.refresh(e, now);
    const q = app.requests.find((r) => r.path === "connections").params;
    assert.equal(q.get("from"), "Wallisellen, Furtbach");
    assert.equal(q.get("to"), "Zürich HB");
    assert.equal(q.get("time"), "16:09");
    assert.equal(hm(live.start), "16:12"); // 16:14 live − 2' walk
    assert.equal(live.legs[0].depDelayMin, 4);
    assert.equal(hm(live.end), "16:32");
  });

  test("refresh: rides changed in the timetable → null", async () => {
    const app = loadApp();
    const e = app.Saved.add(journey());
    app.setRoute((path) => (path === "connections" ? { connections: [apiConn(at(16, 10), { line2: ["IR", "36"] })] } : undefined));
    assert.equal(await app.Saved.refresh(e, at(9, 0)), null);
  });

  test("only near occurrences are asked live", () => {
    const app = loadApp();
    app.Saved.add(journey(), true);
    const [row] = app.Saved.list(at(9, 0));
    assert.ok(app.Saved.isLiveRange(row.occ, at(9, 0)));
    assert.ok(!app.Saved.isLiveRange(row.occ, day(at(9, 0), -10)));
  });
});

describe("halts of a ride", () => {
  // Section as transport.opendata.ch sends it: boarding and alighting stop in
  // passList, prognosis per halt (here +1 except at Zürich HB).
  const section = (dep) => {
    const t = (m) => dep.getTime() / 1000 + m * 60;
    const iso = (m) => new Date((t(m) + 60) * 1000).toISOString();
    return {
      journey: { category: "S", number: "8", name: "S8", to: "Winterthur", passList: [
        { station: { name: "Wallisellen" }, arrivalTimestamp: null, departureTimestamp: t(0), prognosis: { departure: iso(0) }, platform: "4" },
        { station: { name: "Zürich Oerlikon" }, arrivalTimestamp: t(3), departureTimestamp: t(4), prognosis: { arrival: iso(3), departure: iso(4) }, platform: "1" },
        { station: { name: "Zürich HB" }, arrivalTimestamp: t(9), departureTimestamp: null, prognosis: {}, platform: "32" },
      ] },
      departure: { station: { name: "Wallisellen" }, departureTimestamp: t(0), platform: "4" },
      arrival: { station: { name: "Zürich HB" }, arrivalTimestamp: t(9), platform: "32" },
    };
  };
  const connOf = (dep) => ({
    from: { station: { name: "Wallisellen" }, departureTimestamp: dep.getTime() / 1000 },
    to: { station: { name: "Zürich HB" }, arrivalTimestamp: dep.getTime() / 1000 + 540 },
    sections: [section(dep)],
  });

  test("API halts keep times, delays and platforms, ends included", async () => {
    const app = loadApp();
    app.setRoute((path) => (path === "connections" ? { connections: [connOf(at(16, 26))] } : undefined));
    const [trip] = await app.TransportApi.connections("Wallisellen", "Zürich HB", at(16, 20), "depart");
    const p = trip.legs[0].passes;
    assert.deepEqual(Array.from(p, (x) => x.name), ["Wallisellen", "Zürich Oerlikon", "Zürich HB"]);
    assert.equal(p[0].arr, null);
    assert.equal(hm(p[0].dep), "16:27");
    assert.equal(p[0].depDelayMin, 1);
    assert.equal(hm(p[1].arr), "16:30");
    assert.equal(p[1].platform, "1");
    assert.equal(hm(p[2].arr), "16:35");
    assert.equal(p[2].arrDelayMin, 0);
    assert.equal(p[2].dep, null);
  });

  test("saved rides keep their halts on schedule for every occurrence", async () => {
    const app = loadApp();
    app.setRoute((path) => (path === "connections" ? { connections: [connOf(at(16, 26))] } : undefined));
    const [trip] = await app.TransportApi.connections("Wallisellen", "Zürich HB", at(16, 20), "depart");
    const j = {
      fromPlace: "Wallisellen", toPlace: "Zürich HB", fromStop: "Wallisellen", toStop: "Zürich HB",
      walkStartMin: 0, walkEndMin: 0, lines: "S8", legs: trip.legs, transitStart: trip.dep, transitEnd: trip.arr,
    };
    app.Saved.add(j, true);
    const [row] = app.Saved.list(day(at(9, 0), 7)); // next Wednesday
    const p = row.occ.legs[0].passes;
    assert.equal(ymd(row.occ.start), "28.10.");
    assert.deepEqual(Array.from(p, (x) => x.arr && hm(x.arr)), [null, "16:29", "16:35"]);
    assert.equal(p[1].arrDelayMin, 0);
  });
});
