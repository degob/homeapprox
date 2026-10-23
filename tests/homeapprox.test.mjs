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
    const key = `${p.get("type") === "arrival" ? "arrboard" : "board"}:${p.get("station")}`;
    return table[key] ? { stationboard: table[key] } : undefined;
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

describe("board re-asks (buses hidden behind a walk)", () => {
  // Furtbach: bus 772 at 10:17 → Wallisellen, Bahnhof 10:26; S14 10:39 from Wallisellen.
  // The planner never offers 772 → S14 from 10:00 (walk 17 min reaches the same
  // train with no change), but does when asked exactly at 10:17.
  const bus772 = conn(
    ride("B", "772", "Wallisellen, Furtbach", [10, 17], "Wallisellen, Bahnhof", [10, 26], { trip: "772a" }),
    walk("Wallisellen, Bahnhof", [10, 26], "Wallisellen", [10, 28]),
    ride("S", "14", "Wallisellen", [10, 39], "Rigi Kulm", [12, 34], { trip: "s14-39" }),
  );
  const walkToS14 = conn(
    walk("Wallisellen, Furtbach", [10, 22], "Wallisellen", [10, 39]),
    ride("S", "14", "Wallisellen", [10, 39], "Rigi Kulm", [12, 34], { trip: "s14-39" }),
  );
  const furtbach = (p) => (p.get("time") === "10:17" ? [bus772] : [walkToS14]);

  test("from home: the bus appears when asked at its departure; the walk option stays", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "board:Wallisellen, Furtbach": [boardEntry("B", "772", "Wallisellen, Furtbach", [10, 17], [["Wallisellen, Bahnhof", [10, 26]]], "772a")],
      "Wallisellen, Furtbach→Rigi Kulm": furtbach,
      "Wallisellen→Rigi Kulm": [conn(ride("S", "14", "Wallisellen", [10, 39], "Rigi Kulm", [12, 34], { trip: "s14-39" }))],
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const viaBus = journeys.find((j) => j.homeStop === "Wallisellen, Furtbach");
    assert.ok(viaBus, "bus journey missing");
    assert.deepEqual(rides(viaBus), ["772", "S14"]);
    assert.equal(hm(viaBus.start), "10:15"); // 2 min walk to Furtbach
    assert.equal(viaBus.query.board, "Wallisellen, Furtbach");
    assert.ok(journeys.some((j) => j.homeStop === "Wallisellen" && hm(j.start) === "10:24"));
    const asks = app.requests.filter((r) => r.path === "connections" && r.params.get("from") === "Wallisellen, Furtbach");
    assert.ok(asks.some((r) => r.params.get("time") === "10:17" && r.params.get("limit") === "3"));
  });

  test("board asks for bus and tram only, departures", async () => {
    const app = loadApp();
    connectionsFor(app, {});
    await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const boards = app.requests.filter((r) => r.path === "stationboard");
    assert.ok(boards.length >= app.HOME_STOPS.length);
    boards.forEach((r) => {
      assert.deepEqual(r.params.getAll("transportations[]"), ["bus", "tram"]);
      assert.equal(r.params.get("type"), "departure");
    });
  });

  test("way home: arrivals board, asked An at the bus's arrival", async () => {
    const app = loadApp();
    const s14 = ride("S", "14", "Rigi Kulm", [8, 39], "Wallisellen", [10, 30], { trip: "s14-h" });
    connectionsFor(app, {
      "Rigi Kulm→Wallisellen, Furtbach": (p) => (p.get("isArrivalTime") === "1" && p.get("time") === "10:44"
        ? [conn(s14, walk("Wallisellen", [10, 30], "Wallisellen, Bahnhof", [10, 32]),
            ride("B", "772", "Wallisellen, Bahnhof", [10, 37], "Wallisellen, Furtbach", [10, 44], { trip: "772h" }))]
        : [conn(s14, walk("Wallisellen", [10, 30], "Wallisellen, Furtbach", [10, 47]))]),
      "arrboard:Wallisellen, Furtbach": [{ category: "B", number: "772", stop: { station: { name: "Wallisellen, Furtbach" }, arrivalTimestamp: ts(10, 44) } }],
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(8, 0), "toHome", "depart");
    const viaBus = journeys.find((j) => j.homeStop === "Wallisellen, Furtbach");
    assert.ok(viaBus, "bus journey missing");
    assert.deepEqual(rides(viaBus), ["S14", "772"]);
    assert.equal(hm(viaBus.end), "10:46");
    const boards = app.requests.filter((r) => r.path === "stationboard" && r.params.get("station") === "Wallisellen, Furtbach");
    assert.ok(boards.every((r) => r.params.get("type") === "arrival"));
  });

  test("re-ask that only yields the walk again adds nothing", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "board:Wallisellen, Furtbach": [boardEntry("B", "772", "Wallisellen, Furtbach", [10, 17], [["Wallisellen, Sportzentrum", [10, 20]]])],
      "Wallisellen, Furtbach→Rigi Kulm": () => [walkToS14], // bus goes the wrong way: planner still walks
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    assert.equal(journeys.filter((j) => j.homeStop === "Wallisellen, Furtbach").length, 0);
  });

  test(`at most ${6} re-asks per stop`, async () => {
    const app = loadApp();
    const many = Array.from({ length: 10 }, (_, i) =>
      boardEntry("B", "772", "Wallisellen, Furtbach", [10, 2 + i * 2], [["Wallisellen, Bahnhof", [10, 10 + i * 2]]], `b${i}`));
    connectionsFor(app, { "board:Wallisellen, Furtbach": many, "Wallisellen, Furtbach→Rigi Kulm": () => [walkToS14] });
    await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const asks = app.requests.filter((r) => r.path === "connections" && r.params.get("from") === "Wallisellen, Furtbach" && r.params.get("limit") === "3");
    assert.equal(asks.length, app.BOARD_MAX_REQUERIES);
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
      "Wallisellen, Furtbach→Rigi Kulm": (p) => (p.get("time") === "10:17" ? [conn(
        ride("B", "772", "Wallisellen, Furtbach", [10, 17], "Wallisellen, Bahnhof", [10, 26], { trip: "772a" }),
        ride("S", "14", "Wallisellen", [10, 39], "Rigi Kulm", [12, 34], { trip: "s14-39" }),
      )] : []),
      "Wallisellen→Rigi Kulm": (p) => {
        const list = [[10, 9, 12, 4], [10, 24, 12, 19], [10, 39, 12, 34], [10, 54, 13, 19]]
          .map(([h, m, ah, am]) => conn(ride("S", "14", "Wallisellen", [h, m], "Rigi Kulm", [ah, am], { trip: `s14-${m}` })));
        return p.get("limit") === "6" ? list : [list[2]];
      },
    });
    const { journeys } = await app.Planner.plan("Rigi Kulm", at(10, 0), "fromHome", "depart");
    const j = journeys.find((x) => x.homeStop === "Wallisellen, Furtbach");
    const alts = await app.Planner.alternatives(j, j.transfers[0]);
    // wait: departure vs. my arrival at the stop (10:26); delta: arrival at the destination vs. planned.
    assert.deepEqual([...alts.map((a) => [hm(a.trip.dep), a.rel, a.wait, a.delta])], [
      ["10:09", "earlier", -17, -30],
      ["10:24", "earlier", -2, -15],
      ["10:39", "planned", 13, 0],
      ["10:54", "later", 28, 45],
    ]);
    const times = app.requests.filter((r) => r.path === "connections").map((r) => r.params.get("time"));
    assert.ok(times.includes("10:06")); // earlier ones: arrival 10:26 − 20 min
    assert.ok(times.includes("10:26")); // onward from arrival
  });

  // Bug: Oerlikon → Flughafen runs every few minutes; one query from
  // arrival − 20 min returned only connections before my arrival.
  test("dense line: still shows planned + later ones, at most 3 earlier", async () => {
    const app = loadApp();
    // Trains every 2 min; the API returns 6 from the asked time on.
    const dense = (p) => {
      const [h, m] = p.get("time").split(":").map(Number);
      return [0, 2, 4, 6, 8, 10].map((k) => {
        const d = new Date(2026, 9, 21, h, m + k);
        const dep = [d.getHours(), d.getMinutes()];
        const a = new Date(d.getTime() + 7 * 60000);
        return conn(ride("S", "16", "Zürich Oerlikon", dep, "Zürich Flughafen", [a.getHours(), a.getMinutes()], { trip: `s16-${dep.join(":")}` }));
      });
    };
    connectionsFor(app, {
      "Wallisellen→Zürich Flughafen": [conn(
        ride("S", "14", "Wallisellen", [11, 9], "Zürich Oerlikon", [11, 12], { trip: "s14" }),
        ride("S", "16", "Zürich Oerlikon", [11, 16], "Zürich Flughafen", [11, 23], { trip: "s16-11:16" }),
      )],
      "Zürich Oerlikon→Zürich Flughafen": dense,
    });
    const { journeys } = await app.Planner.plan("Zürich Flughafen", at(10, 50), "fromHome", "depart");
    const j = journeys[0];
    const alts = [...(await app.Planner.alternatives(j, j.transfers[0]))];
    const rels = alts.map((a) => a.rel);
    assert.ok(rels.filter((r) => r === "earlier").length <= 3);
    assert.ok(rels.includes("planned"), JSON.stringify(alts.map((a) => [hm(a.trip.dep), a.rel])));
    assert.equal(rels.filter((r) => r === "later" && true).length >= 3, true);
    const deps = alts.map((a) => hm(a.trip.dep));
    assert.deepEqual(deps, [...deps].sort()); // in time order
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

// ---------- Anderer Ort and follow-up search ----------

describe("Anderer Ort", () => {
  test("plain A → B: one query pair, no home stops, no feeder boards, time unchanged", async () => {
    const app = loadApp();
    connectionsFor(app, { "Zürich HB→Bern": [conn(ride("IC", "8", "Zürich HB", [10, 2], "Bern", [10, 58]))] });
    const { journeys } = await app.Planner.plan("Bern", at(10, 0), "other", "depart", "Zürich HB");
    assert.equal(journeys.length, 1);
    assert.equal(hm(journeys[0].start), "10:02"); // no walk added
    const paths = new Set(app.requests.map((r) => `${r.path} ${r.params.get("from") || r.params.get("station")}`));
    assert.deepEqual([...paths], ["connections Zürich HB"]);
    assert.equal(app.requests[0].params.get("time"), "10:00");
  });

  test("walks at both ends are kept (no home end)", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "A→D": [conn(walk("A", [10, 0], "B", [10, 8]), ride("S", "8", "B", [10, 10], "C", [10, 30]), walk("C", [10, 30], "D", [10, 40]))],
    });
    const { journeys } = await app.Planner.plan("D", at(10, 0), "other", "depart", "A");
    assert.equal(journeys.length, 1);
    assert.equal(journeys[0].homeEnd, false);
  });
});

