// Behaviour tests for HomeApprox, one block per topic discussed while building it.
// Run: node --test tests/
//
// The app's script runs in a vm (see load-app.mjs); the API is mocked per test.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadApp, ts, at, ride, walk, conn, boardEntry } from "./load-app.mjs";

const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const plain = (x) => JSON.parse(JSON.stringify(x)); // vm-realm objects → comparable plain values
const rides = (j) => [...j.legs.filter((l) => l.kind === "ride").map((l) => l.line)];

// Answers /connections only for one exact `from`→`to` pair; everything else empty.
function connectionsFor(app, table) {
  app.setRoute((path, p) => {
    if (path === "connections") {
      const hit = table[`${p.get("from")}→${p.get("to")}`];
      return hit ? { connections: typeof hit === "function" ? hit(p) : hit } : undefined;
    }
    return table[`board:${p.get("station")}`] ? { stationboard: table[`board:${p.get("station")}`] } : undefined;
  });
}

// ---------- Line names ----------

describe("line labels", () => {
  test("tram gets T prefix, train keeps category, bus only number", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Zürich, Bellevue→Wallisellen": [conn(
        ride("T", "15", "Zürich, Bellevue", [10, 10], "Zürich, Bahnhofplatz/HB", [10, 16]),
        ride("S", "19", "Zürich HB", [10, 22], "Wallisellen", [10, 30]),
        ride("B", "759", "Wallisellen, Bahnhof", [10, 36], "Wallisellen", [10, 40]),
      )],
    });
    const [trip] = await app.TransportApi.connections("Zürich, Bellevue", "Wallisellen", at(10, 0), "depart");
    assert.deepEqual(rides(trip), ["T15", "S19", "759"]);
    assert.equal(trip.lines, "T15, S19, 759");
  });

  test("IR keeps its number without a space", async () => {
    const app = loadApp();
    connectionsFor(app, { "A→B": [conn(ride("IR", "36", "A", [9, 0], "B", [9, 30]))] });
    const [trip] = await app.TransportApi.connections("A", "B", at(9, 0), "depart");
    assert.deepEqual(rides(trip), ["IR36"]);
  });
});

// ---------- Walks inside API connections ----------

describe("walk sections", () => {
  test("walk under 5 min is a change, 5 min or more a real walk", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "A→D": [conn(
        ride("S", "8", "A", [9, 0], "B", [9, 10]),
        walk("B", [9, 10], "B2", [9, 13]),
        ride("S", "3", "B2", [9, 15], "C", [9, 20]),
        walk("C", [9, 20], "D", [9, 27]),
      )],
    });
    const [trip] = await app.TransportApi.connections("A", "D", at(9, 0), "depart");
    assert.deepEqual(trip.legs.map((l) => l.kind), ["ride", "change", "ride", "walk"]);
  });
});

// ---------- Transfers ----------

describe("transfers", () => {
  test("named after the stop where the next ride is boarded, gap = arrival → next departure", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Zürich, Bellevue→Wallisellen": [conn(
        ride("T", "15", "Zürich, Bellevue", [10, 10], "Zürich, Bahnhofplatz/HB", [10, 16]),
        walk("Zürich, Bahnhofplatz/HB", [10, 16], "Zürich HB", [10, 19]),
        ride("S", "19", "Zürich HB", [10, 22], "Wallisellen", [10, 30]),
      )],
    });
    const [trip] = await app.TransportApi.connections("Zürich, Bellevue", "Wallisellen", at(10, 0), "depart");
    assert.equal(trip.transfers.length, 1);
    assert.equal(trip.transfers[0].stop, "Zürich HB");
    assert.equal(hm(trip.transfers[0].from), "10:16");
    assert.equal(hm(trip.transfers[0].to), "10:22");
  });

  test("direct connection has no transfer", async () => {
    const app = loadApp();
    connectionsFor(app, { "A→B": [conn(ride("S", "8", "A", [9, 0], "B", [9, 30]))] });
    const [trip] = await app.TransportApi.connections("A", "B", at(9, 0), "depart");
    assert.equal(trip.transfers.length, 0);
  });
});

