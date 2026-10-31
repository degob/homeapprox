// PWA tests: manifest + icons are valid, index.html wires them up, and the
// service worker caches only what it should (never the transport API).
// Run: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

describe("manifest and icons", () => {
  const m = JSON.parse(read("manifest.webmanifest"));

  test("has what Chrome needs to offer installing", () => {
    assert.equal(m.name, "HomeApprox");
    assert.equal(m.display, "standalone");
    assert.equal(m.start_url, "./");
    assert.ok(m.icons.some((i) => i.sizes === "192x192"));
    assert.ok(m.icons.some((i) => i.sizes === "512x512" && i.purpose === "any"));
    assert.ok(m.icons.some((i) => i.purpose === "maskable"));
  });

  test("every icon file exists with the declared size", () => {
    for (const i of m.icons) {
      const [w, h] = pngSize(read(i.src));
      assert.equal(`${w}x${h}`, i.sizes, i.src);
    }
    assert.deepEqual(pngSize(read("icons/apple-touch-icon.png")), [180, 180]);
  });

  test("index.html links manifest, icons and registers the service worker", () => {
    const html = read("index.html").toString();
    assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
    assert.match(html, /rel="apple-touch-icon" href="icons\/apple-touch-icon.png"/);
    assert.match(html, /serviceWorker\.register\("sw.js"\)/);
  });

  test("index.html loads the stylesheet and the app as ES module", () => {
    const html = read("index.html").toString();
    assert.match(html, /<link rel="stylesheet" href="css\/app.css">/);
    assert.match(html, /<script type="module" src="js\/app.js"><\/script>/);
  });
});

// Runs sw.js in a vm with fake caches/fetch and returns its fetch handler.
function loadWorker({ online = true } = {}) {
  const store = new Map();
  const handlers = {};
  const net = [];
  const context = {
    URL, Response: class { constructor(body, init) { this.body = body; this.init = init; this.ok = true; } clone() { return this; } },
    self: {
      location: { origin: "https://homeapprox.catala.ch" },
      addEventListener: (t, f) => (handlers[t] = f),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => ({ put: async (k, v) => store.set(k, v), addAll: async (l) => l.forEach((k) => store.set(k, `cached:${k}`)) }),
      match: async (k) => store.get(typeof k === "string" ? k : k.url),
      keys: async () => [...store.keys()],
    },
    fetch: async (req, opts) => {
      net.push({ url: req.url, opts });
      if (!online) throw new TypeError("offline");
      return { ok: true, body: `net:${req.url}`, clone() { return this; } };
    },
  };
  vm.runInNewContext(read("sw.js").toString(), context);
  const fetchEvent = async (url, mode = "cors") => {
    let res;
    handlers.fetch({ request: { url, method: "GET", mode }, respondWith: (p) => (res = p) });
    return res === undefined ? "untouched" : await res;
  };
  return { fetchEvent, store, net, handlers };
}

describe("service worker", () => {
  test("precaches every js/ module and the stylesheet", async () => {
    const sw = loadWorker();
    await new Promise((done) => sw.handlers.install({ waitUntil: (p) => p.then(done) }));
    const files = readdirSync(new URL("js/", root)).filter((f) => f.endsWith(".js"));
    for (const f of files) assert.ok(sw.store.has(`js/${f}`), `js/${f} not in SHELL`);
    assert.ok(sw.store.has("css/app.css"));
  });

  test("own js/css come from the network (revalidated), cache only offline", async () => {
    let sw = loadWorker();
    const url = "https://homeapprox.catala.ch/js/app.js";
    const res = await sw.fetchEvent(url);
    assert.equal(res.body, `net:${url}`);
    assert.equal(sw.net[0].opts.cache, "no-cache");
    sw = loadWorker({ online: false });
    sw.store.set(url, "cached app.js");
    assert.equal(await sw.fetchEvent(url), "cached app.js");
  });

  test("icons stay cache first", async () => {
    const sw = loadWorker();
    const url = "https://homeapprox.catala.ch/icons/icon-192.png";
    sw.store.set(url, "cached icon");
    assert.equal(await sw.fetchEvent(url), "cached icon");
    assert.equal(sw.net.length, 0);
  });

  test("never intercepts the transport API or other origins", async () => {
    const sw = loadWorker();
    assert.equal(await sw.fetchEvent("https://transport.opendata.ch/v1/connections?from=A&to=B"), "untouched");
    assert.equal(await sw.fetchEvent("https://fonts.googleapis.com/css2?family=x"), "untouched");
  });

  test("page loads come from the network (revalidated) so pushes show up", async () => {
    const sw = loadWorker();
    const res = await sw.fetchEvent("https://homeapprox.catala.ch/", "navigate");
    assert.equal(res.body, "net:https://homeapprox.catala.ch/");
    assert.equal(sw.net[0].opts.cache, "no-cache");
  });

  test("offline: page falls back to cache, else to a 'Keine Verbindung' page", async () => {
    const sw = loadWorker({ online: false });
    let res = await sw.fetchEvent("https://homeapprox.catala.ch/", "navigate");
    assert.match(res.body, /Keine Verbindung/);
    sw.store.set("./", "cached page");
    res = await sw.fetchEvent("https://homeapprox.catala.ch/", "navigate");
    assert.equal(res, "cached page");
  });
});