describe("Neue Suche ab Umsteigeort", () => {
  test("to home: from the transfer stop to Zuhause, from my arrival there", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Bern→Wallisellen": [conn(ride("IC", "8", "Bern", [8, 2], "Zürich HB", [8, 58]), ride("S", "8", "Zürich HB", [9, 7], "Wallisellen", [9, 16]))],
    });
    const { journeys } = await app.Planner.plan("Bern", at(8, 0), "toHome", "depart");
    const j = journeys[0];
    const s = plain(app.Planner.followUpSearch(j, j.transfers[0]));
    assert.deepEqual({ ...s, at: hm(new Date(s.at)) }, { from: "Zürich HB", to: "Zuhause", at: "08:58", timeRef: "depart" });
  });

  test("from home: from the transfer stop to the original place", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen→Bern": [conn(ride("S", "8", "Wallisellen", [8, 20], "Zürich HB", [8, 30]), ride("IC", "8", "Zürich HB", [8, 32], "Bern", [9, 28]))],
    });
    const { journeys } = await app.Planner.plan("Bern", at(8, 0), "fromHome", "depart");
    const j = journeys[0];
    const s = plain(app.Planner.followUpSearch(j, j.transfers[0]));
    assert.deepEqual({ ...s, at: hm(new Date(s.at)) }, { from: "Zürich HB", to: "Bern", at: "08:30", timeRef: "depart" });
  });
});