// ---------- Stop abbreviations ----------

describe("stop abbreviations", () => {
  const cases = [
    ["Zürich Oerlikon", "ZOerli"], // town initial + rest, max 6 letters
    ["Zürich HB", "ZHB"],
    ["Zürich Stadelhofen", "ZStade"],
    ["Zürich, Bahnhofplatz/HB", "ZBahnh"], // only the whole word "Bahnhof" is dropped
    ["Wallisellen, Bahnhof", "Wallis"], // nothing left after dropping "Bahnhof": town
    ["Wallisellen", "Wallis"], // town only
    ["Wallisellen, Furtbach", "WFurtb"],
    ["Rigi Kulm", "RKulm"],
  ];
  for (const [name, abbr] of cases) {
    test(`${name} → ${abbr}`, () => {
      const app = loadApp();
      assert.equal(app.Planner.stopAbbr(name), abbr);
    });
  }
});

// ---------- Planning around home stops ----------

describe("plan: query time includes walking", () => {
  test("from home + Ab: stop departure = time + walk", async () => {
    const app = loadApp();
    app.setRoute(() => undefined);
    await app.Planner.plan("Bern", at(8, 0), "fromHome", "depart");
    const q = app.requests.find((r) => r.path === "connections" && r.params.get("from") === "Wallisellen, Furtbach");
    assert.equal(q.params.get("time"), "08:02");
    assert.equal(q.params.get("isArrivalTime"), "0");
  });

  test("to home + An: stop arrival = time − walk", async () => {
    const app = loadApp();
    app.setRoute(() => undefined);
    await app.Planner.plan("Bern", at(18, 0), "toHome", "arrive");
    const q = app.requests.find((r) => r.path === "connections" && r.params.get("to") === "Wallisellen");
    assert.equal(q.params.get("time"), "17:45");
    assert.equal(q.params.get("isArrivalTime"), "1");
  });

  test("to home + Ab and from home + An: time unchanged", async () => {
    const app = loadApp();
    app.setRoute(() => undefined);
    await app.Planner.plan("Bern", at(18, 0), "toHome", "depart");
    await app.Planner.plan("Bern", at(9, 0), "fromHome", "arrive");
    const qs = app.requests.filter((r) => r.path === "connections" && [r.params.get("from"), r.params.get("to")].includes("Wallisellen"));
    assert.ok(qs.some((q) => q.params.get("time") === "18:00"));
    assert.ok(qs.some((q) => q.params.get("time") === "09:00"));
  });

  test("door-to-door times add the walk at the home end", async () => {
    const app = loadApp();
    connectionsFor(app, { "Wallisellen→Bern": [conn(ride("S", "14", "Wallisellen", [10, 39], "Bern", [12, 0]))] });
    const { journeys } = await app.Planner.plan("Bern", at(10, 0), "fromHome", "depart");
    const j = journeys.find((x) => x.homeStop === "Wallisellen");
    assert.equal(hm(j.start), "10:24"); // 15 min walk
    assert.equal(hm(j.end), "12:00");
  });
});

describe("plan: API walk at the home end is dropped", () => {
  // Found with Furtbach → Rigi Kulm: the API starts with a 17 min walk to Wallisellen.
  test("from home: connection starting with a walk is dropped", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen, Furtbach→Rigi Kulm": [conn(
        walk("Wallisellen, Furtbach", [10, 22], "Wallisellen", [10, 39]),
        ride("S", "14", "Wallisellen", [10, 39], "Rigi Kulm", [12, 34]),
      )],
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    assert.equal(journeys.filter((j) => j.homeStop === "Wallisellen, Furtbach").length, 0);
  });

  test("to home: connection ending with a walk is dropped, also a short one", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Bern→Wallisellen, Ifang": [conn(
        ride("S", "14", "Bern", [8, 0], "Wallisellen", [10, 0]),
        walk("Wallisellen", [10, 0], "Wallisellen, Ifang", [10, 3]),
      )],
    });
    const { journeys } = await app.Planner.plan("Bern", at(7, 50), "toHome", "depart");
    assert.equal(journeys.length, 0);
  });

  test("walk at the far end is kept and marked as extra walk", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen→Rigi Kulm": [conn(
        ride("S", "14", "Wallisellen", [10, 39], "Arth-Goldau", [11, 45]),
        walk("Arth-Goldau", [11, 45], "Rigi Kulm", [11, 55]),
      )],
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    assert.equal(journeys.length, 1);
    assert.equal(journeys[0].hasExtraWalk, true);
  });
});

