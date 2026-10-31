// Module structure tests: every import resolves to an export, every module is
// reached from app.js, and the logic layer never imports from the UI.
// Run: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { moduleOrder } from "./load-app.mjs";

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*"\.\/([\w-]+)\.js";/gm;
const EXPORT = /^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm;

// Logic and shared helpers: must not depend on UI modules.
const LOWER = new Set(["config", "dom", "api", "planner", "stations", "places"]);

const modules = new Map(moduleOrder().map(({ name, src }) => [name, src]));
const exportsOf = (src) => new Set([...src.matchAll(EXPORT)].map((m) => m[1]));
const importsOf = (src) =>
  [...src.matchAll(IMPORT)].map((m) => ({ from: m[2], names: m[1].split(",").map((n) => n.trim()).filter(Boolean) }));

describe("ES modules", () => {
  test("every js/ file is reachable from app.js", () => {
    const files = readdirSync(new URL("../js/", import.meta.url)).filter((f) => f.endsWith(".js"));
    assert.deepEqual(files.map((f) => f.replace(/\.js$/, "")).sort(), [...modules.keys()].sort());
  });

  test("every imported name is exported by its module", () => {
    for (const [name, src] of modules) {
      for (const { from, names } of importsOf(src)) {
        const exported = exportsOf(modules.get(from));
        for (const n of names) assert.ok(exported.has(n), `${name}.js imports ${n} from ${from}.js`);
      }
    }
  });

  test("every export is used by some other module", () => {
    const used = new Set();
    for (const src of modules.values()) {
      for (const { from, names } of importsOf(src)) names.forEach((n) => used.add(`${from}:${n}`));
    }
    for (const [name, src] of modules) {
      for (const n of exportsOf(src)) assert.ok(used.has(`${name}:${n}`), `${name}.js exports unused ${n}`);
    }
  });

  test("logic modules never import from the UI", () => {
    for (const name of LOWER) {
      for (const { from } of importsOf(modules.get(name))) {
        assert.ok(LOWER.has(from), `${name}.js imports UI module ${from}.js`);
      }
    }
  });
});
