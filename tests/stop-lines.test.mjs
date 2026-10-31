// Lines at stops: learnt from loaded connections, completed by one board per
// stop on tap, cached in localStorage, forgotten at the timetable change.
// Run: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadApp, at } from "./load-app.mjs";

const OERLIKON = { id: "8503006", name: "Zürich Oerlikon" };
const HARDBRUECKE = { id: "8503020", name: "Zürich Hardbrücke" };
const plain = (x) => JSON.parse(JSON.stringify(x));

// Journey with one ride of `line` halting at `stops`.
const journey = (line, headsign, stops) => ({
  legs: [{ kind: "ride", line, headsign, passes: stops.map((s) => ({ ...s })) }],
});

// Board entry in the transport.opendata.ch shape.
const dep = (category, number, to, stops = []) => ({
  category, number, name: `${category}${number}`, to,
  stop: { station: OERLIKON, departureTimestamp: at(16, 40).getTime() / 1000 },
  passList: stops.map((s) => ({ station: s })),
});

describe("lines at stops", () => {
  test("learnt from connections: other lines ⇄ known, own line excluded", () => {
    const app = loadApp();
    app.StopLines.learn([
      journey("S14", "Zürich HB", [OERLIKON, HARDBRUECKE]),
      journey("S9", "Schaffhausen", [OERLIKON]),
      journey("S9", "Zürich HB", [OERLIKON]),
    ]);
    const o = app.StopLines.info(OERLIKON, "S14");
    assert.equal(o.state, app.LinesState.KNOWN);
    assert.deepEqual(plain(o.lines), [{ line: "S9", dirs: ["Schaffhausen", "Zürich HB"] }]);
    assert.equal(o.board, false);
    assert.equal(app.StopLines.info(HARDBRUECKE, "S14").state, app.LinesState.UNKNOWN);
    assert.equal(app.StopLines.info({ id: "1", name: "Nirgendwo" }, "S14").state, app.LinesState.UNKNOWN);
  });

  test("tap: one board per stop, then cached; NONE when only the own line runs", async () => {
    const app = loadApp();
    let boards = 0;
    app.setRoute((path, p) => {
      if (path !== "stationboard") return undefined;
      boards++;
      assert.equal(p.get("id"), HARDBRUECKE.id);
      assert.equal(p.get("limit"), "30");
      assert.equal(p.get("datetime"), "2026-10-21 16:40");
      assert.equal(p.get("type"), "departure");
      return { stationboard: [dep("S", "14", "Zürich HB")] };
    });
    let inf = await app.StopLines.fetch(HARDBRUECKE, at(16, 40), "S14");
    assert.equal(inf.state, app.LinesState.NONE);
    inf = await app.StopLines.fetch(HARDBRUECKE, at(16, 40), "S14");
    assert.equal(boards, 1, "second tap from the cache");
    assert.equal(app.StopLines.info(HARDBRUECKE, "S14").state, app.LinesState.NONE);
  });

  test("board merges with what was seen; its vehicles teach their other halts", async () => {
    const app = loadApp();
    app.StopLines.learn([journey("T10", "Bahnhofplatz/HB", [OERLIKON])]);
    app.setRoute((path) => (path === "stationboard"
      ? { stationboard: [dep("S", "9", "Schaffhausen", [{ id: "8503310", name: "Glattbrugg" }]), dep("IR", "55", "St. Gallen")] }
      : undefined));
    const inf = await app.StopLines.fetch(OERLIKON, at(16, 40), "S14");
    assert.deepEqual(plain(inf.lines.map((x) => x.line)), ["IR55", "S9", "T10"]);
    assert.equal(inf.board, true);
    const g = app.StopLines.info({ id: "8503310", name: "Glattbrugg" }, "S14");
    assert.equal(g.state, app.LinesState.KNOWN);
    assert.equal(g.board, false, "seen via a vehicle, not asked");
    const saved = JSON.parse(app.localStorage.getItem("homeapprox.stoplines"));
    assert.equal(saved[OERLIKON.id].name, "Zürich Oerlikon");
    assert.equal(saved[OERLIKON.id].lines["S9|Schaffhausen"].src, "board");
  });

  test("a later 'seen' never downgrades a board line; nothing is removed", async () => {
    const app = loadApp();
    app.setRoute((path) => (path === "stationboard" ? { stationboard: [dep("S", "9", "Schaffhausen")] } : undefined));
    await app.StopLines.fetch(OERLIKON, at(16, 40), "S14");
    app.StopLines.learn([journey("S9", "Schaffhausen", [OERLIKON])]);
    const saved = JSON.parse(app.localStorage.getItem("homeapprox.stoplines"));
    assert.equal(saved[OERLIKON.id].lines["S9|Schaffhausen"].src, "board");
  });

  test("forgotten after 60 days and at the timetable change", () => {
    const app = loadApp();
    const nov1 = new Date(2026, 10, 1).getTime();
    app.StopLines.learn([journey("S9", "Schaffhausen", [OERLIKON])], nov1);
    assert.equal(app.StopLines.info(OERLIKON, "S14", new Date(2026, 11, 12).getTime()).state, app.LinesState.KNOWN);
    assert.equal(app.StopLines.info(OERLIKON, "S14", new Date(2026, 11, 13, 1).getTime()).state, app.LinesState.UNKNOWN,
      "timetable change on Sun 13.12.2026");
    const app2 = loadApp();
    app2.StopLines.learn([journey("S9", "Schaffhausen", [OERLIKON])], new Date(2027, 0, 1).getTime());
    assert.equal(app2.StopLines.info(OERLIKON, "S14", new Date(2027, 2, 1).getTime()).state, app2.LinesState.KNOWN);
    assert.equal(app2.StopLines.info(OERLIKON, "S14", new Date(2027, 2, 3).getTime()).state, app2.LinesState.UNKNOWN, "> 60 days");
  });

  test("timetable change = second Sunday of December", () => {
    const app = loadApp();
    const d = (x) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
    assert.equal(d(app.lastTimetableChange(new Date(2026, 10, 1))), "2025-12-14");
    assert.equal(d(app.lastTimetableChange(new Date(2026, 11, 20))), "2026-12-13");
    assert.equal(d(app.lastTimetableChange(new Date(2027, 11, 11, 23))), "2026-12-13");
    assert.equal(d(app.lastTimetableChange(new Date(2027, 11, 12, 1))), "2027-12-12");
  });
});