describe("plan: ordering and time window", () => {
  test("sorted by start, nothing before the asked time", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen→Bern": [conn(ride("S", "14", "Wallisellen", [10, 10], "Bern", [12, 0])),
        conn(ride("S", "14", "Wallisellen", [10, 39], "Bern", [12, 30]))],
      "Dietlikon→Bern": [conn(ride("S", "3", "Dietlikon", [10, 30], "Bern", [12, 20]))],
    });
    const { journeys } = await app.Planner.plan("Bern", at(10, 0), "fromHome", "depart");
    // 10:10 − 15 min walk = 09:55 < 10:00 → out.
    assert.deepEqual([...journeys.map((j) => hm(j.start))], ["10:15", "10:24"]);
  });

  test("failing stop is reported, the others still answer", async () => {
    const app = loadApp();
    app.setRoute((path, p) => {
      if (path === "connections" && p.get("from") === "Dietlikon") {
        return { status: 500 };
      }
      if (path === "connections" && p.get("from") === "Wallisellen") {
        return { connections: [conn(ride("S", "14", "Wallisellen", [10, 39], "Bern", [12, 0]))] };
      }
      return undefined;
    });
    const r = await app.Planner.plan("Bern", at(10, 0), "fromHome", "depart");
    assert.ok([...r.failed].includes("Dietlikon"));
    assert.equal(r.journeys.length, 1);
  });
});

describe("plan: at least 30 minutes of connections", () => {
  test("dense line: asks again from after the last departure until 30 min are covered", async () => {
    const app = loadApp();
    // Every call returns 6 trains, 2 min apart, from the asked time.
    connectionsFor(app, {
      "Wallisellen→Zürich HB": (p) => {
        const [h, m] = p.get("time").split(":").map(Number);
        return [0, 2, 4, 6, 8, 10].map((k) => conn(ride("S", "8", "Wallisellen", [h, m + k], "Zürich HB", [h, m + k + 9])));
      },
    });
    const { journeys } = await app.Planner.plan("Zürich HB", at(8, 0), "fromHome", "depart");
    const calls = app.requests.filter((r) => r.path === "connections" && r.params.get("from") === "Wallisellen");
    assert.ok(calls.length >= 3 && calls.length <= app.MAX_PAGES, `calls: ${calls.length}`);
    const last = Math.max(...journeys.filter((j) => j.homeStop === "Wallisellen").map((j) => j.transitStart));
    assert.ok(last >= at(8, 15 + app.MIN_WINDOW_MIN).getTime());
  });

  test("never more than MAX_PAGES calls per stop", async () => {
    const app = loadApp();
    // Always the same single train: no progress, must stop.
    connectionsFor(app, { "Wallisellen→X": [conn(ride("S", "8", "Wallisellen", [8, 15], "X", [8, 20]))] });
    await app.Planner.plan("X", at(8, 0), "fromHome", "depart");
    const calls = app.requests.filter((r) => r.path === "connections" && r.params.get("from") === "Wallisellen");
    assert.ok(calls.length <= 2);
  });
});

// ---------- Visible results: walk toggle, window, limit ----------

