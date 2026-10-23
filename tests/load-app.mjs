// Loads the <script> of index.html into a Node vm with a minimal DOM stub and
// a scriptable fetch, so the app's logic can be tested without a browser.
//
//   index.html <script> ──vm──► context ──► { Planner, TransportApi, ... }
//                                  ▲
//                     fetch ──► test's route(path, params) → JSON

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HTML = fileURLToPath(new URL("../index.html", import.meta.url));

// Element stub: accepts every call the UI code makes at load time.
function element() {
  return {
    value: "",
    checked: true,
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() { return false; } },
    dataset: {},
    children: [],
    addEventListener() {},
    setAttribute() {},
    append() {},
    replaceChildren() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0 }; },
    set valueAsDate(_) {},
  };
}

function storage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

// route(path, params) → JSON body | { status } | undefined (= empty answer).
export function loadApp() {
  const html = readFileSync(HTML, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const elements = new Map();
  const requests = [];
  let route = () => undefined;

  const context = {
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Element: class {},
    requestAnimationFrame: (cb) => cb(),
    localStorage: storage(),
    window: { addEventListener() {}, innerHeight: 800 },
    location: { href: "https://x.test/app/", hash: "", pathname: "/app/", search: "" },
    history: { replaceState() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    document: {
      getElementById: (id) => elements.get(id) || elements.set(id, element()).get(id),
      addEventListener() {},
      createElement: () => element(),
      querySelector: () => ({ value: "" }),
      querySelectorAll: () => [],
    },
    fetch: async (url) => {
      const u = new URL(url);
      const path = u.pathname.split("/").pop();
      requests.push({ path, params: u.searchParams });
      const body = route(path, u.searchParams);
      const status = body?.status ?? 200;
      return {
        ok: status === 200,
        status,
        json: async () => body ?? (path === "stationboard" ? { stationboard: [] } : { connections: [], stations: [] }),
      };
    },
  };
  vm.createContext(context);
  scripts.forEach((code) => vm.runInContext(code, context));

  const app = vm.runInContext(
    "({ Planner, TransportApi, Stations, Places, durColor, LegKind, Direction, TimeRef, WalkMode, AltRel," +
      " HOME_STOPS, ZUHAUSE, station, MIN_WINDOW_MIN, MAX_RESULTS, MAX_PAGES, BOARD_MAX_REQUERIES })",
    context
  );
  return {
    ...app,
    requests,
    setRoute(fn) {
      route = fn;
    },
  };
}

// ---------- Fixtures in the transport.opendata.ch shape ----------

// Local time on 2026-10-21, as unix seconds.
export const ts = (h, m) => new Date(2026, 9, 21, h, m).getTime() / 1000;
export const at = (h, m) => new Date(2026, 9, 21, h, m);

// Ride section, e.g. ride("S", "14", "Wallisellen", [10, 39], "Zürich HB", [10, 48]).
export function ride(category, number, from, dep, to, arr, extra = {}) {
  return {
    journey: { category, number, name: extra.trip || `${category}${number}-${dep.join("")}`,
      to: extra.headsign || to, passList: (extra.stops || []).map((n) => ({ station: { name: n } })) },
    departure: { station: { name: from }, departureTimestamp: ts(...dep), platform: extra.platform || "" },
    arrival: { station: { name: to }, arrivalTimestamp: ts(...arr) },
  };
}

export function walk(from, dep, to, arr) {
  const sec = ts(...arr) - ts(...dep);
  return {
    journey: null,
    walk: { duration: sec },
    departure: { station: { name: from }, departureTimestamp: ts(...dep) },
    arrival: { station: { name: to }, arrivalTimestamp: ts(...arr) },
  };
}

export function conn(...sections) {
  const first = sections[0];
  const last = sections[sections.length - 1];
  return {
    from: { station: first.departure.station, departureTimestamp: first.departure.departureTimestamp },
    to: { station: last.arrival.station, arrivalTimestamp: last.arrival.arrivalTimestamp },
    products: sections.filter((s) => s.journey).map((s) => s.journey.number),
    sections,
  };
}

// Stationboard entry: line `number` leaving `station` at dep, halting at stops [[name, [h, m]], ...].
export function boardEntry(category, number, station, dep, stops, trip) {
  return {
    name: trip || `${number}-${dep.join("")}`,
    category,
    number,
    to: stops[stops.length - 1][0],
    stop: { station: { name: station }, departureTimestamp: ts(...dep), platform: "" },
    passList: [{ station: { name: null } }, ...stops.map(([n, t]) => ({ station: { name: n }, arrivalTimestamp: ts(...t) }))],
  };
}
