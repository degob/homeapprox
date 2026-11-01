// Call log: every request with its purpose; per search what it cost (calls by
// purpose) and found (journeys per stop pair and source); exported as JSON.
// Run: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadApp, at, ride, walk, conn, boardEntry } from "./load-app.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));
const stored = (app) => JSON.parse(app.localStorage.getItem("homeapprox.calllog"));

// Furtbach: bus 772 only found when asked at its departure (see homeapprox.test.mjs).
function feederBus(app) {
  const bus772 = conn(
    ride("B", "772", "Wallisellen, Furtbach", [10, 17], "Wallisellen, Bahnhof", [10, 26], { trip: "772a" }),
    walk("Wallisellen, Bahnhof", [10, 26], "Wallisellen", [10, 28]),
    ride("S", "14", "Wallisellen", [10, 39], "Rigi Kulm", [12, 34], { trip: "s14-39" }),
  );
  const walkToS14 = conn(
    walk("Wallisellen, Furtbach", [10, 22], "Wallisellen", [10, 39]),
    ride("S", "14", "Wallisellen", [10, 39], "Rigi Kulm", [12, 34], { trip: "s14-39" }),
  );
  app.setRoute((path, p) => {
    if (path === "connections") {
      if (p.get("from") === "Wallisellen, Furtbach") {
        return { connections: p.get("time") === "10:17" ? [bus772] : [walkToS14] };
      }
      if (p.get("from") === "Wallisellen") {
        return { connections: [conn(ride("S", "14", "Wallisellen", [10, 39], "Rigi Kulm", [12, 34], { trip: "s14-39" }))] };
      }
      return undefined;
    }
    if (path === "stationboard" && p.get("station") === "Wallisellen, Furtbach") {
      return { stationboard: [boardEntry("B", "772", "Wallisellen, Furtbach", [10, 17], [["Wallisellen, Bahnhof", [10, 26]]], "772a")] };
    }
    return undefined;
  });
}

describe("call log", () => {
  test("a search: every request logged with its purpose and counted for the search", async () => {
    const app = loadApp();
    feederBus(app);
    await app.Planner.search("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const { searches, calls } = stored(app);
    assert.equal(searches.length, 1);
    const s = searches[0];
    assert.equal(s.kind, "search");
    assert.deepEqual(s.pairs, ["Zuhause → Rigi Kulm"]);
    assert.equal(calls.length, app.requests.length);
    assert.ok(calls.every((c) => c.s === s.id && c.st === 200 && typeof c.ms === "number"));
    const count = (p) => calls.filter((c) => c.p === p).length;
    assert.equal(count("board"), app.requests.filter((r) => r.path === "stationboard").length);
    assert.equal(count("requery"), app.requests.filter((r) => r.params.get("limit") === "3").length);
    assert.ok(count("requery") >= 1);
    assert.equal(count("base"), app.HOME_STOPS.length, "one base query per home stop");
    assert.deepEqual(plain(s.calls), Object.fromEntries(["base", "page", "board", "requery"]
      .filter((p) => count(p)).map((p) => [p, count(p)])));
    const requery = calls.find((c) => c.p === "requery");
    assert.equal(requery.q.time, "10:17");
    assert.equal(requery.q.from, "Wallisellen, Furtbach");
    assert.equal(requery.n, 1);
  });

  test("journeys per stop pair and source; the bus is shown thanks to a re-ask", async () => {
    const app = loadApp();
    feederBus(app);
    await app.Planner.search("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const s = stored(app).searches[0];
    const furtbach = s.stops["Wallisellen, Furtbach → Rigi Kulm"];
    assert.equal(furtbach.secondary, false);
    assert.equal(furtbach.shown.requery, 1);
    const [r] = app.CallLog.recent(5);
    assert.equal(r.shownRequery, 1);
    assert.ok(r.shown >= 2);
    assert.equal(r.total, stored(app).calls.length);
  });

  test("secondary stops are marked", async () => {
    const app = loadApp();
    app.setRoute((path, p) => (path === "connections" && p.get("from") === "Wallisellen, Säntisstrasse"
      ? { connections: [conn(ride("B", "774", "Wallisellen, Säntisstrasse", [10, 20], "Rigi Kulm", [12, 0]))] }
      : undefined));
    await app.Planner.search("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const e = stored(app).searches[0].stops["Wallisellen, Säntisstrasse → Rigi Kulm"];
    assert.equal(e.secondary, true);
    assert.equal(app.CallLog.recent(1)[0].shownSecondary, 1);
  });

  test("calls outside a search have no search id; extend is its own entry", async () => {
    const app = loadApp();
    feederBus(app);
    await app.TransportApi.locations("Rigi");
    const r = await app.Planner.search("Rigi Kulm", at(10, 0), "fromHome", "depart");
    await app.Planner.extend(r, "later");
    const { searches, calls } = stored(app);
    assert.equal(calls[0].p, "suggest");
    assert.equal(calls[0].s, null);
    assert.equal(calls[0].q.query, "Rigi");
    assert.deepEqual(searches.map((s) => s.kind), ["search", "extend"]);
    assert.equal(searches[1].side, "later");
    assert.ok(calls.some((c) => c.s === searches[1].id));
  });

  test("HTTP errors are logged with their status", async () => {
    const app = loadApp();
    app.setRoute(() => ({ status: 429 }));
    await app.Planner.search("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const { searches, calls } = stored(app);
    assert.ok(calls.every((c) => c.st === 429));
    assert.ok(searches[0].failed.length > 0);
  });

  test("export has the log, places and limits; reset empties it", async () => {
    const app = loadApp();
    feederBus(app);
    await app.Planner.search("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const x = JSON.parse(app.StatsView.exportText());
    assert.equal(x.version, 1);
    assert.equal(x.searches.length, 1);
    assert.ok(x.calls.length > 0);
    assert.ok(x.places.some((p) => p.name === "Zuhause" && p.stops.length === app.HOME_STOPS.length));
    assert.equal(x.config.BOARD_MAX_REQUERIES, app.BOARD_MAX_REQUERIES);
    app.CallLog.reset();
    assert.deepEqual(stored(app), { searches: [], calls: [] });
    assert.equal(app.CallLog.recent(5).length, 0);
  });

  test("oldest calls dropped beyond the cap", () => {
    const app = loadApp();
    const params = new URLSearchParams({ query: "x" });
    for (let i = 0; i < 3005; i++) {
      app.CallLog.done(app.CallLog.call("locations", params, "suggest", i), { status: 200 }, 1);
    }
    const { calls } = stored(app);
    assert.equal(calls.length, 3000);
    assert.equal(calls[0].t, 5);
  });
});