// ---------- Recently left, earlier / later ----------

describe("recently left and more connections", () => {
  // Wallisellen trains every 10 min; query time decides which come back.
  const every10 = (p) => {
    const [h, m] = p.get("time").split(":").map(Number);
    const first = Math.ceil((h * 60 + m) / 10) * 10;
    return [0, 10, 20, 30, 40, 50].map((k) => {
      const t = first + k;
      const dep = [Math.floor(t / 60), t % 60];
      return conn(ride("S", "8", "Wallisellen", dep, "Zürich HB", [Math.floor((t + 12) / 60), (t + 12) % 60], { trip: `s8-${t}` }));
    });
  };

  test("Ab: connections that left up to 5 min ago are included", async () => {
    const app = loadApp();
    connectionsFor(app, { "Wallisellen→Zürich HB": every10 });
    // Asked 08:08 → also the 08:05 home departure (train 08:20, 3 min ago),
    // not 07:55 (13 min ago).
    const r = await app.Planner.search("Zürich HB", at(8, 8), "fromHome", "depart");
    const starts = app.Planner.visible(r, "show").map((j) => hm(j.start));
    assert.equal(starts[0], "08:05");
    assert.ok(!starts.includes("07:55"));
    assert.equal(hm(r.at), "08:08"); // asked time kept for the "vor N Min." tag
  });

  test("An: no look-back", async () => {
    const app = loadApp();
    connectionsFor(app, { "Zürich HB→Wallisellen": [conn(ride("S", "8", "Zürich HB", [8, 0], "Wallisellen", [8, 12]))] });
    await app.Planner.search("Zürich HB", at(9, 0), "toHome", "arrive");
    const q = app.requests.find((r) => r.path === "connections" && r.params.get("to") === "Wallisellen");
    assert.equal(q.params.get("time"), "08:45"); // 09:00 − 15 walk, nothing extra
  });

  test("Spätere: next 30 min are added, window widens", async () => {
    const app = loadApp();
    connectionsFor(app, { "Wallisellen→Zürich HB": every10 });
    const r = await app.Planner.search("Zürich HB", at(8, 0), "fromHome", "depart");
    const r2 = await app.Planner.extend(r, "later");
    assert.equal(hm(r2.hi), "09:00");
    const starts = app.Planner.visible(r2, "show").map((j) => hm(j.start));
    assert.ok(starts.includes("08:55"));
    assert.equal(new Set(starts).size, starts.length); // no duplicates after merge
  });

  test("Frühere: 30 min before are added", async () => {
    const app = loadApp();
    connectionsFor(app, { "Wallisellen→Zürich HB": every10 });
    const r = await app.Planner.search("Zürich HB", at(8, 0), "fromHome", "depart");
    const r2 = await app.Planner.extend(r, "earlier");
    assert.equal(hm(r2.lo), "07:25");
    const starts = app.Planner.visible(r2, "show").map((j) => hm(j.start));
    assert.ok(starts.includes("07:25") && starts.includes("07:45"));
    assert.deepEqual([...starts], [...starts].sort());
  });
});