describe("visible()", () => {
  async function planned(app, list) {
    connectionsFor(app, { "Wallisellen→Bern": list });
    return app.Planner.plan("Bern", at(10, 0), "fromHome", "depart");
  }

  test("walk toggle filters the same result without a new search", async () => {
    const app = loadApp();
    const r = await planned(app, [
      conn(ride("S", "14", "Wallisellen", [10, 20], "Bern", [12, 0])),
      conn(ride("S", "14", "Wallisellen", [10, 25], "Arth", [11, 0]), walk("Arth", [11, 0], "Bern", [11, 20])),
    ]);
    const before = app.requests.length;
    assert.equal(app.Planner.visible(r, "show").length, 2);
    assert.equal(app.Planner.visible(r, "hide").length, 1);
    assert.equal(app.requests.length, before);
  });

  test("short change walk does not count as extra walk", async () => {
    const app = loadApp();
    const r = await planned(app, [conn(
      ride("S", "14", "Wallisellen", [10, 20], "Oerlikon", [10, 25]),
      walk("Oerlikon", [10, 25], "Oerlikon Ost", [10, 28]),
      ride("T", "10", "Oerlikon Ost", [10, 30], "Bern", [11, 0]),
    )]);
    assert.equal(app.Planner.visible(r, "hide").length, 1);
  });

  test("everything inside the 30 min window is shown even beyond MAX_RESULTS", async () => {
    const app = loadApp();
    // 20 trains 1 min apart, all inside the window.
    const list = Array.from({ length: 20 }, (_, k) => conn(ride("S", "8", "Wallisellen", [10, 15 + k], "Bern", [11, 15 + k], { trip: `t${k}` })));
    const r = await planned(app, list);
    assert.ok(app.Planner.visible(r, "show").length > app.MAX_RESULTS);
  });

  test("after the window, filled up to MAX_RESULTS", async () => {
    const app = loadApp();
    const list = Array.from({ length: 30 }, (_, k) => conn(ride("S", "8", "Wallisellen", [10, 15 + k * 5], "Bern", [12, 0 + k * 5], { trip: `t${k}` })));
    const r = await planned(app, list);
    assert.equal(app.Planner.visible(r, "show").length, app.MAX_RESULTS);
  });
});

// ---------- Feeder buses (772 & co.) ----------

