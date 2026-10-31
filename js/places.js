// Places: custom places (several stops + walk), persisted

import { EXPORT_VERSION, PLACES_KEY, SHARE_PARAM, ZUHAUSE, station } from "./config.js";

export const Places = (() => {
  // Stored form of ZUHAUSE, used to seed an empty storage.
  const seed = () => [{
    name: ZUHAUSE.name,
    home: true,
    stops: ZUHAUSE.stops.map((s) => ({ name: s.name, walkMin: s.walkMin, ...(s.secondary ? { secondary: true } : {}) })),
  }];

  // Storage without a home place (first run, or saved before homes
  // existed) gets Zuhause added — unless one named so is already there.
  const load = () => {
    try {
      const list = JSON.parse(localStorage.getItem(PLACES_KEY)) || [];
      const hasHome = list.some((p) => p.home || p.name === ZUHAUSE.name);
      if (hasHome) {
        return list;
      }
      const seeded = [...seed(), ...list];
      save(seeded);
      return seeded;
    } catch {
      return seed();
    }
  };
  const save = (list) => {
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify(list));
    } catch {
      // Storage unavailable: places live for this page only.
    }
  };

  // Stored shape is the data only; `custom` is added on read.
  const toPlace = (p) => ({ name: p.name, custom: true, home: Boolean(p.home), stops: p.stops });

  // Home place first, then by name.
  const all = () => load().map(toPlace).sort((a, b) => Number(b.home) - Number(a.home) || a.name.localeCompare(b.name, "de"));
  const names = () => all().map((p) => p.name);
  const byName = (name) => all().find((p) => p.name === name) || null;
  const home = () => all().find((p) => p.home) || null;

  // A name typed or picked in a place field: custom place if one matches,
  // else a plain station.
  const resolve = (name) => byName(name) || station(name);

  // Validated { name, stops, home? }; throws a message for the form.
  // Stop: { name, walkMin, secondary? } — secondary stops are dropped when
  // their vehicle is already covered, see dropCoveredSecondary().
  function normalize(name, stops, home = false) {
    const n = name.trim();
    if (!n) {
      throw new Error("Name fehlt.");
    }
    const clean = stops
      .map((s) => ({
        name: String(s.name || "").trim(),
        walkMin: Math.max(0, Math.round(Number(s.walkMin) || 0)),
        ...(s.secondary ? { secondary: true } : {}),
      }))
      .filter((s) => s.name);
    if (!clean.length) {
      throw new Error("Mindestens eine Haltestelle.");
    }
    return { name: n, stops: clean, ...(home ? { home: true } : {}) };
  }

  // Insert or replace (by `oldName` when renaming). Only one home.
  function put(place, oldName = place.name) {
    const rest = load()
      .filter((p) => p.name !== oldName && p.name !== place.name)
      .map((p) => (place.home ? { ...p, home: false } : p));
    save([...rest, place]);
  }

  // Marks `name` as the default "Von".
  const setHome = (name) => save(load().map((p) => ({ ...p, home: p.name === name })));

  const remove = (name) => save(load().filter((p) => p.name !== name));

  // Exchange format, same for file and link:
  //   { "homeapprox": 1, "places": [{ "name", "home"?, "stops": [{ "name", "walkMin", "secondary"? }] }] }
  const exportJson = () => JSON.stringify({ homeapprox: EXPORT_VERSION, places: load() }, null, 2);

  // Merges: same name replaces, others are kept. Returns how many came in.
  function importJson(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Keine gültige Datei.");
    }
    if (!data || data.homeapprox !== EXPORT_VERSION || !Array.isArray(data.places)) {
      throw new Error("Kein HomeApprox-Export.");
    }
    data.places.forEach((p) => put(normalize(String(p.name || ""), Array.isArray(p.stops) ? p.stops : [], Boolean(p.home))));
    return data.places.length;
  }

  // Share link: the export in the URL fragment, so it never hits a server.
  const toLink = (base) => `${base}#${SHARE_PARAM}=${encodeURIComponent(exportJson())}`;

  // Places carried in a fragment, or null. Does not import by itself.
  function fromHash(hash) {
    const m = new RegExp(`^#?(?:.*&)?${SHARE_PARAM}=([^&]+)`).exec(hash || "");
    return m ? decodeURIComponent(m[1]) : null;
  }

  return { all, names, byName, home, setHome, resolve, normalize, put, remove, exportJson, importJson, toLink, fromHash };
})();