// ---------- Custom places (generalised Zuhause) ----------

describe("custom places", () => {
  // Work: two stations, 5 and 12 min from the office.
  const work = { name: "Büro", custom: true, stops: [
    { name: "Zürich Oerlikon", walkMin: 5 },
    { name: "Zürich Seebach", walkMin: 12 },
  ] };

  test("far end custom: walk added at that end, one query per home stop × work stop", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen→Zürich Oerlikon": [conn(ride("S", "8", "Wallisellen", [8, 20], "Zürich Oerlikon", [8, 25]))],
      "Wallisellen→Zürich Seebach": [conn(ride("S", "6", "Wallisellen", [8, 18], "Zürich Seebach", [8, 30]))],
    });
    const { journeys } = await app.Planner.plan(work, at(8, 0), "fromHome", "depart");
    const via = (stop) => journeys.find((j) => j.toStop === stop);
    assert.equal(hm(via("Zürich Oerlikon").end), "08:30"); // 08:25 + 5
    assert.equal(hm(via("Zürich Seebach").end), "08:42"); // 08:30 + 12
    assert.equal(via("Zürich Oerlikon").toPlace, "Büro");
    assert.equal(hm(via("Zürich Oerlikon").start), "08:05"); // 15 min walk at home
    assert.ok(app.requests.some((r) => r.params.get("to") === "Zürich Seebach"));
  });

  test("An + far end custom: ride must arrive before walking there", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen→Zürich Seebach": (p) => (p.get("time") === "08:48" ? [conn(ride("S", "6", "Wallisellen", [8, 18], "Zürich Seebach", [8, 30]))] : []),
    });
    const { journeys } = await app.Planner.plan(work, at(9, 0), "fromHome", "arrive");
    assert.ok(journeys.some((j) => j.toStop === "Zürich Seebach")); // asked for arrival 09:00 − 12
  });

  test("API walk at the far custom end drops the trip", async () => {
    const app = loadApp();
    connectionsFor(app, {
      "Wallisellen→Zürich Oerlikon": [conn(
        ride("S", "8", "Wallisellen", [8, 20], "Zürich Oerlikon, Bahnhof Ost", [8, 25]),
        walk("Zürich Oerlikon, Bahnhof Ost", [8, 25], "Zürich Oerlikon", [8, 32]),
      )],
    });
    const { journeys } = await app.Planner.plan(work, at(8, 0), "fromHome", "depart");
    assert.equal(journeys.length, 0);
  });

  test("planPlaces: two custom places, walks at both ends, Direction other", async () => {
    const app = loadApp();
    const gym = { name: "Gym", custom: true, stops: [{ name: "Stettbach", walkMin: 7 }] };
    connectionsFor(app, {
      "Zürich Oerlikon→Stettbach": [conn(ride("S", "9", "Zürich Oerlikon", [18, 10], "Stettbach", [18, 20]))],
    });
    const { journeys } = await app.Planner.planPlaces(work, gym, at(18, 0), "depart");
    assert.equal(journeys.length, 1);
    assert.equal(hm(journeys[0].start), "18:05");
    assert.equal(hm(journeys[0].end), "18:27");
    assert.equal(journeys[0].walkStartMin, 5);
    assert.equal(journeys[0].walkEndMin, 7);
  });

  test("a station is a place with one stop and no walk", () => {
    const app = loadApp();
    assert.deepEqual(plain(app.station("Bern")), { name: "Bern", custom: false, stops: [{ name: "Bern", walkMin: 0 }] });
    assert.equal(app.ZUHAUSE.stops.length, app.HOME_STOPS.length);
  });
});