describe("feeders", () => {
  // Furtbach 772 10:17 → Wallisellen, Bahnhof 10:26, then S14 10:39 from Wallisellen.
  const board772 = [boardEntry("B", "772", "Wallisellen, Furtbach", [10, 17], [["Wallisellen, Bahnhof", [10, 26]]], "772a")];

  test("772 + S14 is built although the API only offers walking", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "board:Wallisellen, Furtbach": board772,
      "Wallisellen→Rigi Kulm": [conn(ride("S", "14", "Wallisellen", [10, 39], "Rigi Kulm", [12, 34]))],
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const viaBus = journeys.find((j) => j.homeStop === "Wallisellen, Furtbach");
    assert.ok(viaBus, "feeder journey missing");
    assert.deepEqual(rides(viaBus), ["772", "S14"]);
    assert.equal(hm(viaBus.start), "10:15"); // 2 min walk to Furtbach
    // The walking option via Wallisellen stays too.
    assert.ok(journeys.some((j) => j.homeStop === "Wallisellen" && hm(j.start) === "10:24"));
  });

  test("way home: S14 to Wallisellen, then 772 to Furtbach", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Rigi Kulm→Wallisellen": [conn(ride("S", "14", "Rigi Kulm", [8, 39], "Wallisellen", [10, 30]))],
      "board:Wallisellen, Bahnhof": [boardEntry("B", "772", "Wallisellen, Bahnhof", [10, 37], [["Wallisellen, Furtbach", [10, 44]]])],
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(8, 0), "toHome", "depart");
    const viaBus = journeys.find((j) => j.homeStop === "Wallisellen, Furtbach");
    assert.ok(viaBus);
    assert.deepEqual(rides(viaBus), ["S14", "772"]);
    assert.equal(hm(viaBus.end), "10:46");
  });

  test("bus that leaves too late for the change is not used", async () => {
    const app = loadApp();
    connectionsFor(app, {
      // Arrives 10:37, change 4 min → 10:41 > 10:39.
      "board:Wallisellen, Furtbach": [boardEntry("B", "772", "Wallisellen, Furtbach", [10, 28], [["Wallisellen, Bahnhof", [10, 37]]])],
      "Wallisellen→Rigi Kulm": [conn(ride("S", "14", "Wallisellen", [10, 39], "Rigi Kulm", [12, 34]))],
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    assert.equal(journeys.filter((j) => j.homeStop === "Wallisellen, Furtbach").length, 0);
  });

  test(`wait at the hub over ${20} min: no feeder journey`, async () => {
    const app = loadApp();
    connectionsFor(app, {
      "board:Wallisellen, Furtbach": board772,
      // 10:26 arrival, train 10:54 = 28 min wait.
      "Wallisellen→Rigi Kulm": [conn(ride("S", "14", "Wallisellen", [10, 54], "Rigi Kulm", [12, 49]))],
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    assert.equal(journeys.filter((j) => j.homeStop === "Wallisellen, Furtbach").length, 0);
  });

  test("other lines on the board are ignored", async () => {
    const app = loadApp();
    const rides772 = await (async () => {
      connectionsFor(app, {
        "board:Wallisellen, Bahnhof": [
          boardEntry("B", "759", "Wallisellen, Bahnhof", [10, 2], [["Wallisellen, Furtbach", [10, 8]]]),
          boardEntry("B", "772", "Wallisellen, Bahnhof", [10, 7], [["Wallisellen, Florastrasse", [10, 8]], ["Wallisellen, Furtbach", [10, 14]]]),
          boardEntry("B", "772", "Wallisellen, Bahnhof", [10, 37], [["Wallisellen, Sportzentrum", [10, 50]]]),
        ],
      });
      return app.TransportApi.feederRides("Wallisellen, Bahnhof", "Wallisellen, Furtbach", ["772"], "bus", at(10, 0));
    })();
    assert.equal(rides772.length, 1);
    assert.equal(hm(rides772[0].arr), "10:14");
  });

  test("backtracking: T12 to Stettbach, then T12 back past Glatt is dropped", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "board:Wallisellen, Glatt (Tram)": [boardEntry("T", "12", "Wallisellen, Glatt (Tram)", [9, 35], [["Stettbach, Bahnhof", [9, 41]]])],
      // No stop list: the "same line again" rule alone must catch it.
      "Stettbach→Zürich Flughafen": [conn(ride("T", "12", "Stettbach, Bahnhof", [9, 49], "Zürich Flughafen, Bahnhof", [10, 13]))],
    });
    const { journeys } = await app.Planner.plan("Zürich Flughafen", at(9, 20), "fromHome", "depart");
    assert.equal(journeys.length, 0);
  });

  test("backtracking via another line passing the feeder stop is dropped too", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "board:Wallisellen, Glatt (Tram)": [boardEntry("T", "12", "Wallisellen, Glatt (Tram)", [9, 35], [["Stettbach, Bahnhof", [9, 41]]])],
      "Stettbach→X": [conn(ride("B", "999", "Stettbach, Bahnhof", [9, 49], "X", [10, 13],
        { stops: ["Stettbach, Bahnhof", "Wallisellen, Glatt (Tram)"] }))],
    });
    const { journeys } = await app.Planner.plan("X", at(9, 20), "fromHome", "depart");
    assert.equal(journeys.length, 0);
  });
});

// ---------- Duplicates, dominated boardings, secondary stops ----------

