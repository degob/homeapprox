// API statistics: real network calls counted per hour and endpoint, cache
// hits not counted, old hours dropped.
// Run: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadApp, at } from "./load-app.mjs";

const total = (app, now, label) => app.ApiStats.summary(now).find((w) => w.label === label);

describe("API statistics", () => {
  test("every request counted per endpoint; board cache hits are not", async () => {
    const app = loadApp();
    await app.TransportApi.connections("Wallisellen", "Zürich HB", at(10, 0), "depart");
    await app.TransportApi.connections("Wallisellen", "Zürich HB", at(10, 5), "depart");
    await app.TransportApi.departures({ id: "8503006", name: "Zürich Oerlikon" }, at(10, 0));
    await app.TransportApi.departures({ id: "8503006", name: "Zürich Oerlikon" }, at(10, 0)); // cached
    const [hour] = app.ApiStats.summary();
    assert.equal(hour.total, app.requests.length);
    assert.equal(hour.total, 3);
    assert.equal(hour.byEndpoint.connections, 2);
    assert.equal(hour.byEndpoint.stationboard, 1);
  });

  test("windows count whole hours; older than 90 days is dropped", () => {
    const app = loadApp();
    const t = (d, h) => new Date(2026, 9, d, h, 30);
    app.ApiStats.record("connections", t(31, 16));
    app.ApiStats.record("connections", t(31, 15));
    app.ApiStats.record("locations", t(30, 17));
    app.ApiStats.record("stationboard", t(20, 9));
    const now = t(31, 16);
    assert.equal(total(app, now, "Diese Stunde").total, 1);
    assert.equal(total(app, now, "24 Stunden").total, 3);
    assert.equal(total(app, now, "7 Tage").total, 3);
    assert.equal(total(app, now, "30 Tage").total, 4);
    app.ApiStats.record("connections", new Date(2027, 0, 25, 12)); // > 90 days after 20.10.
    const kept = JSON.parse(app.localStorage.getItem("homeapprox.apistats"));
    assert.ok(!("2026-10-20T09" in kept));
    assert.ok("2026-10-31T16" in kept);
  });

  test("reset empties the statistics", () => {
    const app = loadApp();
    app.ApiStats.record("connections");
    app.ApiStats.reset();
    assert.equal(app.ApiStats.summary()[4].total, 0);
  });
});