// ---------- Stored custom places ----------

describe("stored places", () => {
  test("normalize: trims, rounds walk minutes, drops empty stops, needs name and one stop", () => {
    const app = loadApp();
    const p = app.Places.normalize(" Büro ", [{ name: "Zürich Oerlikon", walkMin: "5.4" }, { name: " ", walkMin: "3" }]);
    assert.deepEqual(plain(p), { name: "Büro", stops: [{ name: "Zürich Oerlikon", walkMin: 5 }] });
    assert.throws(() => app.Places.normalize("", [{ name: "A", walkMin: 1 }]), /Name/);
    assert.throws(() => app.Places.normalize("X", [{ name: "", walkMin: 1 }]), /Haltestelle/);
  });

  test("put, rename, remove; resolve gives the custom place or a station", () => {
    const app = loadApp();
    app.Places.put({ name: "Büro", stops: [{ name: "Zürich Oerlikon", walkMin: 5 }] });
    app.Places.put({ name: "Arbeit", stops: [{ name: "Zürich Oerlikon", walkMin: 6 }] }, "Büro");
    assert.deepEqual(plain(app.Places.names()), ["Zuhause", "Arbeit"]);
    const r = app.Places.resolve("Arbeit");
    assert.equal(r.custom, true);
    assert.equal(r.stops[0].walkMin, 6);
    assert.equal(app.Places.resolve("Bern").custom, false);
    app.Places.remove("Arbeit");
    assert.deepEqual(plain(app.Places.names()), ["Zuhause"]);
    // Zuhause is seeded, ordinary, and the default Von.
    assert.equal(app.Places.home().name, "Zuhause");
    assert.deepEqual(plain(app.Places.resolve("Zuhause").stops), plain(app.HOME_STOPS));
    app.Places.setHome("Zuhause");
    app.Places.put(app.Places.normalize("Oma", [{ name: "Bern", walkMin: 3 }], true));
    assert.equal(app.Places.home().name, "Oma");
    assert.deepEqual(plain(app.Places.names()), ["Oma", "Zuhause"]);
    app.Places.remove("Zuhause");
    assert.deepEqual(plain(app.Places.names()), ["Oma"]);
  });

  test("a stored place works as destination of the form", async () => {
    const app = loadApp();
    app.Places.put({ name: "Büro", stops: [{ name: "Zürich Seebach", walkMin: 12 }] });
    connectionsFor(app, {
      "Wallisellen→Zürich Seebach": [conn(ride("S", "6", "Wallisellen", [8, 18], "Zürich Seebach", [8, 30]))],
    });
    const { journeys } = await app.Planner.plan(app.Places.resolve("Büro"), at(8, 0), "fromHome", "depart");
    assert.equal(hm(journeys[0].end), "08:42");
    assert.equal(journeys[0].toPlace, "Büro");
  });
});