describe("pruning", () => {
  test("same rides found via two queries appear once", async () => {
    const app = loadApp();
    const same = conn(ride("B", "787", "Wallisellen, Ifang", [10, 9], "Zürich Oerlikon, Bahnhof Ost", [10, 24], { trip: "787x" }),
      ride("S", "8", "Zürich Oerlikon", [10, 30], "Bern", [11, 30], { trip: "s8x" }));
    connectionsFor(app, {
      "Wallisellen, Ifang→Bern": [same],
      "board:Wallisellen, Ifang": [boardEntry("B", "787", "Wallisellen, Ifang", [10, 9], [["Zürich Oerlikon, Bahnhof Ost", [10, 24]]], "787x")],
      "Zürich Oerlikon→Bern": [conn(ride("S", "8", "Zürich Oerlikon", [10, 30], "Bern", [11, 30], { trip: "s8x" }))],
    });
    const { journeys } = await app.Planner.plan("Bern", at(10, 0), "fromHome", "depart");
    assert.equal(journeys.length, 1);
  });

  test("same tram from two stops: only the stop that lets me leave later (Glatt vs Bahnhof)", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen, Glatt (Tram)→Zürich Flughafen": [conn(ride("T", "12", "Wallisellen, Glatt (Tram)", [9, 55], "Zürich Flughafen, Bahnhof", [10, 13], { trip: "t12" }))],
      "Wallisellen→Zürich Flughafen": [conn(ride("T", "12", "Wallisellen, Bahnhof", [9, 56], "Zürich Flughafen, Bahnhof", [10, 13], { trip: "t12" }))],
    });
    const { journeys } = await app.Planner.plan("Zürich Flughafen", at(9, 30), "fromHome", "depart");
    assert.deepEqual([...journeys.map((j) => j.homeStop)], ["Wallisellen, Glatt (Tram)"]);
    assert.equal(hm(journeys[0].start), "09:42"); // 13 min walk
  });

  test("way home: same tram, the stop that gets me home first wins", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Zürich Flughafen→Wallisellen, Glatt (Tram)": [conn(ride("T", "12", "Zürich Flughafen, Bahnhof", [9, 0], "Wallisellen, Glatt (Tram)", [9, 19], { trip: "t12b" }))],
      "Zürich Flughafen→Wallisellen": [conn(ride("T", "12", "Zürich Flughafen, Bahnhof", [9, 0], "Wallisellen, Bahnhof", [9, 18], { trip: "t12b" }))],
    });
    const { journeys } = await app.Planner.plan("Zürich Flughafen", at(8, 50), "toHome", "depart");
    // Glatt: 09:19 + 13 = 09:32; Bahnhof: 09:18 + 15 = 09:33.
    assert.deepEqual([...journeys.map((j) => j.homeStop)], ["Wallisellen, Glatt (Tram)"]);
  });

  test("tie: both stay", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen, Glatt (Tram)→X": [conn(ride("T", "12", "Wallisellen, Glatt (Tram)", [9, 54], "X", [10, 13], { trip: "t12" }))],
      "Wallisellen→X": [conn(ride("T", "12", "Wallisellen, Bahnhof", [9, 56], "X", [10, 13], { trip: "t12" }))],
    });
    const { journeys } = await app.Planner.plan("X", at(9, 30), "fromHome", "depart");
    assert.equal(journeys.length, 2); // both leave home 09:41
  });

  test("secondary stop (Säntisstrasse) dropped when its first vehicle is already used", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen, Säntisstrasse→X": [conn(ride("B", "774", "Wallisellen, Säntisstrasse", [10, 29], "X", [10, 50], { trip: "774a" }))],
      "Wallisellen→X": [conn(ride("B", "774", "Wallisellen, Bahnhof", [10, 26], "X", [10, 50], { trip: "774a" }))],
    });
    const { journeys } = await app.Planner.plan("X", at(10, 0), "fromHome", "depart");
    assert.ok(!journeys.some((j) => j.homeStop === "Wallisellen, Säntisstrasse"));
  });

  test("secondary stop kept when its first vehicle is unique", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen, Säntisstrasse→X": [conn(ride("B", "774", "Wallisellen, Säntisstrasse", [10, 29], "X", [10, 50], { trip: "774a" }))],
      "Wallisellen→X": [conn(ride("S", "8", "Wallisellen", [10, 30], "X", [10, 55], { trip: "s8" }))],
    });
    const { journeys } = await app.Planner.plan("X", at(10, 0), "fromHome", "depart");
    assert.ok(journeys.some((j) => j.homeStop === "Wallisellen, Säntisstrasse"));
  });

  test("Glatt bus stop is secondary, Glatt tram stop is primary with 13 min", () => {
    const app = loadApp();
    const stops = plain(app.HOME_STOPS);
    assert.deepEqual(stops.find((s) => s.name === "Wallisellen, Glatt (Tram)"), { name: "Wallisellen, Glatt (Tram)", walkMin: 13 });
    assert.equal(stops.find((s) => s.name === "Wallisellen, Glatt (Bus)").secondary, true);
    assert.equal(stops.find((s) => s.name === "Wallisellen, Säntisstrasse").walkMin, 8);
  });
});

// ---------- Alternatives at a transfer ----------

describe("alternatives", () => {
  test("earlier (only if late) / planned / later with arrival delta", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "board:Wallisellen, Furtbach": [boardEntry("B", "772", "Wallisellen, Furtbach", [10, 17], [["Wallisellen, Bahnhof", [10, 26]]])],
      "Wallisellen→Rigi Kulm": (p) => {
        const list = [[10, 9, 12, 4], [10, 24, 12, 19], [10, 39, 12, 34], [10, 54, 13, 19]]
          .map(([h, m, ah, am]) => conn(ride("S", "14", "Wallisellen", [h, m], "Rigi Kulm", [ah, am], { trip: `s14-${m}` })));
        return p.get("limit") === "6" ? list : [list[2]];
      },
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const j = journeys.find((x) => x.homeStop === "Wallisellen, Furtbach");
    const alts = await app.Planner.alternatives(j, j.transfers[0]);
    assert.deepEqual([...alts.map((a) => [hm(a.trip.dep), a.rel, a.delta])], [
      ["10:09", "earlier", -30],
      ["10:24", "earlier", -15],
      ["10:39", "planned", 0],
      ["10:54", "later", 45],
    ]);
    const q = app.requests.filter((r) => r.path === "connections").pop();
    assert.equal(q.params.get("time"), "10:06"); // arrival 10:26 − 20 min
  });
});

// ---------- Place field: suggestions, recent, favorites ----------

describe("place suggestions", () => {
  test("under 3 chars: only local (favorites/recent), no API call", async () => {
    const app = loadApp();
    const names = await app.Planner.suggest("Zü", ["Zürich HB", "Bern"]);
    assert.deepEqual([...names], ["Zürich HB"]);
    assert.equal(app.requests.length, 0);
  });

  test("3+ chars: local first, then API hits, no duplicates, max 6", async () => {
    const app = loadApp();
    app.setRoute((path) => path === "locations"
      ? { stations: ["Zürich HB", "Zürich Oerlikon", "Zürich Altstetten", "Zürich Stadelhofen", "Zürich Hardbrücke", "Zürich Enge", "Zürich Wiedikon"].map((name) => ({ name })) }
      : undefined);
    const names = await app.Planner.suggest("Zür", ["Zürich HB"]);
    assert.equal(names[0], "Zürich HB");
    assert.equal(names.length, 6);
    assert.equal(new Set(names).size, 6);
  });
});

describe("recent and favorite places", () => {
  test("recent: most recent first, max 5", () => {
    const app = loadApp();
    ["A", "B", "C", "D", "E", "F", "B"].forEach((n) => app.Stations.touch(n));
    assert.deepEqual([...app.Stations.recent()], ["B", "F", "E", "D", "C"]);
  });

  test("favorites toggle and are not repeated under recent", () => {
    const app = loadApp();
    app.Stations.touch("Bern");
    app.Stations.touch("Basel SBB");
    assert.equal(app.Stations.toggleFavorite("Bern"), true);
    assert.deepEqual([...app.Stations.favorites()], ["Bern"]);
    assert.deepEqual([...app.Stations.recent()], ["Basel SBB"]);
    assert.equal(app.Stations.toggleFavorite("Bern"), false);
    assert.deepEqual([...app.Stations.favorites()], []);
  });
});

// ---------- Duration colors ----------

describe("duration color scale", () => {
  test("best = 0 % bad, worst = 100 % bad, linear in between", () => {
    const app = loadApp();
    assert.match(app.durColor(30, 30, 60), /var\(--bad\) 0%/);
    assert.match(app.durColor(60, 30, 60), /var\(--bad\) 100%/);
    assert.match(app.durColor(45, 30, 60), /var\(--bad\) 50%/);
    assert.match(app.durColor(40, 40, 40), /var\(--bad\) 0%/); // all equal: all good
  });
});