// ---------- Places exchange: file and share link ----------

describe("places exchange", () => {
  const two = [
    { name: "Büro", stops: [{ name: "Zürich Oerlikon", walkMin: 5 }] },
    { name: "Gym", stops: [{ name: "Stettbach", walkMin: 7 }] },
  ];

  test("export → import round trip, same name replaces, others kept", () => {
    const a = loadApp();
    two.forEach((p) => a.Places.put(p));
    const text = a.Places.exportJson();
    assert.equal(JSON.parse(text).homeapprox, 1);

    const b = loadApp();
    b.Places.put({ name: "Büro", stops: [{ name: "Zürich Seebach", walkMin: 12 }] });
    b.Places.put({ name: "Oma", stops: [{ name: "Bern", walkMin: 3 }] });
    assert.equal(b.Places.importJson(text), 3); // Zuhause travels along
    assert.deepEqual(plain(b.Places.names()), ["Zuhause", "Büro", "Gym", "Oma"]);
    assert.equal(JSON.parse(text).places.find((p) => p.name === "Zuhause").home, true);
    assert.ok(JSON.parse(text).places.find((p) => p.name === "Zuhause").stops.some((s) => s.secondary));
    assert.equal(b.Places.byName("Büro").stops[0].name, "Zürich Oerlikon");
  });

  test("link carries the places in the fragment; fromHash gives them back", () => {
    const a = loadApp();
    two.forEach((p) => a.Places.put(p));
    const link = a.Places.toLink("https://x.test/app/");
    assert.ok(link.startsWith("https://x.test/app/#places="));
    const hash = link.slice(link.indexOf("#"));
    const b = loadApp();
    assert.equal(b.Places.importJson(b.Places.fromHash(hash)), 3);
    assert.equal(b.Places.fromHash(""), null);
    assert.equal(b.Places.fromHash("#other=1"), null);
  });

  test("import rejects foreign or broken data", () => {
    const app = loadApp();
    assert.throws(() => app.Places.importJson("{not json"), /gültige/);
    assert.throws(() => app.Places.importJson('{"places": []}'), /HomeApprox/);
    assert.throws(() => app.Places.importJson('{"homeapprox": 1, "places": [{"name": "", "stops": []}]}'), /Name/);
  });
});
